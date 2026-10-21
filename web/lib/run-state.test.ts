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

describe("r_w1_final (real engine run, W1 TinyMaix)", () => {
  const events = load("r_w1_final");
  const s = reduceAll(events);

  it("has no contract errors", () => {
    expect(validateStream(events).filter((i) => i.level === "error")).toEqual([]);
  });

  it("reproduces the real numbers on the winner, with Fmax folded in from node.timing", () => {
    expect(s.best).toBe("n1.1.1");
    const n = s.nodes["n1.1.1"];
    expect(n.proposal?.kind).toBe("software");
    expect(n.score?.cycles).toBe(213_022);
    expect(n.score?.area_delta_pct).toBe(3.16);
    expect(n.timing?.seeds).toBe(3);
    expect(n.score?.wall_speedup).toBe(n.timing?.wall_speedup);
    expect(s.baseline?.cycles).toBe(860_730);
    expect(s.baseline?.fmax_mhz).toBe(71.03);
  });

  it("inherits the proof for software polish and agrees with run.completed", () => {
    expect(s.nodes["n1.1.1"].stages.prove?.status).toBe("skipped");
    const done = s.completed!;
    expect(done.totals.nodes).toBe(s.order.length - 1);
    expect(done.totals.cost_usd).toBeCloseTo(s.usage.total.costUsd, 3);
    expect(done.totals.tokens).toBe(s.usage.total.tokensIn + s.usage.total.tokensOut);
    expect(s.usage.byRole.polish.calls).toBeGreaterThan(0);
  });

  it("prices every Nemotron call at the listed rates", () => {
    const price = { "nemotron-ultra": [1, 3], "nemotron-super": [0.3, 0.9], "nemotron-nano": [0.06, 0.24] } as const;
    for (const e of events) {
      if (e.type !== "llm.call") continue;
      const [i, o] = price[e.model];
      expect(e.cost_usd).toBeCloseTo((e.tokens_in * i + e.tokens_out * o) / 1e6, 5);
    }
  });

  it("builds lineages through polish nodes", () => {
    expect(lineage(s, "n1.1.1").map((n) => n.id)).toEqual(["root", "n1", "n1.1", "n1.1.1"]);
    expect(frontier(s).some((p) => p.id === "n1.1.1" && p.best)).toBe(true);
  });
});

describe("r_w2_final3 (real engine run, W2 ChaCha20)", () => {
  const events = load("r_w2_final3");
  const s = reduceAll(events);

  it("has no contract errors", () => {
    expect(validateStream(events).filter((i) => i.level === "error")).toEqual([]);
  });

  it("finds the stacked xor-rotate instructions", () => {
    expect(s.best).toBe("n2.4.1");
    expect(s.nodes[s.best!].score?.cycles).toBe(102_851);
    expect(s.nodes[s.best!].instructionSet).toHaveLength(2);
    expect(nodeStatus(s.nodes["n3.1.1"], s)).toBe("pruned");
  });
});

describe("r_m4_second (real engine run before the polish phase)", () => {
  const events = load("r_m4_second");
  const s = reduceAll(events);

  it("has no contract errors and keeps the formal-proof rejection", () => {
    expect(validateStream(events).filter((i) => i.level === "error")).toEqual([]);
    expect(s.nodes.n1.score?.speedup).toBeGreaterThan(3);
    expect(s.nodes.n3.pruned?.reason).toMatch(/formal counterexample/);
  });
});
