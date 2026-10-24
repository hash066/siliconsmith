// Evidence references: what stands behind a number the UI shows. Built only from the event stream
// (the scored/timing event that carries the number, the run's config, the rung tools in labels.ts).
// Nothing here is invented: a field the stream does not carry is null, and the UI says so.

import type { NodeId } from "./events";
import { int, mhz, pct, times } from "./format";
import { RUNG_TOOL } from "./labels";
import { rungCell, rungsOf } from "./domain";
import type { BoardCheck, BoardFact, MatterSimulation } from "./hosted";
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

/** Evidence behind one rung result of a Board or Matter node (v2 domains). */
export interface RungEvidenceRef {
  kind: "rung";
  rung: string;
  /** Neutral name for the row ("B4 · board.checks.run_b4"); the claim label is only in `claim`. */
  tool: string;
  status: "pass" | "fail" | "unknown" | "running" | "pending";
  detail: string | null;
  /** The ladder's claim, only when the rung passed. */
  claim: string | null;
  /** Fact ids the check cited (for example "part:esp32.gpio12.strapping"). */
  facts: string[];
  /** null for a live call to a hosted check (not a recorded run). */
  runId: string | null;
  nodeId: string | null;
  seq: number | null;
  domain: string;
  runHref: string | null;
  replayPath: string | null;
  /** Where the result came from, when it is not a recorded run (for example "hosted check, this call"). */
  origin?: string;
}

/** One curated fact a Board check cited, resolved by the hosted function (text and provenance). */
export interface FactEvidenceRef {
  kind: "fact";
  id: string;
  part: string;
  origin: string;
  text: string;
  source: string | null;
  section: string | null;
  citationChecked: boolean;
  url: string | null;
  usedByRung: string | null;
}

export function buildFactEvidence(f: BoardFact, usedByRung: string | null): FactEvidenceRef {
  return { kind: "fact", id: f.id, part: f.part, origin: f.origin, text: f.text, source: f.source, section: f.section, citationChecked: f.citation_checked, url: f.url, usedByRung };
}

/** A rung of a live Board check (hosted function), as drawer evidence. */
export function boardRungEvidence(check: BoardCheck, rungId: string): RungEvidenceRef | null {
  const r = check.rungs.find((x) => x.rung === rungId);
  const spec = check.ladder.find((x) => x.id === rungId);
  if (!r) return null;
  return {
    kind: "rung",
    rung: r.rung,
    tool: spec?.tool ?? "not recorded",
    status: r.status,
    detail: r.detail || null,
    claim: r.status === "pass" ? r.label : null,
    facts: r.evidence,
    runId: null,
    nodeId: null,
    seq: null,
    domain: "board",
    runHref: null,
    replayPath: null,
    origin: "Hosted Board check, this call (deterministic code, no model)",
  };
}

/** A rung of a live Matter simulation (hosted function), as drawer evidence. */
export function matterRungEvidence(sim: MatterSimulation, rungId: string): RungEvidenceRef | null {
  const r = sim.ladder.find((x) => x.id === rungId);
  if (!r) return null;
  return {
    kind: "rung",
    rung: r.id,
    tool: r.check,
    status: r.status === "skipped" ? "unknown" : r.status,
    detail: r.detail || null,
    claim: r.status === "pass" ? r.label : null,
    facts: [],
    runId: null,
    nodeId: null,
    seq: null,
    domain: "matter",
    runHref: null,
    replayPath: null,
    origin: `Hosted Matter simulation, this call (${sim.source}; ${sim.timings_ms} ms)`,
  };
}

export function buildRungEvidence(s: RunState, nodeId: string, rungId: string, source: "replay" | "live" = "replay"): RungEvidenceRef | null {
  const n = s.nodes[nodeId];
  const rung = rungsOf(s).find((r) => r.id === rungId);
  if (!n || !rung || !s.runId) return null;
  const c = rungCell(n, rung);
  return {
    kind: "rung",
    rung: rung.id,
    tool: rung.tool ?? "not recorded",
    status: c.status,
    detail: c.detail ?? null,
    claim: c.claim ?? null,
    facts: c.evidence,
    runId: s.runId,
    nodeId,
    seq: c.seq ?? null,
    domain: s.domain,
    runHref: `/workstation?run=${s.runId}&node=${nodeId}`,
    origin: undefined,
    replayPath: source === "replay" ? `web/public/replays/${s.runId}.ndjson` : null,
  };
}
