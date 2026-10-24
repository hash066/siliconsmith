import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentsOf, planCsv, scenarioCode, scenariosOf, type RunLike } from "./silicon-plan";
import { parseViews } from "./silicon-views";

const views = parseViews(readFileSync(join(__dirname, "__fixtures__", "silicon-views-live.json"), "utf8"))!;
const u = (calls: number, costUsd = 0) => ({ calls, tokensIn: calls * 1000, tokensOut: calls * 100, costUsd, latencyMs: calls * 2000 });

describe("agents of a run", () => {
  const run: RunLike = { usage: { total: u(3, 0.04), byRole: { architect: u(1, 0.02), implement: u(2, 0.02) } }, sandboxes: { active: 0, total: 2, succeeded: 2, failed: 0 } };
  it("adds up each agent's roles and shows who was not needed", () => {
    const a = Object.fromEntries(agentsOf(run, "done").map((x) => [x.id, x]));
    expect(a.architect).toMatchObject({ status: "done", calls: 1, model: "Nemotron 3 Ultra" });
    expect(a.engineer).toMatchObject({ status: "done", calls: 2, tokens: 2200 });
    expect(a.triage).toMatchObject({ status: "not needed", calls: 0 });
    expect(a.prover).toMatchObject({ status: "done", calls: 2 });
    expect(a.prover.note).toContain("2 succeeded");
  });
  it("while running, an agent that has worked shows working; before a run everyone waits", () => {
    expect(agentsOf(run, "running").find((x) => x.id === "architect")!.status).toBe("working");
    const idle = agentsOf({ usage: { total: u(0), byRole: {} }, sandboxes: { active: 0, total: 0, succeeded: 0, failed: 0 } }, "idle");
    expect(idle.every((x) => x.status === "waiting")).toBe(true);
    expect(agentsOf({ ...run, sandboxes: { ...run.sandboxes, active: 1 } }, "running").find((x) => x.id === "prover")!.status).toBe("working");
  });
});

describe("scenarios from the real run", () => {
  const s = scenariosOf(views);
  it("one per simulated operand pair, named, all passing", () => {
    expect(s).toHaveLength(views.rows.length);
    expect(s[0]).toMatchObject({ title: "All zeros", rs1: 0, rs2: 0, passed: true });
    expect(s.every((x) => x.passed && x.description.length > 10)).toBe(true);
    expect(s[2].hardware).toBe(10);
  });
  it("code shows the call and the verdict", () => {
    const c = scenarioCode(s[2], "dot4");
    expect(c).toContain("ss_dot4(rs1, rs2)");
    expect(c).toContain("0x01020304");
    expect(c).toContain("PASSED");
  });
  it("exports a CSV with a header and one row each, and shows a failure as one", () => {
    const csv = planCsv(s).trim().split("\n");
    expect(csv[0]).toBe("scenario,rs1,rs2,hardware_rd,reference_rd,result");
    expect(csv).toHaveLength(s.length + 1);
    expect(planCsv([{ ...s[0], hardware: 1, passed: false }])).toContain("FAILED");
  });
});
