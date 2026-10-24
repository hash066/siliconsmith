// Plain-language verdicts and check cards. Everything here is derived from real verifier output; the only static text is the
// human title of each check (what the check is about), never a claim about a result.
import type { BoardCheck, MatterSimulation } from "@/lib/hosted";
import type { RunState } from "@/lib/run-state";
import { solvedOf } from "./useMatterBench";

/** green = passed every check that ran; amber = some checks unknown or limited; red = a check failed; working = a run is in progress. */
export type Tone = "idle" | "working" | "green" | "amber" | "red";
export interface Verdict {
  tone: Tone;
  title: string;
  detail?: string;
}
export interface CheckCard {
  id: string;
  title: string;
  state: "pass" | "fail" | "unknown";
  /** One plain sentence. */
  sentence: string;
  /** Fact or rung ids that stand behind the check (shown on demand). */
  evidence: string[];
}

export const MATTER_TITLES: Record<string, string> = {
  M1: "The simulation can be trusted",
  M2: "The shape is valid",
  M3: "It can be 3D printed",
  M4: "A second solver agrees",
  M5: "It beats plain fins",
};
export const BOARD_TITLES: Record<string, string> = {
  B1: "The design is well formed",
  B2: "Voltages and currents are safe",
  B3: "Buses and connectors are wired right",
  B4: "Firmware pins match the board",
  B5: "Battery life meets the target",
};

const firstSentence = (s: string, max = 200) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const f1 = (n: number, d = 1) => n.toFixed(d);

export function matterChecks(sim: MatterSimulation): CheckCard[] {
  return sim.ladder.map((r) => {
    const title = MATTER_TITLES[r.id] ?? r.id;
    if (r.status === "pass") return { id: r.id, title, state: "pass", sentence: r.label ?? "Passed.", evidence: [r.id] };
    if (r.status === "fail") return { id: r.id, title, state: "fail", sentence: r.detail ? firstSentence(r.detail) : "This check did not pass.", evidence: [r.id] };
    return { id: r.id, title, state: "unknown", sentence: "Not checked: an earlier check failed.", evidence: [r.id] };
  });
}

export function boardChecks(c: BoardCheck): CheckCard[] {
  return c.rungs.map((r) => {
    const title = BOARD_TITLES[r.rung] ?? r.rung;
    if (r.status === "pass") return { id: r.rung, title, state: "pass", sentence: r.label ?? "Passed.", evidence: r.evidence };
    if (r.status === "fail") return { id: r.rung, title, state: "fail", sentence: r.detail ? firstSentence(r.detail) : "This check did not pass.", evidence: r.evidence };
    return { id: r.rung, title, state: "unknown", sentence: r.detail ? firstSentence(r.detail) : "Could not be decided, so it does not count as passed.", evidence: r.evidence };
  });
}

export function matterVerdict(p: { sim: MatterSimulation | null; busy: boolean; stale: boolean; failed: string | null }): Verdict {
  if (p.busy) return { tone: "working", title: "Simulating…" };
  if (p.failed && !p.sim) return { tone: "red", title: "The simulation could not run", detail: p.failed };
  if (!p.sim) return { tone: "idle", title: "Nothing simulated yet" };
  const sim = p.sim;
  const solved = solvedOf(sim);
  const stale = p.stale ? " (settings changed since)" : "";
  if (!solved) return { tone: "red", title: "This shape was rejected", detail: `${MATTER_TITLES[sim.first_failure ?? ""] ?? "A check"} failed, so nothing was solved.` };
  const hardFail = sim.ladder.some((r) => r.id !== "M5" && r.status === "fail");
  if (hardFail) return { tone: "red", title: `Peak ${f1(solved.peak)} °C, but a check failed`, detail: matterChecks(sim).find((c) => c.state === "fail")?.sentence };
  const v = sim.verdict;
  const delta = v ? v.delta_equal_material_k : solved.equal.delta_k;
  const vs = delta === null ? "" : delta >= 0 ? `${f1(delta, 2)} K cooler than plain fins` : `${f1(-delta, 2)} K hotter than plain fins`;
  const unknown = sim.ladder.some((r) => r.status !== "pass" && r.status !== "fail");
  if (sim.ladder.every((r) => r.status === "pass")) return { tone: "green", title: `Peak ${f1(solved.peak)} °C, ${vs}${stale}`, detail: "Every check passed." };
  if (unknown) return { tone: "amber", title: `Peak ${f1(solved.peak)} °C${stale}`, detail: "Some checks could not be decided." };
  return { tone: "amber", title: `Peak ${f1(solved.peak)} °C, valid and printable, but no better than plain fins${stale}`, detail: vs ? `It is ${vs}.` : undefined };
}

export function boardVerdict(p: { check: BoardCheck | null; busy: boolean; stale: boolean; failed: string | null }): Verdict {
  if (p.busy) return { tone: "working", title: "Checking the board…" };
  if (p.failed && !p.check) return { tone: "red", title: "The check could not run", detail: p.failed };
  if (!p.check) return { tone: "idle", title: "Not checked yet" };
  const cards = boardChecks(p.check);
  const failed = cards.filter((c) => c.state === "fail");
  const unknown = cards.filter((c) => c.state === "unknown");
  const stale = p.stale ? " (edited since)" : "";
  if (failed.length) return { tone: "red", title: `${failed.length} of ${cards.length} checks failed${stale}`, detail: failed.map((c) => c.title).join(", ") };
  if (unknown.length) return { tone: "amber", title: `${cards.length - unknown.length} of ${cards.length} checks passed, ${unknown.length} undecided${stale}` };
  return { tone: "green", title: `All ${cards.length} checks passed${stale}`, detail: "Part facts are author-curated; this is a netlist-level check, not a layout." };
}

export const SILICON_STAGE_WORDS: Record<string, string> = {
  implement: "Writing the hardware",
  lint: "Checking the code is clean",
  unit: "Testing a million inputs",
  e2e: "Running the whole program",
  bench: "Counting cycles",
  prove: "Proving it for every input",
  synth: "Measuring chip area",
};

/** Live Silicon verdict from the reduced event stream. `phase` is the connection state, `state` what the verifiers reported so far. */
export function siliconVerdict(p: { phase: "idle" | "running" | "done" | "failed"; state: RunState; error: string | null }): Verdict {
  const s = p.state;
  const best = s.best ? s.nodes[s.best] : null;
  if (p.phase === "idle") return { tone: "idle", title: "Pick a kernel and run it" };
  if (p.phase === "failed" || s.status === "failed") return { tone: "red", title: "The run failed", detail: p.error ?? s.error ?? undefined };
  if (p.phase === "running") return { tone: "working", title: best?.score ? `Best so far: ${best.proposal?.mnemonic ?? "an instruction"}` : "Working…" };
  if (best?.score && best.score.feasible) {
    const x = Number.isFinite(best.score.speedup) && best.score.speedup > 0 ? best.score.speedup : null;
    return { tone: "green", title: x ? `${best.proposal?.mnemonic ?? "The instruction"} makes it ${f1(x, 2)}× faster in cycles` : `${best.proposal?.mnemonic ?? "The instruction"} passed every check`, detail: "Proved for every possible input; cycle count measured. Clock speed was not measured." };
  }
  return { tone: "amber", title: "No instruction passed every check", detail: "The run finished without a verified speedup." };
}
