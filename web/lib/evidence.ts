// Evidence references: what stands behind a number the UI shows. Built only from the event stream
// (the scored/timing event that carries the number, the run's config, the rung tools in labels.ts).
// Nothing here is invented: a field the stream does not carry is null, and the UI says so.

import type { NodeId } from "./events";
import { int, mhz, pct, times } from "./format";
import { RUNG_TOOL } from "./labels";
import { wallOf, type RunState } from "./run-state";

export type EvidenceMetric = "wall_speedup" | "cycles" | "area" | "fmax";

export interface EvidenceRef {
  metric: EvidenceMetric;
  label: string;
  /** The number exactly as displayed. */
  value: string;
  tool: string;
  /** From `run.started.tool_versions`; null when the stream does not record one. */
  version: string | null;
  runId: string;
  nodeId: NodeId;
  /** Sequence numbers of the events that carry this number. */
  seqs: number[];
  /** How the number was derived, in one sentence. */
  basis: string;
  /** A command that repeats the search; null when the stream does not say enough to build one. */
  command: string | null;
  /** Where the exact event record lives (replays only). */
  replayPath: string | null;
  runHref: string;
}

const METRIC_LABEL: Record<EvidenceMetric, string> = {
  wall_speedup: "Wall-clock speedup",
  cycles: "Cycles",
  area: "Area change",
  fmax: "Fmax",
};

/** Engine workload ids look like "w1_tinymaix_fc"; the CLI takes the short id ("w1"). */
export function cliWorkload(workloadId: string | undefined): string | null {
  const m = workloadId?.match(/^(w\d+)(?:_|$)/);
  return m ? m[1] : null;
}

/** `siliconsmith accelerate ...` with the flags the run's own config recorded. Null if the workload id is not a CLI id. */
export function reproduceCommand(s: RunState): string | null {
  const wl = cliWorkload(s.workload?.id);
  const c = s.config;
  if (!wl || !c) return null;
  const parts = ["siliconsmith", "accelerate", wl, `--area-budget ${c.area_budget_pct}`, `--k ${c.k_root}`, `--k-child ${c.k_child}`, `--beam ${c.beam}`, `--depth ${c.max_depth}`, `--concurrency ${c.max_concurrency}`];
  if (s.backend === "local" || s.backend === "contree") parts.push(`--backend ${s.backend}`);
  parts.push(`--run-id ${s.runId ?? "<new>"}`);
  return parts.join(" ");
}

function versionFor(s: RunState, keys: string[]): string | null {
  const have = Object.entries(s.toolVersions);
  for (const k of keys) {
    const hit = have.find(([name]) => name.toLowerCase() === k.toLowerCase());
    if (hit) return hit[1];
  }
  return null;
}

export function buildEvidence(s: RunState, nodeId: NodeId, metric: EvidenceMetric, source: "replay" | "live" = "replay"): EvidenceRef | null {
  const n = s.nodes[nodeId];
  const sc = n?.score;
  const runId = s.runId;
  if (!n || !sc || !runId) return null;

  let value: string;
  let tool: string;
  let keys: string[];
  let basis: string;
  let seqs = [sc.seq];
  switch (metric) {
    case "wall_speedup": {
      value = times(wallOf(sc));
      if (n.timing) {
        seqs = [sc.seq, n.timing.seq];
        tool = `${RUNG_TOOL.L4}; ${RUNG_TOOL.L5}`;
        basis = `Cycle speedup (baseline cycles ÷ node cycles) times the Fmax ratio from ${n.timing.seeds} place-and-route seeds (median).`;
      } else {
        tool = RUNG_TOOL.L4;
        basis = "Baseline cycles ÷ node cycles. Fmax was not measured for this node, so wall-clock equals cycle speedup.";
      }
      keys = ["verilator", "nextpnr"];
      break;
    }
    case "cycles":
      value = int(sc.cycles);
      tool = RUNG_TOOL.L4;
      keys = ["verilator"];
      basis = "Cycles to run the whole workload on the full SoC simulation, output bit-identical to the baseline.";
      break;
    case "area":
      value = pct(sc.area_delta_pct);
      tool = RUNG_TOOL.L5;
      keys = ["yosys"];
      basis = `LUT-equivalent change vs the baseline core (${int(sc.luts)} LUTs, ${int(sc.ffs)} FFs on this node).`;
      break;
    case "fmax": {
      const f = n.timing ? n.timing.fmax_mhz : sc.fmax_mhz;
      if (f === null || f === undefined) return null;
      value = `${mhz(f)} MHz`;
      tool = n.timing ? "nextpnr-himbaechel, Tang Nano 9K" : RUNG_TOOL.L5;
      keys = ["nextpnr"];
      basis = n.timing ? `Median of ${n.timing.seeds} place-and-route seeds; seed noise is about ±8%.` : "Estimate from synthesis; nextpnr timing was not run for this node.";
      if (n.timing) seqs = [n.timing.seq];
      break;
    }
  }
  return {
    metric,
    label: METRIC_LABEL[metric],
    value,
    tool,
    version: versionFor(s, keys),
    runId,
    nodeId,
    seqs,
    basis,
    command: reproduceCommand(s),
    replayPath: source === "replay" ? `web/public/replays/${runId}.ndjson` : null,
    runHref: `/runs/${runId}?node=${nodeId}`,
  };
}
