// Pure reducer: a stream of contract events -> everything the run console renders.
// No I/O, no clocks. Replay and live SSE both feed this same function.

import {
  MODELS,
  ROLES,
  RUNGS,
  STAGES,
  STAGE_RUNG,
  type Counterexample,
  type Hotspot,
  type LlmCall,
  type Model,
  type NodeId,
  type NodeScored,
  type NodeTiming,
  type Proposal,
  type Role,
  type Rung,
  type RunBaseline,
  type RunCompleted,
  type RunEvent,
  type RunStarted,
  type Stage,
  type StageArtifacts,
  type StageStatus,
} from "./events";

export interface StageRecord {
  status: StageStatus;
  attempt: number;
  detail?: string;
  t: number;
}

export interface AttemptRecord {
  attempt: number;
  t: number;
  stages: Partial<Record<Stage, StageRecord>>;
  failed?: Stage;
}

export interface Evidence {
  attempt: number;
  stage: Stage;
  t: number;
  detail?: string;
  log?: string;
  counterexample?: Counterexample;
}

export type PruneKind = "budget" | "nogain" | "failed";
export type NodeStatus =
  | "baseline"
  | "queued"
  | "running"
  | "repairing"
  | "scored"
  | "unproven"
  | "pruned";

export interface Usage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

export interface NodeState {
  id: NodeId;
  parentId: NodeId | null;
  depth: number;
  proposal: Proposal | null;
  instructionSet: string[];
  children: NodeId[];
  createdT: number;
  lastT: number;
  /** Highest attempt seen (0 = first try, 1..2 = repairs). */
  attempt: number;
  /** The stage currently running, if any. */
  activeStage: Stage | null;
  /** Latest record per stage (any attempt). */
  stages: Partial<Record<Stage, StageRecord>>;
  attempts: AttemptRecord[];
  /** Latest artifacts from `implement`, merged with any later per-stage artifacts. */
  artifacts: StageArtifacts;
  /** Artifacts as they were for each attempt, so a repaired node can show what changed. */
  artifactsByAttempt: Record<number, StageArtifacts>;
  evidence: Evidence[];
  score: NodeScored | null;
  /** v1.3: median-of-seeds Fmax for final nodes; also folded into `score` so every view shows wall-clock. */
  timing: NodeTiming | null;
  pruned: { reason: string; t: number; kind: PruneKind } | null;
  expanded: boolean;
  usage: Usage;
  sandbox: { active: number; total: number; failed: number };
  notes: Array<{ t: number; level: "info" | "warn" | "error"; msg: string }>;
  /** Best-effort figures parsed from stage details for nodes pruned before node.scored. */
  measured: { cycles?: number; areaPct?: number; luts?: number };
}

export interface TickerItem {
  seq: number;
  t: number;
  nodeId: NodeId | null;
  tone: "neutral" | "pass" | "fail" | "warn" | "signal";
  kind: string;
  text: string;
}

export interface Marker {
  t: number;
  seq: number;
  nodeId: NodeId | null;
  kind: "best" | "fail" | "prune" | "done";
  label: string;
}

export interface RunState {
  runId: string | null;
  status: "waiting" | "running" | "completed" | "failed";
  workload: RunStarted["workload"] | null;
  config: RunStarted["config"] | null;
  backend: RunStarted["backend"] | null;
  baseline: (Omit<RunBaseline, "hotspots"> & { hotspots: Hotspot[] }) | null;
  nodes: Record<NodeId, NodeState>;
  order: NodeId[];
  rootId: NodeId | null;
  seq: number;
  t: number;
  startT: number | null;
  eventCount: number;
  best: NodeId | null;
  /** Best feasible wall-clock speedup over time, for the "best so far" trace. */
  bestSeries: Array<[number, number]>;
  pareto: NodeId[];
  usage: { total: Usage; byModel: Record<Model, Usage>; byRole: Record<Role, Usage> };
  sandboxes: {
    active: number;
    peak: number;
    total: number;
    succeeded: number;
    failed: number;
    open: Record<string, NodeId>;
    series: Array<[number, number]>;
  };
  lastActive: NodeId | null;
  completed: RunCompleted | null;
  error: string | null;
  ticker: TickerItem[];
  markers: Marker[];
  /** Contract deviations seen in the stream (unknown nodes, bad order). Shown, never thrown. */
  warnings: string[];
}

const TICKER_CAP = 250;

const emptyUsage = (): Usage => ({ calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 });
const usageMap = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, emptyUsage()])) as Record<K, Usage>;

export function initialRunState(): RunState {
  return {
    runId: null,
    status: "waiting",
    workload: null,
    config: null,
    backend: null,
    baseline: null,
    nodes: {},
    order: [],
    rootId: null,
    seq: -1,
    t: 0,
    startT: null,
    eventCount: 0,
    best: null,
    bestSeries: [],
    pareto: [],
    usage: { total: emptyUsage(), byModel: usageMap(MODELS), byRole: usageMap(ROLES) },
    sandboxes: { active: 0, peak: 0, total: 0, succeeded: 0, failed: 0, open: {}, series: [] },
    lastActive: null,
    completed: null,
    error: null,
    ticker: [],
    markers: [],
    warnings: [],
  };
}

function newNode(id: NodeId, t: number): NodeState {
  return {
    id,
    parentId: null,
    depth: 0,
    proposal: null,
    instructionSet: [],
    children: [],
    createdT: t,
    lastT: t,
    attempt: 0,
    activeStage: null,
    stages: {},
    attempts: [],
    artifacts: {},
    artifactsByAttempt: {},
    evidence: [],
    score: null,
    timing: null,
    pruned: null,
    expanded: false,
    usage: emptyUsage(),
    sandbox: { active: 0, total: 0, failed: 0 },
    notes: [],
    measured: {},
  };
}

function cloneNode(n: NodeState): NodeState {
  return {
    ...n,
    children: n.children.slice(),
    stages: { ...n.stages },
    attempts: n.attempts.map((a) => ({ ...a, stages: { ...a.stages } })),
    artifacts: { ...n.artifacts },
    artifactsByAttempt: { ...n.artifactsByAttempt },
    evidence: n.evidence.slice(),
    usage: { ...n.usage },
    sandbox: { ...n.sandbox },
    notes: n.notes.slice(),
    measured: { ...n.measured },
  };
}

const MODEL_LABEL: Record<Model, string> = {
  "nemotron-ultra": "Ultra",
  "nemotron-super": "Super",
  "nemotron-nano": "Nano",
};

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Wall-clock speedup, honouring v1.1: with no Fmax, wall === cycle speedup. */
export function wallOf(score: NodeScored): number {
  return Number.isFinite(score.wall_speedup) ? score.wall_speedup : score.speedup;
}

function addUsage(u: Usage, e: LlmCall) {
  u.calls += 1;
  u.tokensIn += e.tokens_in;
  u.tokensOut += e.tokens_out;
  u.costUsd += e.cost_usd;
  u.latencyMs += e.latency_ms;
}

function pruneKind(n: NodeState, reason: string): PruneKind {
  const failedStage = n.attempts.at(-1)?.failed;
  if (failedStage === "synth" || /budget/i.test(reason)) return "budget";
  if (failedStage === "bench" || /no (speedup|gain)/i.test(reason)) return "nogain";
  return "failed";
}

function parseMeasured(n: NodeState, stage: Stage, detail?: string) {
  if (!detail) return;
  if (stage === "bench") {
    const m = detail.match(/([\d,]{3,})\s+cycles/);
    if (m) n.measured.cycles = Number(m[1].replace(/,/g, ""));
  }
  if (stage === "synth") {
    const a = detail.match(/([+-]?\d+(?:\.\d+)?)%\s*LUT/);
    if (a) n.measured.areaPct = Number(a[1]);
    const l = detail.match(/([\d,]+)\s+LUT\b/);
    if (l) n.measured.luts = Number(l[1].replace(/,/g, ""));
  }
}

function recomputeBest(s: RunState) {
  let best: NodeId | null = null;
  let bestWall = -Infinity;
  for (const id of s.order) {
    const sc = s.nodes[id].score;
    if (!sc || !sc.feasible) continue;
    const w = wallOf(sc);
    if (w > bestWall) {
      bestWall = w;
      best = id;
    }
  }
  if (best !== s.best) {
    s.best = best;
    if (best) {
      s.bestSeries = [...s.bestSeries, [s.t, bestWall]];
      const n = s.nodes[best];
      s.markers = [
        ...s.markers,
        { t: s.t, seq: s.seq, nodeId: best, kind: "best", label: `New best: ${best} ${n.proposal?.mnemonic ?? ""} ${bestWall.toFixed(2)}×` },
      ];
    }
  }
}

function tick(s: RunState, e: RunEvent, item: Omit<TickerItem, "seq" | "t">) {
  s.ticker.push({ seq: e.seq, t: e.t, ...item });
  if (s.ticker.length > TICKER_CAP) s.ticker.splice(0, s.ticker.length - TICKER_CAP);
}

/** Apply a batch of events. Returns a new state; `prev` is never mutated. */
export function applyEvents(prev: RunState, events: readonly RunEvent[]): RunState {
  if (events.length === 0) return prev;
  const s: RunState = {
    ...prev,
    nodes: { ...prev.nodes },
    order: prev.order.slice(),
    pareto: prev.pareto.slice(),
    bestSeries: prev.bestSeries,
    usage: {
      total: { ...prev.usage.total },
      byModel: Object.fromEntries(MODELS.map((m) => [m, { ...prev.usage.byModel[m] }])) as Record<Model, Usage>,
      byRole: Object.fromEntries(ROLES.map((r) => [r, { ...(prev.usage.byRole[r] ?? emptyUsage()) }])) as Record<Role, Usage>,
    },
    sandboxes: { ...prev.sandboxes, open: { ...prev.sandboxes.open }, series: prev.sandboxes.series.slice() },
    ticker: prev.ticker.slice(),
    markers: prev.markers,
    warnings: prev.warnings.slice(),
  };
  const touched = new Set<NodeId>();
  const node = (id: NodeId): NodeState | null => {
    const n = s.nodes[id];
    if (!n) return null;
    if (!touched.has(id)) {
      s.nodes[id] = cloneNode(n);
      touched.add(id);
    }
    return s.nodes[id];
  };
  const warn = (msg: string) => {
    if (s.warnings.length < 50 && !s.warnings.includes(msg)) s.warnings.push(msg);
  };

  for (const e of events) {
    if (e.seq <= s.seq) continue; // duplicate (SSE reconnect) or replayed out of order
    s.seq = e.seq;
    s.t = Math.max(s.t, e.t);
    s.eventCount += 1;
    if (s.runId === null) s.runId = e.run_id;
    if (s.startT === null) s.startT = e.t;

    switch (e.type) {
      case "run.started": {
        s.status = "running";
        s.workload = e.workload;
        s.config = e.config;
        s.backend = e.backend;
        tick(s, e, { nodeId: null, tone: "neutral", kind: "run", text: `Run started · ${e.workload.title} · ${e.backend}` });
        break;
      }
      case "run.baseline": {
        const hotspots = (e.hotspots ?? []).map((h) => ({ ...h, symbol: h.symbol ?? h.function ?? "?" }));
        s.baseline = { ...e, hotspots };
        const top = hotspots[0];
        tick(s, e, {
          nodeId: s.rootId,
          tone: "neutral",
          kind: "baseline",
          text: `Baseline · ${fmtInt(e.cycles)} cycles${top ? ` · ${top.symbol} ${top.pct.toFixed(1)}%` : ""}`,
        });
        break;
      }
      case "node.created": {
        if (s.nodes[e.node_id]) {
          warn(`node ${e.node_id} created twice`);
          break;
        }
        const n = newNode(e.node_id, e.t);
        n.parentId = e.parent_id;
        n.depth = e.depth;
        n.proposal = e.proposal;
        n.instructionSet = e.instruction_set ?? [];
        s.nodes[e.node_id] = n;
        touched.add(e.node_id);
        s.order.push(e.node_id);
        if (e.parent_id === null) s.rootId = e.node_id;
        else {
          const p = node(e.parent_id);
          if (p && !p.children.includes(e.node_id)) p.children.push(e.node_id);
          if (!p) warn(`node ${e.node_id} has unknown parent ${e.parent_id}`);
        }
        if (e.proposal)
          tick(s, e, { nodeId: e.node_id, tone: "neutral", kind: "created", text: `${e.node_id} proposed · ${e.proposal.mnemonic} — ${e.proposal.title}` });
        break;
      }
      case "node.expanded": {
        const n = node(e.node_id);
        if (!n) {
          warn(`expanded unknown node ${e.node_id}`);
          break;
        }
        n.expanded = true;
        for (const c of e.children) if (!n.children.includes(c)) n.children.push(c);
        tick(s, e, { nodeId: e.node_id, tone: "neutral", kind: "expanded", text: `${e.node_id} expanded into ${e.children.length} candidates` });
        break;
      }
      case "node.stage": {
        const n = node(e.node_id);
        if (!n) {
          warn(`stage event for unknown node ${e.node_id}`);
          break;
        }
        n.lastT = e.t;
        n.attempt = Math.max(n.attempt, e.attempt);
        s.lastActive = e.node_id;
        let att = n.attempts.find((a) => a.attempt === e.attempt);
        if (!att) {
          att = { attempt: e.attempt, t: e.t, stages: {} };
          n.attempts.push(att);
          n.attempts.sort((a, b) => a.attempt - b.attempt);
        }
        const rec: StageRecord = { status: e.status, attempt: e.attempt, detail: e.detail, t: e.t };
        att.stages[e.stage] = rec;
        n.stages[e.stage] = rec;
        if (e.stage === "implement" && e.status === "running" && e.attempt > 0) {
          // A repair restarts the ladder: later stages from the failed attempt no longer apply.
          for (const st of STAGES) if (st !== "implement") delete n.stages[st];
        }
        if (e.status === "running") n.activeStage = e.stage;
        else if (n.activeStage === e.stage) n.activeStage = null;
        if (e.status === "fail") {
          att.failed = e.stage;
          n.activeStage = null;
        }
        if (e.artifacts) {
          const { error_log, counterexample, ...code } = e.artifacts;
          if (Object.keys(code).length) {
            n.artifacts = { ...n.artifacts, ...code };
            n.artifactsByAttempt[e.attempt] = { ...(n.artifactsByAttempt[e.attempt] ?? {}), ...code };
          }
          if (error_log !== undefined || counterexample !== undefined) {
            n.evidence.push({ attempt: e.attempt, stage: e.stage, t: e.t, detail: e.detail, log: error_log, counterexample });
          }
        }
        parseMeasured(n, e.stage, e.detail);
        if (e.status === "pass" && e.stage !== "implement") {
          tick(s, e, { nodeId: e.node_id, tone: "pass", kind: e.stage, text: `${e.node_id} ${e.stage} passed${e.detail ? ` · ${e.detail}` : ""}` });
        } else if (e.status === "fail") {
          tick(s, e, { nodeId: e.node_id, tone: "fail", kind: e.stage, text: `${e.node_id} ${e.stage} failed${e.detail ? ` · ${e.detail}` : ""}` });
          s.markers = [
            ...s.markers,
            { t: e.t, seq: e.seq, nodeId: e.node_id, kind: "fail", label: `${e.node_id} ${e.stage} failed${e.artifacts?.counterexample ? " (counterexample)" : ""}` },
          ];
        } else if (e.status === "skipped") {
          tick(s, e, { nodeId: e.node_id, tone: "warn", kind: e.stage, text: `${e.node_id} ${e.stage} skipped${e.detail ? ` · ${e.detail}` : ""}` });
        } else if (e.stage === "implement" && e.status === "running" && e.attempt > 0) {
          tick(s, e, { nodeId: e.node_id, tone: "warn", kind: "repair", text: `${e.node_id} repair · attempt ${e.attempt}` });
        }
        break;
      }
      case "node.scored": {
        const n = node(e.node_id);
        if (!n) {
          warn(`score for unknown node ${e.node_id}`);
          break;
        }
        n.score = e;
        n.activeStage = null;
        n.lastT = e.t;
        if (e.on_pareto && !s.pareto.includes(e.node_id)) s.pareto.push(e.node_id);
        recomputeBest(s);
        tick(s, e, {
          nodeId: e.node_id,
          tone: e.feasible ? "signal" : "warn",
          kind: "scored",
          text: `${e.node_id} scored · ${wallOf(e).toFixed(2)}× · ${e.area_delta_pct >= 0 ? "+" : ""}${e.area_delta_pct.toFixed(2)}% area${e.feasible ? "" : " · not eligible"}`,
        });
        break;
      }
      case "node.timing": {
        const n = node(e.node_id);
        if (!n || !n.score) {
          warn(`timing for unscored node ${e.node_id}`);
          break;
        }
        n.timing = e;
        n.score = { ...n.score, fmax_mhz: e.fmax_mhz, wall_speedup: e.wall_speedup };
        tick(s, e, {
          nodeId: e.node_id,
          tone: "neutral",
          kind: "timing",
          text: `${e.node_id} Fmax ${e.fmax_mhz.toFixed(1)} MHz (median of ${e.seeds} seeds) · wall-clock ${e.wall_speedup.toFixed(2)}×`,
        });
        break;
      }
      case "node.pruned": {
        const n = node(e.node_id);
        if (!n) {
          warn(`prune for unknown node ${e.node_id}`);
          break;
        }
        n.pruned = { reason: e.reason, t: e.t, kind: pruneKind(n, e.reason) };
        n.activeStage = null;
        n.lastT = e.t;
        s.pareto = s.pareto.filter((id) => id !== e.node_id || n.score?.on_pareto);
        if (s.best === e.node_id) recomputeBest(s);
        tick(s, e, { nodeId: e.node_id, tone: n.pruned.kind === "failed" ? "fail" : "warn", kind: "pruned", text: `${e.node_id} pruned · ${e.reason}` });
        s.markers = [...s.markers, { t: e.t, seq: e.seq, nodeId: e.node_id, kind: "prune", label: `${e.node_id} pruned: ${e.reason}` }];
        break;
      }
      case "llm.call": {
        addUsage(s.usage.total, e);
        addUsage(s.usage.byModel[e.model] ?? (s.usage.byModel[e.model] = emptyUsage()), e);
        addUsage(s.usage.byRole[e.role] ?? (s.usage.byRole[e.role] = emptyUsage()), e);
        if (e.node_id) {
          const n = node(e.node_id);
          if (n) addUsage(n.usage, e);
        }
        tick(s, e, {
          nodeId: e.node_id,
          tone: "neutral",
          kind: "llm",
          text: `${MODEL_LABEL[e.model] ?? e.model} · ${e.role}${e.node_id ? ` · ${e.node_id}` : ""} · ${fmtK(e.tokens_in)} in / ${fmtK(e.tokens_out)} out · $${e.cost_usd.toFixed(4)}`,
        });
        break;
      }
      case "sandbox.op": {
        const sb = s.sandboxes;
        const n = node(e.node_id);
        if (e.status === "started") {
          if (!sb.open[e.op_id]) {
            sb.open[e.op_id] = e.node_id;
            sb.active += 1;
            sb.total += 1;
            sb.peak = Math.max(sb.peak, sb.active);
            if (n) {
              n.sandbox.active += 1;
              n.sandbox.total += 1;
            }
          }
        } else {
          if (sb.open[e.op_id]) {
            delete sb.open[e.op_id];
            sb.active -= 1;
            if (n) n.sandbox.active = Math.max(0, n.sandbox.active - 1);
          } else {
            // finished without a start we saw (joined mid-run): count it once
            sb.total += 1;
            if (n) n.sandbox.total += 1;
          }
          if (e.status === "succeeded") sb.succeeded += 1;
          else {
            sb.failed += 1;
            if (n) n.sandbox.failed += 1;
          }
        }
        const last = sb.series.at(-1);
        if (last && last[0] === e.t) last[1] = sb.active;
        else sb.series.push([e.t, sb.active]);
        break;
      }
      case "log": {
        if (e.node_id) {
          const n = node(e.node_id);
          if (n) n.notes.push({ t: e.t, level: e.level, msg: e.msg });
        }
        tick(s, e, { nodeId: e.node_id ?? null, tone: e.level === "error" ? "fail" : e.level === "warn" ? "warn" : "neutral", kind: "log", text: e.msg });
        break;
      }
      case "run.completed": {
        s.status = "completed";
        s.completed = e;
        if (e.pareto?.length) s.pareto = e.pareto.filter((id) => s.nodes[id]);
        const declared = e.best_node_id;
        if (declared && declared !== s.rootId && s.nodes[declared]?.score) s.best = declared;
        else if (declared === s.rootId) s.best = s.best && s.nodes[s.best]?.score?.feasible ? s.best : null;
        tick(s, e, {
          nodeId: s.best,
          tone: "signal",
          kind: "run",
          text: `Run completed · ${s.best ? `best ${s.best} ${s.nodes[s.best].proposal?.mnemonic ?? ""}` : "no candidate beat the baseline"} · ${e.totals.nodes} nodes · $${e.totals.cost_usd.toFixed(2)}`,
        });
        s.markers = [...s.markers, { t: e.t, seq: e.seq, nodeId: s.best, kind: "done", label: "Run completed" }];
        break;
      }
      case "run.failed": {
        s.status = "failed";
        s.error = e.error;
        tick(s, e, { nodeId: null, tone: "fail", kind: "run", text: `Run failed · ${e.error}` });
        break;
      }
      default: {
        warn(`unknown event type ${(e as { type: string }).type}`);
      }
    }
  }
  return s;
}

export const reduce = (state: RunState, event: RunEvent) => applyEvents(state, [event]);
export const reduceAll = (events: readonly RunEvent[]) => applyEvents(initialRunState(), events);

// ---------- derived views ----------

export function nodeStatus(n: NodeState, s: RunState): NodeStatus {
  if (n.parentId === null) return s.baseline ? "baseline" : "running";
  if (n.pruned) return "pruned";
  if (n.score) return n.score.feasible ? "scored" : "unproven";
  if (n.activeStage) return n.attempt > 0 ? "repairing" : "running";
  const anyRun = Object.keys(n.stages).length > 0;
  return anyRun ? "running" : "queued";
}

export type RungStatus = "pending" | "running" | "pass" | "fail" | "skipped" | "not-run";
export interface RungView {
  rung: Rung;
  stage: Stage | null;
  status: RungStatus;
  detail?: string;
  attempt?: number;
  /** Earlier attempts that failed this rung, newest last. */
  failures: Array<{ attempt: number; detail?: string }>;
}

const RUNG_STAGE: Record<Rung, Stage | null> = { L1: "lint", L2: "unit", L3: "prove", L4: "e2e", L5: "synth", L6: null };

export function ladderFor(n: NodeState): RungView[] {
  const ended = !!(n.pruned || n.score);
  return RUNGS.map((rung) => {
    const stage = RUNG_STAGE[rung];
    const failures: RungView["failures"] = [];
    if (stage) {
      for (const a of n.attempts) {
        const r = a.stages[stage];
        if (r && r.status === "fail" && r !== n.stages[stage]) failures.push({ attempt: a.attempt, detail: r.detail });
      }
    }
    const rec = stage ? n.stages[stage] : undefined;
    let status: RungStatus;
    if (n.score) {
      const v = n.score.ladder[rung];
      status = v === "pass" ? "pass" : v === "fail" ? "fail" : rung === "L6" ? "not-run" : "skipped";
    } else if (rec) {
      status = rec.status === "queued" ? "pending" : (rec.status as RungStatus);
    } else {
      status = ended || rung === "L6" ? "not-run" : "pending";
    }
    return { rung, stage, status, detail: rec?.detail, attempt: rec?.attempt, failures };
  });
}

/** Each pipeline stage's latest status, in v1.1 order (for the compact stage strip on a tree node). */
export function stageStrip(n: NodeState): Array<{ stage: Stage; status: StageStatus | "none" }> {
  return STAGES.map((stage) => ({ stage, status: n.stages[stage]?.status ?? "none" }));
}

export function rungOf(stage: Stage): Rung | undefined {
  return STAGE_RUNG[stage];
}

/** The proposals from the root down to this node: the CPU's cumulative instruction set, with specs. */
export function lineage(s: RunState, id: NodeId): NodeState[] {
  const out: NodeState[] = [];
  let cur: NodeState | undefined = s.nodes[id];
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? s.nodes[cur.parentId] : undefined;
  }
  return out;
}

export interface FrontierPoint {
  id: NodeId;
  areaPct: number;
  wall: number;
  cycles: number;
  kind: "feasible" | "unproven" | "budget";
  onPareto: boolean;
  best: boolean;
}

/** Points for the speedup-vs-area chart: scored nodes, plus over-budget nodes measured before pruning. */
export function frontier(s: RunState): FrontierPoint[] {
  const base = s.baseline?.cycles;
  const out: FrontierPoint[] = [];
  for (const id of s.order) {
    const n = s.nodes[id];
    if (n.score) {
      out.push({
        id,
        areaPct: n.score.area_delta_pct,
        wall: wallOf(n.score),
        cycles: n.score.cycles,
        kind: n.score.feasible ? "feasible" : "unproven",
        onPareto: s.pareto.includes(id),
        best: s.best === id,
      });
    } else if (n.pruned?.kind === "budget" && n.measured.cycles && n.measured.areaPct !== undefined && base) {
      out.push({ id, areaPct: n.measured.areaPct, wall: base / n.measured.cycles, cycles: n.measured.cycles, kind: "budget", onPareto: false, best: false });
    }
  }
  return out;
}

export function counts(s: RunState) {
  let feasible = 0, unproven = 0, budget = 0, nogain = 0, failed = 0, running = 0, queued = 0;
  for (const id of s.order) {
    const n = s.nodes[id];
    if (n.parentId === null) continue;
    const st = nodeStatus(n, s);
    if (st === "scored") feasible++;
    else if (st === "unproven") unproven++;
    else if (st === "pruned") {
      if (n.pruned!.kind === "budget") budget++;
      else if (n.pruned!.kind === "nogain") nogain++;
      else failed++;
    } else if (st === "queued") queued++;
    else running++;
  }
  return { candidates: s.order.length - (s.rootId ? 1 : 0), feasible, unproven, budget, nogain, failed, running, queued };
}
