// Event contract v1.3 + v2 (additive) — mirrors docs/contracts/events.md (v1.1 stage order + nullable fmax; v1.2 polish nodes; v1.3 node.timing;
// v2: run.started.domain/ladder/tool_versions, free-string node.stage.stage for non-silicon domains, artifact.created). The envelope `v` stays 1.
// The web app derives everything it renders from a stream of these events.

export const CONTRACT_VERSION = 1 as const;

export type EventType =
  | "run.started"
  | "run.baseline"
  | "run.completed"
  | "run.failed"
  | "node.created"
  | "node.stage"
  | "node.scored"
  | "node.pruned"
  | "node.expanded"
  | "node.timing"
  | "artifact.created"
  | "llm.call"
  | "sandbox.op"
  | "log";

export type NodeId = string;
export type Stage = "implement" | "lint" | "unit" | "prove" | "e2e" | "synth" | "bench";
export type StageStatus = "queued" | "running" | "pass" | "fail" | "skipped";
export type Model = "nemotron-nano" | "nemotron-super" | "nemotron-ultra";
export type Role = "brief" | "triage" | "architect" | "implement" | "repair" | "diagnose" | "report" | "polish";
export type Rung = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
export type RungResult = "pass" | "fail" | "skipped";

/** v1.1 order: cheap checks first; prove and synth only run on candidates that speed the workload up. */
export const STAGES: readonly Stage[] = ["implement", "lint", "unit", "e2e", "bench", "prove", "synth"];
export const RUNGS: readonly Rung[] = ["L1", "L2", "L3", "L4", "L5", "L6"];
export const MODELS: readonly Model[] = ["nemotron-ultra", "nemotron-super", "nemotron-nano"];
export const ROLES: readonly Role[] = ["architect", "implement", "repair", "diagnose", "triage", "brief", "report", "polish"];

export interface EventBase {
  v: 1;
  seq: number;
  t: number;
  run_id: string;
  type: EventType;
}

/** v2: one rung of a domain's verification ladder, as announced by `run.started.ladder`. */
export interface LadderRung {
  id: string;
  label: string;
  tool?: string;
}

export const DEFAULT_DOMAIN = "silicon";

export interface RunStarted extends EventBase {
  type: "run.started";
  /** v2: which workbench produced the run. Absent = "silicon". */
  domain?: string;
  /** v2: the domain's rung list (id, label, tool). Absent = the silicon L1..L6 ladder. */
  ladder?: LadderRung[];
  /** v2, optional: tool name -> version string, when the engine records it. The UI never invents a version. */
  tool_versions?: Record<string, string>;
  workload: { id: string; title: string; source_repo?: string; source_path?: string; lang: "c" };
  config: {
    area_budget_pct: number;
    beam: number;
    k_root: number;
    k_child: number;
    max_depth: number;
    max_concurrency: number;
  };
  backend: "contree" | "nebius-jobs" | "local";
}

export interface Hotspot {
  symbol: string;
  /** The real engine (r_m4_first) emits `function` instead of `symbol`; the reducer normalises it. */
  function?: string;
  fetches?: number;
  file: string;
  line_start: number;
  line_end: number;
  pct: number;
}

export interface RunBaseline extends EventBase {
  type: "run.baseline";
  cycles: number;
  luts: number;
  ffs: number;
  cells: number;
  /** v1.1: null until Fmax is measured (show "—"). */
  fmax_mhz: number | null;
  output_hash: string;
  hotspots: Hotspot[];
}

export type ProposalKind = "instruction" | "area" | "software";

export interface Proposal {
  /** v1.2: absent = "instruction". `area` / `software` are polish passes on the parent's instruction. */
  kind?: ProposalKind;
  mnemonic: string;
  title: string;
  semantics_c: string;
  operands: { rs1: string; rs2: string; rd: string };
  rationale: string;
  est_speedup?: number;
  est_area_pct?: number;
}

export interface NodeCreated extends EventBase {
  type: "node.created";
  node_id: NodeId;
  parent_id: NodeId | null;
  depth: number;
  proposal: Proposal | null;
  instruction_set: string[];
}

export interface WaveSignal {
  name: string;
  width: number;
  values: string[];
}

export interface Counterexample {
  signals: WaveSignal[];
  cycles: number;
}

export interface StageArtifacts {
  rtl?: string;
  c_ref?: string;
  intrinsic_h?: string;
  patch_diff?: string;
  error_log?: string;
  counterexample?: Counterexample;
}

/** v2: silicon stages are the `Stage` union; other domains use free strings (typically their ladder rung ids). */
export type StageName = Stage | (string & {});

export interface NodeStage extends EventBase {
  type: "node.stage";
  node_id: NodeId;
  stage: StageName;
  status: StageStatus;
  attempt: number;
  detail?: string;
  artifacts?: StageArtifacts;
}

export interface NodeScored extends EventBase {
  type: "node.scored";
  node_id: NodeId;
  cycles: number;
  speedup: number;
  luts: number;
  ffs: number;
  area_delta_pct: number;
  /** v1.1: null until Fmax is measured; then wall_speedup === speedup. */
  fmax_mhz: number | null;
  wall_speedup: number;
  feasible: boolean;
  on_pareto: boolean;
  ladder: Record<Rung, RungResult>;
}

export interface NodePruned extends EventBase {
  type: "node.pruned";
  node_id: NodeId;
  reason: string;
}

export interface NodeExpanded extends EventBase {
  type: "node.expanded";
  node_id: NodeId;
  children: NodeId[];
}

/** v1.3: Fmax of the final nodes, median of nextpnr seeds. Merged into the node's score by the reducer. */
export interface NodeTiming extends EventBase {
  type: "node.timing";
  node_id: NodeId;
  fmax_mhz: number;
  wall_speedup: number;
  seeds: number;
  samples_mhz?: number[];
}

/** v2: a file the run produced (netlist, STL, bundle...). `sha256` is the lowercase hex digest of the file at `path`. */
export interface ArtifactCreated extends EventBase {
  type: "artifact.created";
  kind: string;
  path: string;
  sha256: string;
  /** Optional: the node the artifact belongs to. */
  node_id?: NodeId | null;
}

export interface LlmCall extends EventBase {
  type: "llm.call";
  node_id: NodeId | null;
  model: Model;
  role: Role;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
}

export interface SandboxOp extends EventBase {
  type: "sandbox.op";
  node_id: NodeId;
  op_id: string;
  from_image: string;
  /** v1.1: may be null on failed ops. */
  to_image?: string | null;
  status: "started" | "succeeded" | "failed";
  duration_s?: number;
}

export interface RunCompleted extends EventBase {
  type: "run.completed";
  best_node_id: NodeId;
  pareto: NodeId[];
  totals: { nodes: number; sandboxes: number; cost_usd: number; tokens: number; wall_s: number };
  report: { pr_url?: string; bundle_url?: string };
}

export interface RunFailed extends EventBase {
  type: "run.failed";
  error: string;
}

export interface LogEvent extends EventBase {
  type: "log";
  level: "info" | "warn" | "error";
  msg: string;
  node_id?: NodeId;
}

export type RunEvent =
  | RunStarted
  | RunBaseline
  | RunCompleted
  | RunFailed
  | NodeCreated
  | NodeStage
  | NodeScored
  | NodePruned
  | NodeExpanded
  | NodeTiming
  | ArtifactCreated
  | LlmCall
  | SandboxOp
  | LogEvent;

/** Which ladder rung each pipeline stage feeds. `implement` and `bench` feed none on their own. */
export const STAGE_RUNG: Partial<Record<Stage, Rung>> = {
  lint: "L1",
  unit: "L2",
  prove: "L3",
  e2e: "L4",
  synth: "L5",
};

/** Parse one NDJSON document into events. Blank lines are skipped; bad lines are reported, not thrown. */
export function parseNdjson(text: string): { events: RunEvent[]; errors: Array<{ line: number; message: string }> } {
  const events: RunEvent[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      const value = JSON.parse(raw) as RunEvent;
      if (typeof value !== "object" || value === null || typeof value.type !== "string") {
        errors.push({ line: i + 1, message: "not an event object" });
        continue;
      }
      events.push(value);
    } catch (err) {
      errors.push({ line: i + 1, message: err instanceof Error ? err.message : String(err) });
    }
  }
  events.sort((a, b) => a.seq - b.seq);
  return { events, errors };
}
