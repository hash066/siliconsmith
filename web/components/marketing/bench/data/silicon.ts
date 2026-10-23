// Extraction of the Bench's Silicon facts from a recorded run (public/replays/<run>.ndjson). No numbers are made up here:
// every field is copied from an event of the log, and a missing event leaves the field absent.

export const SILICON_RUN = "r_w1_contree3";
export const SILICON_REPLAY_URL = `/replays/${SILICON_RUN}.ndjson`;

export interface Hotspot {
  fn: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  pct: number;
  fetches: number;
}

export type Outcome =
  | { kind: "scored"; speedup: number; areaDeltaPct: number; cycles: number; luts: number; feasible: boolean }
  | { kind: "pruned"; reason: string; short: string }
  | { kind: "unknown" };

export interface Candidate {
  nodeId: string;
  mnemonic: string;
  title: string;
  semanticsC: string;
  rationale: string;
  estSpeedup?: number;
  estAreaPct?: number;
  outcome: Outcome;
  /** Best scored descendant in the same run (for example n1 -> n1.2.1), when the node itself was scored. */
  bestDescendant?: { nodeId: string; speedup: number };
  /** True when the run's best node is this candidate or one of its descendants. */
  onWinningLine: boolean;
}

export interface SiliconData {
  runId: string;
  workloadTitle: string;
  sourceRepo?: string;
  baseline: { cycles: number; luts: number };
  hotspots: Hotspot[];
  candidates: Candidate[];
  bestNodeId?: string;
}

type Ev = Record<string, unknown> & { type?: string };

export function parseNdjson(text: string): Ev[] {
  const out: Ev[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as Ev);
    } catch {
      // a truncated last line must not hide the rest of the run
    }
  }
  return out;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** One plain sentence for a prune reason, never inventing a cause the log does not state. */
export function shortReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("rtl does not compile")) return "The generated hardware did not compile.";
  if (r.includes("rtl disagrees with c reference")) return "The generated hardware disagreed with the C definition of the instruction.";
  if (r.includes("patched software differs from the original")) return "The kernel patched to use it gave a different output than the original, so it was rejected.";
  if (r.includes("patched software does not compile")) return "The kernel patched to use it did not compile.";
  const m = reason.match(/^no speedup \(([\d.]+)x vs parent ([\d.]+)x\)/i);
  if (m) return `It measured ${m[1]}x against ${m[2]}x for its parent, so it was cut.`;
  if (r.startsWith("no area saving")) return "It saved no hardware over its parent.";
  return reason.split("\n")[0].slice(0, 140);
}

export function extractSilicon(events: Ev[]): SiliconData | null {
  const started = events.find((e) => e.type === "run.started");
  const base = events.find((e) => e.type === "run.baseline");
  if (!started || !base) return null;
  const rawSpots = Array.isArray(base.hotspots) ? (base.hotspots as Record<string, unknown>[]) : [];
  const hotspots: Hotspot[] = [];
  for (const h of rawSpots) {
    const fn = str(h.function), file = str(h.file), ls = num(h.line_start), le = num(h.line_end), pct = num(h.pct);
    if (fn && file && ls !== undefined && le !== undefined && pct !== undefined) hotspots.push({ fn, file, lineStart: ls, lineEnd: le, pct, fetches: num(h.fetches) ?? 0 });
  }
  if (!hotspots.length) return null;

  const scored = new Map<string, Outcome & { kind: "scored" }>();
  const pruned = new Map<string, string>();
  let bestNodeId: string | undefined;
  for (const e of events) {
    const id = str(e.node_id);
    if (e.type === "node.scored" && id) {
      const speedup = num(e.speedup);
      if (speedup !== undefined) scored.set(id, { kind: "scored", speedup, areaDeltaPct: num(e.area_delta_pct) ?? 0, cycles: num(e.cycles) ?? 0, luts: num(e.luts) ?? 0, feasible: e.feasible === true });
    } else if (e.type === "node.pruned" && id) pruned.set(id, str(e.reason) ?? "pruned");
    else if (e.type === "run.completed") bestNodeId = str(e.best_node_id);
  }

  const candidates: Candidate[] = [];
  for (const e of events) {
    if (e.type !== "node.created" || e.depth !== 1) continue;
    const p = e.proposal as Record<string, unknown> | null;
    const id = str(e.node_id);
    if (!p || !id || p.kind !== "instruction") continue;
    const own = scored.get(id);
    let outcome: Outcome = { kind: "unknown" };
    if (own) outcome = own;
    else if (pruned.has(id)) outcome = { kind: "pruned", reason: pruned.get(id)!, short: shortReason(pruned.get(id)!) };
    let bestDescendant: Candidate["bestDescendant"];
    if (own) {
      for (const [nid, s] of scored) if (nid.startsWith(id + ".") && s.speedup > (bestDescendant?.speedup ?? own.speedup)) bestDescendant = { nodeId: nid, speedup: s.speedup };
    }
    candidates.push({
      nodeId: id,
      mnemonic: str(p.mnemonic) ?? id,
      title: str(p.title) ?? "",
      semanticsC: str(p.semantics_c) ?? "",
      rationale: str(p.rationale) ?? "",
      estSpeedup: num(p.est_speedup),
      estAreaPct: num(p.est_area_pct),
      outcome,
      bestDescendant,
      onWinningLine: !!bestNodeId && (bestNodeId === id || bestNodeId.startsWith(id + ".")),
    });
  }
  if (!candidates.length) return null;

  const workload = (started.workload ?? {}) as Record<string, unknown>;
  return {
    runId: str(started.run_id) ?? SILICON_RUN,
    workloadTitle: str(workload.title) ?? "workload",
    sourceRepo: str(workload.source_repo),
    baseline: { cycles: num(base.cycles) ?? 0, luts: num(base.luts) ?? 0 },
    hotspots,
    candidates,
    bestNodeId,
  };
}

// ---------- scoring ----------

export type PickGrade = "winner" | "verified" | "pruned" | "unknown";

/** The verdict for the instruction the player picked. The winner is the candidate on the run's winning line. */
export function gradePick(c: Candidate): PickGrade {
  if (c.outcome.kind === "pruned") return "pruned";
  if (c.outcome.kind === "unknown") return "unknown";
  return c.onWinningLine ? "winner" : "verified";
}

/** Candidates ordered by what happened: winning line first, then scored by speedup, then pruned. Stable by node id. */
export function rankCandidates(cs: Candidate[]): Candidate[] {
  const key = (c: Candidate) => (c.outcome.kind === "scored" ? (c.onWinningLine ? 3 : 2) + c.outcome.speedup / 100 : 0);
  return [...cs].sort((a, b) => key(b) - key(a) || a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true }));
}

export type HuntGrade = "top" | "other" | "none";
export interface HuntResult {
  grade: HuntGrade;
  /** The hotspot the clicked line falls in, if any. */
  hit?: Hotspot;
  top: Hotspot;
}

export function topHotspot(hs: Hotspot[]): Hotspot {
  return hs.reduce((a, b) => (b.pct > a.pct ? b : a));
}

export function hotspotAt(hs: Hotspot[], file: string, line: number): Hotspot | undefined {
  const inside = hs.filter((h) => h.file === file && line >= h.lineStart && line <= h.lineEnd);
  // Ranges can nest in principle; the narrowest one is the most specific attribution.
  return inside.sort((a, b) => a.lineEnd - a.lineStart - (b.lineEnd - b.lineStart))[0];
}

export function scoreHunt(hs: Hotspot[], file: string, line: number): HuntResult {
  const top = topHotspot(hs);
  const hit = hotspotAt(hs, file, line);
  return { grade: !hit ? "none" : hit === top ? "top" : "other", hit, top };
}
