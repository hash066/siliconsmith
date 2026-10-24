import { describe, expect, it } from "vitest";
import type { BoardCheck, MatterSimulation } from "./hosted";
import { boardLedger, matterLedger, siliconLedger } from "./ledger";

describe("ledger", () => {
  it("Matter: one row per check, a skipped rung is 'not run', never a pass", () => {
    const sim = { ladder: [{ id: "M1", status: "pass" }, { id: "M2", status: "pass" }, { id: "M3", status: "skipped" }, { id: "M4", status: "fail" }] } as unknown as MatterSimulation;
    const rows = matterLedger(sim);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.result)).toEqual(["pass", "pass", "not run", "fail", "not run"]);
    expect(matterLedger(null).every((r) => r.result === "not run")).toBe(true);
  });
  it("Board: names KiCad and the router when a layout exists, and says 'not run' when it does not", () => {
    const check = { rungs: [{ rung: "B1", status: "pass" }, { rung: "B4", status: "fail" }] } as unknown as BoardCheck;
    const withLayout = boardLedger({ check, layout: { status: "ready", routed: true, drcErrors: 0, kicad: "7.0.11", router: "Freerouting 1.9.0" } });
    expect(withLayout.find((r) => r.tool.includes("KiCad 7.0.11"))?.result).toBe("pass");
    expect(withLayout.find((r) => r.what.startsWith("Firmware pins"))?.result).toBe("fail");
    const none = boardLedger({ check, layout: { status: "none" } });
    expect(none.find((r) => r.tool.includes("KiCad"))?.result).toBe("not run");
    expect(boardLedger({ check, layout: { status: "ready", routed: false, unrouted: 2, drcErrors: 3 } }).filter((r) => r.result === "fail").length).toBeGreaterThanOrEqual(3);
  });
  it("Silicon: stage results and tool versions, with the wall-clock step honestly not run in a live run", () => {
    const node = { stages: { lint: { status: "pass" }, unit: { status: "pass" }, prove: { status: "fail" } } } as never;
    const rows = siliconLedger(node, { verilator: "Verilator 5.053 devel", yosys: "Yosys 0.50 (git)" });
    expect(rows.find((r) => r.what.includes("independent spec"))?.result).toBe("fail");
    expect(rows.find((r) => r.what.includes("builds cleanly"))?.tool).toContain("Verilator 5.053");
    const last = rows[rows.length - 1];
    expect(last.result).toBe("not run");
    expect(last.note).toContain("Not run in a live run");
  });
});
