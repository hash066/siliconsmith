# Event contract: engine ↔ web (v1)

The engine emits one JSON object per line (NDJSON). The same stream is:
- served live over **SSE** at `GET /api/runs/{run_id}/events` (each SSE `data:` = one event);
- persisted to `runs/{run_id}/events.ndjson`;
- replayed by the web app from `web/public/replays/{run_id}.ndjson` (no backend needed).

Every event has this envelope:

```ts
interface EventBase {
  v: 1;                 // contract version
  seq: number;          // strictly increasing per run, starts at 0
  t: number;            // ms since run start (replay timing)
  run_id: string;
  type: EventType;
}
```

## Types

```ts
type EventType =
  | "run.started" | "run.baseline" | "run.completed" | "run.failed"
  | "node.created" | "node.stage" | "node.scored" | "node.pruned" | "node.expanded"
  | "llm.call" | "sandbox.op" | "log";

type NodeId = string;          // "root", "n1", "n1.3", "n1.3.2" (dot = depth)
type Stage = "implement" | "lint" | "unit" | "prove" | "e2e" | "synth" | "bench";
type StageStatus = "queued" | "running" | "pass" | "fail" | "skipped";
type Model = "nemotron-nano" | "nemotron-super" | "nemotron-ultra";
type Role = "brief" | "triage" | "architect" | "implement" | "repair" | "diagnose" | "report" | "polish";

interface RunStarted extends EventBase {
  type: "run.started";
  workload: { id: string; title: string; source_repo?: string; source_path?: string; lang: "c" };
  config: { area_budget_pct: number; beam: number; k_root: number; k_child: number; max_depth: number; max_concurrency: number };
  backend: "contree" | "nebius-jobs" | "local";
}

interface RunBaseline extends EventBase {
  type: "run.baseline";
  cycles: number; luts: number; ffs: number; cells: number; fmax_mhz: number;
  output_hash: string;
  hotspots: Array<{ symbol: string; file: string; line_start: number; line_end: number; pct: number }>;
}

interface Proposal {
  kind?: "instruction" | "area" | "software"; // (v1.2) absent = "instruction"
  mnemonic: string;            // e.g. "dot4.s8"
  title: string;               // "Packed int8 dot product"
  semantics_c: string;         // C reference function (the spec)
  operands: { rs1: string; rs2: string; rd: string };
  rationale: string;           // Ultra's reasoning, 1–3 sentences
  est_speedup?: number;
  est_area_pct?: number;
}

interface NodeCreated extends EventBase {
  type: "node.created";
  node_id: NodeId; parent_id: NodeId | null; depth: number;
  proposal: Proposal | null;   // null for root
  instruction_set: string[];   // cumulative mnemonics in this CPU
}

interface NodeStage extends EventBase {
  type: "node.stage";
  node_id: NodeId; stage: Stage; status: StageStatus;
  attempt: number;             // 0 = first try, 1..2 = repairs
  detail?: string;             // short human line ("1,000,000 vectors · 0 mismatches")
  artifacts?: {                // only on pass/fail where relevant
    rtl?: string; c_ref?: string; intrinsic_h?: string; patch_diff?: string;
    error_log?: string;
    counterexample?: { signals: Array<{ name: string; width: number; values: string[] }>; cycles: number };
  };
}

interface NodeScored extends EventBase {
  type: "node.scored";
  node_id: NodeId;
  cycles: number; speedup: number;          // base_cycles / cycles
  luts: number; ffs: number; area_delta_pct: number;
  fmax_mhz: number; wall_speedup: number;   // speedup * fmax / base_fmax
  feasible: boolean; on_pareto: boolean;
  ladder: Record<"L1"|"L2"|"L3"|"L4"|"L5"|"L6", "pass"|"fail"|"skipped">;
}

interface NodePruned extends EventBase { type: "node.pruned"; node_id: NodeId; reason: string }
interface NodeExpanded extends EventBase { type: "node.expanded"; node_id: NodeId; children: NodeId[] }

interface LlmCall extends EventBase {
  type: "llm.call";
  node_id: NodeId | null; model: Model; role: Role;
  tokens_in: number; tokens_out: number; cost_usd: number; latency_ms: number;
}

interface SandboxOp extends EventBase {
  type: "sandbox.op";
  node_id: NodeId; op_id: string; from_image: string; to_image?: string;
  status: "started" | "succeeded" | "failed"; duration_s?: number;
}

interface RunCompleted extends EventBase {
  type: "run.completed";
  best_node_id: NodeId; pareto: NodeId[];
  totals: { nodes: number; sandboxes: number; cost_usd: number; tokens: number; wall_s: number };
  report: { pr_url?: string; bundle_url?: string };
}

interface RunFailed extends EventBase { type: "run.failed"; error: string }
interface Log extends EventBase { type: "log"; level: "info" | "warn" | "error"; msg: string; node_id?: NodeId }
```

## Rules
- Nodes are created before any of their stage events.
- **(v1.1)** A node's stages run in the order `implement → lint → unit → e2e → bench → prove → synth`. Cheap checks run first, and formal proof plus synthesis only run on candidates that actually speed up the workload. A `fail` with `attempt < 2` is followed by `implement` (repair) with `attempt+1`. `bench` and `synth` can also end in `fail` followed directly by `node.pruned` (no speedup / over area budget), with no repair.
- `node.scored` arrives only after `synth` passes. Failed nodes end with `node.pruned` (reason).
- **(v1.1)** `fmax_mhz` (in `run.baseline` and `node.scored`) is `number | null`; `null` means not measured yet, so show "—". Until Fmax is measured, `wall_speedup === speedup`.
- **(v1.1)** `sandbox.op.to_image` may be `null` for failed ops; `from_image`/`to_image` look like `"<backend>:<node_id>"` for the local backend.
- **(v1.1)** A `log` event with `node_id` may carry the architect's hotspot analysis (good for the inspector).
- The web app derives everything (tree, metrics, cost totals) from events alone, so it must not need any other API to render a replay.

## Example (truncated)
```json
{"v":1,"seq":0,"t":0,"run_id":"r_demo","type":"run.started","workload":{"id":"w1","title":"int8 dense layer (keyword spotting)","lang":"c"},"config":{"area_budget_pct":5,"beam":3,"k_root":8,"k_child":5,"max_depth":3,"max_concurrency":50},"backend":"contree"}
{"v":1,"seq":1,"t":4200,"run_id":"r_demo","type":"run.baseline","cycles":1203344,"luts":1912,"ffs":1105,"cells":3480,"fmax_mhz":43.1,"output_hash":"9f2c…","hotspots":[{"symbol":"dense_s8","file":"kernel.c","line_start":41,"line_end":48,"pct":71.4}]}
{"v":1,"seq":2,"t":9100,"run_id":"r_demo","type":"node.created","node_id":"n1","parent_id":"root","depth":1,"proposal":{"mnemonic":"dot4.s8","title":"Packed int8 dot product","semantics_c":"int32_t dot4(uint32_t a, uint32_t b){...}","operands":{"rs1":"4×int8","rs2":"4×int8","rd":"int32"},"rationale":"71% of cycles are 4 loads + 4 mul + 4 add per output pair; one instruction fuses them."},"instruction_set":["dot4.s8"]}
{"v":1,"seq":3,"t":9150,"run_id":"r_demo","type":"llm.call","node_id":"n1","model":"nemotron-ultra","role":"architect","tokens_in":6120,"tokens_out":910,"cost_usd":0.0088,"latency_ms":5200}
```
- **(v1.2) Polish nodes.** After each round, the agent improves its own winners in a short chain: `area` (same function, less hardware, re-proven against the same spec; it must not get slower and must shrink) and then `software` (same hardware, faster code; output must stay bit-identical). They are ordinary children in the tree with `proposal.kind` set; their `mnemonic` is the instruction being polished. A `software` node's `prove` stage arrives as `skipped` ("hardware unchanged: formal proofs carry over"). LLM calls for them use `role: "polish"`. A polished node can be the run's best node.
- **(v1.3) Timing.** `run.baseline.fmax_mhz` is the median Fmax of nextpnr place-and-route (Tang Nano 9K, GW1NR-9) over 3 seeds, measured at run start. At run end, just before `run.completed`, the engine emits one `node.timing` per final node (the best node and the Pareto nodes). `node.scored` is never re-emitted; until `node.timing` arrives a node's `wall_speedup` equals `speedup`, and after it the UI shows `node.timing.wall_speedup`.

```ts
interface NodeTiming extends EventBase {
  type: "node.timing";
  node_id: NodeId;
  fmax_mhz: number;          // median over `seeds` place-and-route runs
  wall_speedup: number;      // speedup * fmax_mhz / run.baseline.fmax_mhz
  seeds: number;             // how many seeds succeeded (nextpnr seed noise is about +-8%)
  samples_mhz?: number[];    // per-seed Fmax
}
```
