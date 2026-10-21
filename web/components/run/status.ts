import type { StageStatus } from "@/lib/events";
import { nodeStatus, wallOf, type NodeState, type RunState } from "@/lib/run-state";
import { pct, times } from "@/lib/format";

export type Visual = "best" | "feasible" | "unproven" | "budget" | "nogain" | "failed" | "running" | "repairing" | "queued" | "baseline";

export function visualOf(n: NodeState, s: RunState): Visual {
  const st = nodeStatus(n, s);
  if (st === "baseline") return "baseline";
  if (s.best === n.id) return "best";
  if (st === "scored") return "feasible";
  if (st === "unproven") return "unproven";
  if (st === "pruned") return n.pruned!.kind === "budget" ? "budget" : n.pruned!.kind === "nogain" ? "nogain" : "failed";
  if (st === "repairing") return "repairing";
  if (st === "running") return "running";
  return "queued";
}

export const VISUAL_LABEL: Record<Visual, string> = {
  best: "Best so far",
  feasible: "Verified, in budget",
  unproven: "Faster, proof incomplete",
  budget: "Over area budget",
  nogain: "No speedup",
  failed: "Failed verification",
  running: "Running",
  repairing: "Repairing",
  queued: "Queued",
  baseline: "Baseline CPU",
};

/** Short value printed at the end of a tree row. */
export function rowValue(n: NodeState, s: RunState): { text: string; tone: "signal" | "ink" | "amber" | "red" | "muted" } {
  const v = visualOf(n, s);
  switch (v) {
    case "baseline":
      return { text: "1.00×", tone: "muted" };
    case "best":
      return { text: times(wallOf(n.score!)), tone: "signal" };
    case "feasible":
      return { text: times(wallOf(n.score!)), tone: "ink" };
    case "unproven":
      return { text: times(wallOf(n.score!)), tone: "amber" };
    case "budget":
      return { text: n.measured.areaPct !== undefined ? pct(n.measured.areaPct, 1) : "budget", tone: "amber" };
    case "nogain":
      return { text: "no gain", tone: "muted" };
    case "failed": {
      const st = n.attempts.at(-1)?.failed;
      return { text: st ? `${st} ✕` : "failed", tone: "red" };
    }
    case "repairing":
      return { text: `fix ${n.attempt}`, tone: "amber" };
    case "running":
      return { text: n.activeStage ?? "…", tone: "signal" };
    case "queued":
      return { text: "queued", tone: "muted" };
  }
}

export const TONE_VAR: Record<string, string> = {
  signal: "var(--signal-ink)",
  ink: "var(--ink)",
  amber: "var(--amber)",
  red: "var(--red)",
  muted: "var(--ink-3)",
};

export function stageFill(status: StageStatus | "none"): string {
  switch (status) {
    case "pass":
      return "var(--ink-2)";
    case "running":
      return "var(--signal)";
    case "fail":
      return "var(--red)";
    case "skipped":
      return "var(--amber)";
    case "queued":
      return "var(--line-2)";
    default:
      return "var(--line)";
  }
}
