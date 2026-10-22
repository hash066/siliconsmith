// Views over a non-silicon run (Board, Matter): the rung list, per-node rung status, and the figures the canvases show.
// Everything comes from the v2 events in the RunState; unknown is never counted as pass.

import type { LadderRung } from "./events";
import type { NodeState, RunState } from "./run-state";

export type CellStatus = "pass" | "fail" | "unknown" | "running" | "pending";

export interface RungCell {
  rung: string;
  status: CellStatus;
  detail?: string;
  evidence: string[];
  /** The ladder's claim for this rung. Present only when the rung passed (a label is a claim). */
  claim?: string;
  seq?: number;
  attempt?: number;
}

/** Rungs from `run.started.ladder`; if a stream omitted it, the ids seen in node.scored events, in first-seen order. */
export function rungsOf(s: RunState): LadderRung[] {
  if (s.ladderSpec?.length) return s.ladderSpec;
  const seen: string[] = [];
  for (const id of s.order) for (const k of Object.keys(s.nodes[id].domainScore?.ladder ?? {})) if (!seen.includes(k)) seen.push(k);
  return seen.map((id) => ({ id, label: id }));
}

/** Nodes that are designs/candidates (not the root), in creation order. */
export function candidates(s: RunState): NodeState[] {
  return s.order.map((id) => s.nodes[id]).filter((n) => n.parentId !== null);
}

export function rungCell(n: NodeState, rung: LadderRung): RungCell {
  const rec = (n.stages as Record<string, { status: string; detail?: string; evidence?: string[]; label?: string; seq?: number; attempt: number } | undefined>)[rung.id];
  const scored = n.domainScore?.ladder[rung.id];
  let status: CellStatus;
  if (rec && (rec.status === "running" || rec.status === "queued")) status = rec.status === "running" ? "running" : "pending";
  else if (rec?.status === "pass") status = "pass";
  else if (rec?.status === "fail") status = "fail";
  else if (scored === "pass") status = "pass";
  else if (scored === "fail") status = "fail";
  else if (scored === "skipped" || rec?.status === "skipped") status = "unknown";
  else status = n.pruned || n.domainScore ? "unknown" : "pending";
  return {
    rung: rung.id,
    status,
    detail: rec?.detail,
    evidence: rec?.evidence ?? [],
    claim: status === "pass" ? (rec?.label ?? rung.label) : undefined,
    seq: rec?.seq,
    attempt: rec?.attempt,
  };
}

/** How many rungs pass for a node: "4 of 5". Unknown and not-run do not count. */
export function passCount(n: NodeState, rungs: LadderRung[]): { pass: number; total: number } {
  return { pass: rungs.filter((r) => rungCell(n, r).status === "pass").length, total: rungs.length };
}

export function allPass(n: NodeState, rungs: LadderRung[]): boolean {
  return rungs.length > 0 && rungs.every((r) => rungCell(n, r).status === "pass");
}

export interface MatterFigures {
  peakC: number | null;
  riseK: number | null;
  materialFraction: number | null;
  baselinePeakC: number | null;
  deltaK: number | null;
}

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function matterFigures(n: NodeState): MatterFigures {
  const m = n.domainScore?.metrics ?? {};
  return { peakC: numOrNull(m.peak_temp_c), riseK: numOrNull(m.peak_rise_k), materialFraction: numOrNull(m.material_fraction), baselinePeakC: numOrNull(m.baseline_peak_c), deltaK: numOrNull(m.delta_vs_baseline_k) };
}

/** Convention for a file shipped next to a replay: public/replays/<run_id>/nodes/<node_id>/<name> (docs/contracts/events.md, v2). */
export const replayFileUrl = (runId: string, nodeId: string, name: string) => `/replays/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/${name}`;
