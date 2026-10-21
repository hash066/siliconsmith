import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateStream } from "./contract";
import { parseNdjson, type RunEvent } from "./events";
import { applyEvents, counts, frontier, initialRunState, ladderFor, lineage, nodeStatus, reduceAll, stageStrip } from "./run-state";

const load = (id: string) => {
  const text = readFileSync(resolve(__dirname, `../public/replays/${id}.ndjson`), "utf8");
  const { events, errors } = parseNdjson(text);
  expect(errors).toEqual([]);
  return events;
};

let seq = 0;
const ev = <T extends RunEvent["type"]>(type: T, body: Record<string, unknown>, t = seq * 10): RunEvent =>
  ({ v: 1, seq: seq++, t, run_id: "r_test", type, ...body }) as unknown as RunEvent;

function smallRun(): RunEvent[] {
  seq = 0;
  return [
    ev("run.started", { workload: { id: "w", title: "W", lang: "c" }, config: { area_budget_pct: 5, beam: 2, k_root: 2, k_child: 2, max_depth: 1, max_concurrency: 4 }, backend: "local" }),
    ev("run.baseline", { cycles: 1000, luts: 100, ffs: 50, cells: 300, fmax_mhz: null, output_hash: "abc", hotspots: [{ function: "hot", file: "k.c", line_start: 1, line_end: 4, pct: 90 }] }),
    ev("node.created", { node_id: "root", parent_id: null, depth: 0, proposal: null, instruction_set: [] }),
    ev("node.created", { node_id: "n1", parent_id: "root", depth: 1, proposal: { mnemonic: "a", title: "A", semantics_c: "", operands: { rs1: "", rs2: "", rd: "" }, rationale: "" }, instruction_set: ["a"] }),
    ev("node.created", { node_id: "n2", parent_id: "root", depth: 1, proposal: { mnemonic: "b", title: "B", semantics_c: "", operands: { rs1: "", rs2: "", rd: "" }, rationale: "" }, instruction_set: ["b"] }),
    ev("node.expanded", { node_id: "root", children: ["n1", "n2"] }),
    ev("sandbox.op", { node_id: "n1", op_id: "o1", from_image: "local:root", status: "started" }),
    ev("sandbox.op", { node_id: "n2", op_id: "o2", from_image: "local:root", status: "started" }),
    ev("llm.call", { node_id: "n1", model: "nemotron-super", role: "implement", tokens_in: 1000, tokens_out: 500, cost_usd: 0.00075, latency_ms: 1000 }),
    ev("node.stage", { node_id: "n1", stage: "implement", status: "pass", attempt: 0, artifacts: { rtl: "module a; endmodule", patch_diff: "--- a\n+++ b" } }),
    ev("node.stage", { node_id: "n1", stage: "lint", status: "pass", attempt: 0 }),
    ev("node.stage", { node_id: "n1", stage: "unit", status: "pass", attempt: 0 }),
    ev("node.stage", { node_id: "n1", stage: "e2e", status: "pass", attempt: 0 }),
    ev("node.stage", { node_id: "n1", stage: "bench", status: "pass", attempt: 0, detail: "400 cycles" }),
    ev("node.stage", { node_id: "n1", stage: "prove", status: "fail", attempt: 0, detail: "cex", artifacts: { error_log: "FAIL", counterexample: { cycles: 2, signals: [{ name: "x", width: 1, values: ["0", "1"] }] } } }),
    ev("node.stage", { node_id: "n1", stage: "implement", status: "running", attempt: 1 }),
    ev("node.stage", { node_id: "n1", stage: "implement", status: "pass", attempt: 1, artifacts: { rtl: "module a2; endmodule" } }),
    ev("node.stage", { node_id: "n1", stage: "lint", status: "pass", attempt: 1 }),
    ev("node.stage", { node_id: "n2", stage: "implement", status: "pass", attempt: 0 }),
    ev("node.stage", { node_id: "n2", stage: "lint", status: "pass", attempt: 0 }),
    ev("node.stage", { node_id: "n2", stage: "unit", status: "pass", attempt: 0 }),
    ev("node.stage", { node_id: "n2", stage: "e2e", status: "pass", attempt: 0 }),
    ev("node.stage", { node_id: "n2", stage: "bench", status: "fail", attempt: 0, detail: "1,010 cycles: no gain over parent (1,000)" }),
    ev("node.pruned", { node_id: "n2", reason: "no speedup (0.99x vs parent 1.00x)" }),
    ev("sandbox.op", { node_id: "n2", op_id: "o2", from_image: "local:root", to_image: null, status: "failed", duration_s: 3 }),
    ev("node.stage", { node_id: "n1", stage: "unit", status: "pass", attempt: 1 }),
    ev("node.stage", { node_id: "n1", stage: "e2e", status: "pass", attempt: 1 }),
    ev("node.stage", { node_id: "n1", stage: "bench", status: "pass", attempt: 1 }),
    ev("node.stage", { node_id: "n1", stage: "prove", status: "pass", attempt: 1 }),
    ev("node.stage", { node_id: "n1", stage: "synth", status: "pass", attempt: 1, detail: "+2.00% LUT-eq" }),
    ev("node.scored", { node_id: "n1", cycles: 400, speedup: 2.5, luts: 102, ffs: 50, area_delta_pct: 2, fmax_mhz: null, wall_speedup: 2.5, feasible: true, on_pareto: true, ladder: { L1: "pass", L2: "pass", L3: "pass", L4: "pass", L5: "pass", L6: "skipped" } }),
    ev("sandbox.op", { node_id: "n1", op_id: "o1", from_image: "local:root", to_image: "local:n1", status: "succeeded", duration_s: 9 }),
    ev("run.completed", { best_node_id: "n1", pareto: ["n1"], totals: { nodes: 2, sandboxes: 2, cost_usd: 0.00075, tokens: 1500, wall_s: 1 }, report: {} }),
  ];
}

describe("run-state reducer", () => {
  it("builds the tree, scores, prunes and finishes", () => {
    const s = reduceAll(smallRun());
    expect(s.status).toBe("completed");
    expect(s.rootId).toBe("root");
    expect(s.nodes.root.children).toEqual(["n1", "n2"]);
    expect(s.best).toBe("n1");
    expect(s.pareto).toEqual(["n1"]);
    expect(nodeStatus(s.nodes.n1, s)).toBe("scored");
    expect(nodeStatus(s.nodes.n2, s)).toBe("pruned");
    expect(s.nodes.n2.pruned?.kind).toBe("nogain");
    expect(s.warnings).toEqual([]);
  });

  it("normalises hotspots that use `function` and keeps a null fmax", () => {
    const s = reduceAll(smallRun());
    expect(s.baseline?.hotspots[0].symbol).toBe("hot");
    expect(s.baseline?.fmax_mhz).toBeNull();
  });

  it("keeps the counterexample after a repair and resets later stages on repair", () => {
    const events = smallRun();
    const mid = reduceAll(events.slice(0, events.findIndex((e) => e.type === "node.stage" && e.attempt === 1 && e.stage === "implement") + 1));
    const n = mid.nodes.n1;
    expect(n.stages.prove).toBeUndefined();
    expect(n.evidence[0].counterexample?.cycles).toBe(2);
    expect(nodeStatus(n, mid)).toBe("repairing");
    const done = reduceAll(events).nodes.n1;
    expect(done.evidence).toHaveLength(1);
    expect(done.artifacts.rtl).toBe("module a2; endmodule");
    expect(done.artifactsByAttempt[0].rtl).toBe("module a; endmodule");
    expect(done.artifacts.patch_diff).toBe("--- a\n+++ b");
  });

  it("derives the ladder, with prior failures attached to their rung", () => {
    const s = reduceAll(smallRun());
    const l = ladderFor(s.nodes.n1);
    expect(l.map((r) => r.status)).toEqual(["pass", "pass", "pass", "pass", "pass", "not-run"]);
    expect(l[2].failures).toEqual([{ attempt: 0, detail: "cex" }]);
    const n2 = ladderFor(s.nodes.n2);
    expect(n2.map((r) => r.status)).toEqual(["pass", "pass", "not-run", "pass", "not-run", "not-run"]);
    expect(stageStrip(s.nodes.n2).find((x) => x.stage === "bench")?.status).toBe("fail");
  });

  it("counts cost by model and role, and sandboxes by op", () => {
    const s = reduceAll(smallRun());
    expect(s.usage.total.calls).toBe(1);
    expect(s.usage.byModel["nemotron-super"].costUsd).toBeCloseTo(0.00075);
    expect(s.usage.byRole.implement.tokensOut).toBe(500);
    expect(s.sandboxes).toMatchObject({ active: 0, peak: 2, total: 2, succeeded: 1, failed: 1 });
    expect(s.nodes.n1.usage.calls).toBe(1);
  });

  it("ignores duplicate events (SSE reconnect) and is incremental", () => {
    const events = smallRun();
    const whole = reduceAll(events);
    let inc = initialRunState();
    for (const e of events) inc = applyEvents(inc, [e]);
    inc = applyEvents(inc, events.slice(5, 12)); // replayed duplicates
    expect(inc.eventCount).toBe(whole.eventCount);
    expect(inc.usage.total.costUsd).toBeCloseTo(whole.usage.total.costUsd);
    expect(inc.sandboxes.total).toBe(whole.sandboxes.total);
  });

  it("never mutates the previous state", () => {
    const events = smallRun();
    const a = reduceAll(events.slice(0, 14));
    const snapshot = JSON.stringify(a);
    applyEvents(a, events.slice(14));
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it("records a warning instead of throwing on a stage for an unknown node", () => {
    const s = reduceAll([ev("node.stage", { node_id: "ghost", stage: "lint", status: "pass", attempt: 0 })]);
    expect(s.warnings[0]).toMatch(/unknown node ghost/);
  });

  it("treats best_node_id = root as no improvement", () => {
    seq = 0;
    const s = reduceAll([
      ev("node.created", { node_id: "root", parent_id: null, depth: 0, proposal: null, instruction_set: [] }),
      ev("run.completed", { best_node_id: "root", pareto: [], totals: { nodes: 0, sandboxes: 0, cost_usd: 0, tokens: 0, wall_s: 0 }, report: {} }),
    ]);
    expect(s.best).toBeNull();
    expect(s.status).toBe("completed");
  });
});

describe("r_mock_demo replay", () => {
  const events = load("r_mock_demo");
  const s = reduceAll(events);

  it("conforms to the event contract", () => {
    expect(validateStream(events)).toEqual([]);
  });

  it("reproduces the real golden-path numbers on the winner", () => {
    expect(s.best).toBe("n1");
    const n1 = s.nodes.n1;
    expect(n1.proposal?.mnemonic).toBe("dot4.s8");
    expect(n1.score?.cycles).toBe(228_382);
    expect(n1.score?.speedup).toBe(3.77);
    expect(n1.score?.area_delta_pct).toBe(3.16);
    expect(s.baseline?.cycles).toBe(860_730);
    expect(s.baseline?.luts).toBe(1_993);
    expect(s.baseline?.hotspots[0]).toMatchObject({ symbol: "tm_dot_prod", line_start: 26, line_end: 37, pct: 95.7 });
    expect(n1.evidence.find((x) => x.stage === "prove")?.counterexample?.signals.length).toBeGreaterThan(4);
    expect(ladderFor(n1).slice(0, 5).every((r) => r.status === "pass")).toBe(true);
  });

  it("has the shape the brief asks for", () => {
    const c = counts(s);
    expect(c.candidates).toBeGreaterThanOrEqual(30);
    expect(Math.max(...s.order.map((id) => s.nodes[id].depth))).toBe(3);
    expect(s.config).toMatchObject({ k_root: 8, beam: 3, area_budget_pct: 5 });
    expect(c.budget).toBeGreaterThan(0);
    expect(c.failed).toBeGreaterThan(0);
    expect(c.nogain).toBeGreaterThan(0);
    expect(c.unproven).toBe(1);
    expect(s.sandboxes.peak).toBeLessThanOrEqual(50);
    expect(s.sandboxes.peak).toBeGreaterThan(30);
    const stagesFailed = new Set(s.order.flatMap((id) => s.nodes[id].attempts.map((a) => a.failed).filter(Boolean)));
    for (const st of ["lint", "unit", "e2e", "prove", "bench", "synth"]) expect(stagesFailed.has(st as never)).toBe(true);
  });

  it("agrees with its own run.completed totals", () => {
    const done = s.completed!;
    expect(done.totals.nodes).toBe(s.order.length - 1);
    expect(done.totals.sandboxes).toBe(s.sandboxes.total);
    expect(done.totals.cost_usd).toBeCloseTo(s.usage.total.costUsd, 3);
    expect(done.totals.tokens).toBe(s.usage.total.tokensIn + s.usage.total.tokensOut);
  });

  it("prices every Nemotron call at the listed rates", () => {
    const price = { "nemotron-ultra": [1, 3], "nemotron-super": [0.3, 0.9], "nemotron-nano": [0.06, 0.24] } as const;
    for (const e of events) {
      if (e.type !== "llm.call") continue;
      const [i, o] = price[e.model];
      expect(e.cost_usd).toBeCloseTo((e.tokens_in * i + e.tokens_out * o) / 1e6, 5);
    }
  });

  it("puts over-budget candidates on the frontier from their measured details", () => {
    const pts = frontier(s);
    expect(pts.find((p) => p.id === "n1")?.best).toBe(true);
    expect(pts.some((p) => p.kind === "budget" && p.areaPct > 5)).toBe(true);
    expect(lineage(s, "n2.1").map((n) => n.id)).toEqual(["root", "n2", "n2.1"]);
  });
});

describe("r_m4_first (real engine run)", () => {
  const events = load("r_m4_first");
  const s = reduceAll(events);

  it("has no contract errors (only known warnings)", () => {
    const issues = validateStream(events);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("renders every node as pruned with its reason, and no best", () => {
    expect(s.best).toBeNull();
    for (const id of ["n1", "n2", "n3"]) {
      expect(nodeStatus(s.nodes[id], s)).toBe("pruned");
      expect(s.nodes[id].pruned?.reason.length).toBeGreaterThan(5);
    }
    expect(s.nodes.n2.pruned?.kind).toBe("nogain");
    expect(s.nodes.n1.notes).toHaveLength(0);
    expect(s.nodes.root.notes[0].msg).toMatch(/^Ultra on root/);
    expect(s.baseline?.fmax_mhz).toBeNull();
    expect(s.warnings).toEqual([]);
  });
});
