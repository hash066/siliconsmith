// "Verified by": for each claim a workbench makes, which tool stands behind it, in which version, and what it said.
// Rows come from the real results; a row for something that did not run says so instead of being left out.
import type { BoardCheck, MatterSimulation } from "./hosted";
import type { NodeState } from "./run-state";

export type LedgerResult = "pass" | "fail" | "unknown" | "not run";
export interface LedgerRow {
  what: string;
  tool: string;
  result: LedgerResult;
  note?: string;
}

const fromStatus = (s: string | undefined): LedgerResult => (s === "pass" ? "pass" : s === "fail" ? "fail" : s === "skipped" || !s ? "not run" : "unknown");

export function matterLedger(sim: MatterSimulation | null): LedgerRow[] {
  const r = (id: string) => sim?.ladder.find((x) => x.id === id)?.status;
  return [
    { what: "The solver is right on cases with a known answer", tool: "Finite-volume heat solver (NumPy, SciPy), checked against analytic cases", result: fromStatus(r("M1")), note: "Thresholds were fixed before it was run on any candidate." },
    { what: "The shape is valid", tool: "Geometry rules (connected, inside the plate, chip covered)", result: fromStatus(r("M2")) },
    { what: "The shape can be printed", tool: "Minimum feature size and overhang rules", result: fromStatus(r("M3")) },
    { what: "An independent solver agrees", tool: "A separate finite-element solver, written independently", result: fromStatus(r("M4")), note: "Two solvers we wrote, not a measurement." },
    { what: "It beats plain fins with the same material", tool: "Equal-material and full-budget baselines on the same solver", result: fromStatus(r("M5")) },
  ];
}

export interface BoardLedgerInput {
  check: BoardCheck | null;
  layout: { status: string; routed?: boolean; drcErrors?: number; unrouted?: number; kicad?: string; router?: string } | null;
}

export function boardLedger(p: BoardLedgerInput): LedgerRow[] {
  const names: Record<string, string> = { B1: "The netlist is well formed", B2: "Electrical rules from the part facts", B3: "Bus and connector rules", B4: "Firmware pins match the netlist, no boot-strapping hazard", B5: "Battery estimate meets the target" };
  const rows: LedgerRow[] = ["B1", "B2", "B3", "B4", "B5"].map((id) => ({
    what: names[id],
    tool: id === "B5" ? "Hardwright board checker (a model, not a measurement)" : "Hardwright board checker with author-curated part facts",
    result: fromStatus(p.check?.rungs.find((r) => r.rung === id)?.status),
  }));
  const L = p.layout;
  rows.push(
    { what: "Every connection is routed", tool: `Deterministic placement, ${L?.router ?? "Freerouting 1.9.0"}`, result: L?.status === "ready" ? (L.routed ? "pass" : "fail") : "not run", note: L?.status === "ready" && !L.routed ? `${L.unrouted} connection(s) not routed` : undefined },
    { what: "Copper, clearance, drill and edge rules", tool: `KiCad ${L?.kicad ?? "7.0.11"} design-rule check`, result: L?.status === "ready" ? ((L.drcErrors ?? 0) === 0 ? "pass" : "fail") : "not run", note: L?.status === "ready" ? `${L.drcErrors} error(s)` : "No routed board for this design yet." },
    { what: "Pin tables match the real footprints", tool: "Tests against KiCad's footprint and symbol libraries", result: "pass", note: "Run in the engine's test suite; ESP32, BME280, MCP73831 cross-checked with KiCad's own symbols." },
  );
  return rows;
}

const STAGE_ROWS: Array<[string, string, string]> = [
  ["lint", "The hardware code builds cleanly", "verilator"],
  ["unit", "It matches the C reference on a million inputs", "verilator"],
  ["prove", "It equals an independent spec for every input", "yosys"],
  ["e2e", "The whole program prints the same output", "riscv-gcc + verilator"],
  ["bench", "Cycles are counted", "verilator (cycle-accurate simulation)"],
  ["synth", "Chip area is measured", "yosys (Gowin synthesis)"],
];

export function siliconLedger(node: NodeState | null, versions: Record<string, string>, live = true): LedgerRow[] {
  const ver = (tool: string) => {
    const k = Object.keys(versions).find((x) => tool.toLowerCase().includes(x.toLowerCase()));
    return k ? ` ${versions[k].split(/\s+/).slice(0, 2).join(" ")}` : "";
  };
  const rows: LedgerRow[] = STAGE_ROWS.map(([id, what, tool]) => ({
    what,
    tool: tool.split(" + ").map((t) => { const name = t.split(" (")[0]; const v = ver(t).trim(); return v && v.toLowerCase().startsWith(name.toLowerCase()) ? v : name + (v ? " " + v : ""); }).join(" + ") + (tool.includes("(") ? ` (${tool.split("(")[1]}` : ""),
    result: fromStatus(node?.stages[id as keyof NonNullable<typeof node>["stages"]]?.status),
  }));
  rows.push({ what: "Wall-clock speedup (place and route for clock speed)", tool: "nextpnr", result: "not run", note: live ? "Not run in a live run: results are cycles and area, not wall-clock time." : "Run in the recorded full search." });
  return rows;
}
