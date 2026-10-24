import { describe, expect, it } from "vitest";
import type { BoardCheck, MatterSimulation } from "./hosted";
import { boardWorkflow, combine, matterWorkflow, siliconWorkflow } from "./workflow";

const sim = (over: Partial<MatterSimulation> = {}): MatterSimulation =>
  ({
    ok: true,
    generator: "rect_fins",
    gen_params: { n_fins: 6 },
    spreader: { Q: 5, n: 40 },
    ladder: [
      { id: "M1", status: "pass" },
      { id: "M2", status: "pass" },
      { id: "M3", status: "pass" },
      { id: "M4", status: "pass" },
      { id: "M5", status: "fail" },
    ],
    first_failure: "M5",
    metrics: { peak_temp_c: 355.6, material_cells: 448, material_fraction: 0.28 },
    baselines: { equal_material: { peak_temp_c: 353.3, delta_k: -2.3, params: {}, cells: 448 }, full_budget: null },
    verdict: { label: "no better", delta_equal_material_k: -2.3 },
    ...over,
  }) as unknown as MatterSimulation;

const input = { generator: "rect_fins", gen_params: { n_fins: 6 }, spreader: { Q: 5, n: 40, h: 15 } };

describe("combine", () => {
  it("fails if any fails, runs if any runs, is done only when all are done", () => {
    expect(combine(["done", "fail"])).toBe("fail");
    expect(combine(["done", "running"])).toBe("running");
    expect(combine(["done", "done"])).toBe("done");
    expect(combine(["idle", "idle"])).toBe("idle");
    expect(combine([])).toBe("idle");
  });
});

describe("Matter workflow", () => {
  it("shows what happened, including a loss against plain fins", () => {
    const wf = matterWorkflow({ prompt: "A heat sink", sim: sim(), busy: false, stale: false, input, files: 2 });
    expect(wf.nodes.map((n) => n.id)).toEqual(["request", "setup", "shape", "solve", "verify", "files"]);
    const by = Object.fromEntries(wf.nodes.map((n) => [n.id, n]));
    expect(by.solve.summary).toContain("355.6");
    expect(by.verify.status).toBe("fail");
    expect(by.verify.summary).toContain("2.30 K hotter");
    expect(by.files.status).toBe("done");
    expect(wf.edges).toHaveLength(5);
  });
  it("a rejected shape skips the solve and says which check rejected it", () => {
    const wf = matterWorkflow({ prompt: "x", sim: sim({ metrics: {}, first_failure: "M2", ladder: [{ id: "M1", status: "pass" }, { id: "M2", status: "fail" }] as never }), busy: false, stale: false, input, files: 0 });
    const by = Object.fromEntries(wf.nodes.map((n) => [n.id, n]));
    expect(by.shape.status).toBe("fail");
    expect(by.shape.summary).toContain("M2");
    expect(by.solve.status).toBe("skipped");
    expect(by.files.status).toBe("idle");
  });
  it("nothing has run: every step waits, and a busy run shows running", () => {
    const idle = matterWorkflow({ prompt: "", sim: null, busy: false, stale: false, input, files: 0 });
    expect(idle.nodes.filter((n) => n.id !== "request").every((n) => n.status === "idle")).toBe(true);
    const busy = matterWorkflow({ prompt: "", sim: null, busy: true, stale: false, input, files: 0 });
    expect(busy.nodes.find((n) => n.id === "solve")?.status).toBe("running");
  });
});

describe("Board workflow", () => {
  const check = (statuses: string[]): BoardCheck => ({ ok: true, passed: statuses.every((s) => s === "pass"), ladder: [], rungs: statuses.map((s, i) => ({ rung: `B${i + 1}`, status: s, label: null, detail: "", evidence: [], findings: [] })), labels: [], evidence: {}, header: "", notice: "" }) as unknown as BoardCheck;
  const design = { instances: [1, 2, 3], nets: [1, 2] };
  it("a failing check fails its step, the routed layout is its own branch, and both feed the files", () => {
    const wf = boardWorkflow({ prompt: "p", design, check: check(["pass", "pass", "pass", "fail", "pass"]), busy: false, stale: false, layout: { status: "ready", routed: true, drcErrors: 0, drcWarnings: 15, boardMm: [48, 36], tracks: 184 }, files: 9 });
    const by = Object.fromEntries(wf.nodes.map((n) => [n.id, n]));
    expect(by.checks.status).toBe("fail");
    expect(by.checks.items?.find((i) => i.label.includes("B4"))?.status).toBe("fail");
    expect(by.layout.status).toBe("done");
    expect(by.layout.summary).toContain("48 × 36");
    expect(wf.edges.filter((e) => e.to === "files").map((e) => e.from).sort()).toEqual(["checks", "layout"]);
  });
  it("a design with no routed board is skipped, not faked", () => {
    const wf = boardWorkflow({ prompt: "p", design, check: null, busy: false, stale: false, layout: { status: "none" }, files: 0 });
    const layout = wf.nodes.find((n) => n.id === "layout")!;
    expect(layout.status).toBe("skipped");
    expect(layout.summary).toContain("No routed board");
  });
  it("unrouted connections or KiCad errors fail the layout step", () => {
    const wf = boardWorkflow({ prompt: "p", design, check: null, busy: false, stale: false, layout: { status: "ready", routed: false, unrouted: 2, drcErrors: 2, boardMm: [40, 40], tracks: 10 }, files: 0 });
    expect(wf.nodes.find((n) => n.id === "layout")?.status).toBe("fail");
  });
});

describe("Silicon workflow", () => {
  it("before a run every step waits", () => {
    const wf = siliconWorkflow({ prompt: "", phase: "idle", node: null, files: 0, workload: "w1" });
    expect(wf.nodes.map((n) => n.id)).toEqual(["request", "propose", "implement", "verify", "result"]);
    expect(wf.nodes.every((n) => n.status === "idle")).toBe(true);
  });
  it("a finished verified run shows the proof stages and the speedup", () => {
    const node = {
      proposal: { mnemonic: "dot4.i8", title: "4-lane dot product" },
      stages: { implement: { status: "pass" }, lint: { status: "pass" }, unit: { status: "pass" }, prove: { status: "pass" }, e2e: { status: "pass" }, bench: { status: "pass" }, synth: { status: "pass" } },
      score: { feasible: true, speedup: 3.32 },
    } as never;
    const wf = siliconWorkflow({ prompt: "Make it faster", phase: "done", node, files: 5, workload: "w1" });
    const by = Object.fromEntries(wf.nodes.map((n) => [n.id, n]));
    expect(by.verify.status).toBe("done");
    expect(by.result.summary).toContain("3.32");
    expect(by.propose.summary).toContain("dot4.i8");
  });
  it("a failed proof stage fails the verify step", () => {
    const node = { proposal: { mnemonic: "x" }, stages: { implement: { status: "pass" }, lint: { status: "pass" }, unit: { status: "fail" } }, score: null } as never;
    const wf = siliconWorkflow({ prompt: "", phase: "done", node, files: 0, workload: "w1" });
    expect(wf.nodes.find((n) => n.id === "verify")?.status).toBe("fail");
    expect(wf.nodes.find((n) => n.id === "result")?.status).toBe("warn");
  });
});
