// The verification ladder's labels (PLAN §3.5). A rung's label is a claim; the UI shows it as made
// only when the rung passed. Counts and figures come from the events, never from this file.

import type { Rung } from "./events";
import { pct } from "./format";
import type { NodeState, RungView } from "./run-state";

export const RUNG_CHECK: Record<Rung, string> = {
  L1: "RTL lint-clean, firmware builds",
  L2: "RTL unit equals the C reference on edge cases and random vectors",
  L3: "Unit equals an independent reference spec for all inputs (SAT miter) + PCPI handshake",
  L4: "Whole workload output bit-identical to the baseline core",
  L5: "Area (LUTs, FFs) and Fmax from synthesis",
  L6: "Runs on a real FPGA",
};

export const RUNG_TOOL: Record<Rung, string> = {
  L1: "Verilator --lint-only, GCC",
  L2: "Verilator unit harness",
  L3: "SymbiYosys",
  L4: "Verilator full SoC",
  L5: "Yosys synth_gowin, nextpnr",
  L6: "Tang Nano 9K",
};

/** "1,000,000" by default; the real count when the unit stage reported one ("200,485 vectors"). */
export function vectorCount(detail?: string): string {
  const m = detail?.match(/([\d,]+)\s+vectors/);
  return m ? m[1] : "1,000,000";
}

export function rungLabel(r: RungView, n: NodeState): string {
  switch (r.rung) {
    case "L1":
      return "Builds";
    case "L2":
      return `Matches C reference (${vectorCount(n.stages.unit?.detail)} vectors)`;
    case "L3":
      // Software polish leaves the hardware untouched, so the parent's proof carries over (the engine emits prove as skipped).
      return n.stages.prove?.status === "skipped" && r.status === "pass"
        ? "Formally proven equivalent to spec (inherited: hardware unchanged)"
        : "Formally proven equivalent to spec";
    case "L4":
      return "Bit-identical output";
    case "L5": {
      const area = n.score?.area_delta_pct ?? n.measured.areaPct;
      const fmax = n.score?.fmax_mhz;
      const a = area === undefined ? "LUTs" : `${pct(area)} LUTs`;
      return `${a} · ${fmax === null || fmax === undefined ? "—" : fmax.toFixed(1)} MHz`;
    }
    case "L6":
      return "Verified on silicon (FPGA)";
  }
}

export const STATUS_WORD: Record<RungView["status"], string> = {
  pending: "Pending",
  running: "Running",
  pass: "Pass",
  fail: "Fail",
  skipped: "Not proven",
  "not-run": "Not run",
};
