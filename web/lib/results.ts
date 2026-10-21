// Server-side: summarise a replay file for the marketing pages, so every number on them comes from a real run.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseNdjson } from "./events";
import { reduceAll } from "./run-state";

export interface RunSummary {
  id: string;
  title: string;
  baselineCycles: number;
  cycles: number;
  speedup: number;
  wallSpeedup: number | null;
  areaPct: number;
  fmaxMhz: number | null;
  baseFmaxMhz: number | null;
  seeds: number | null;
  mnemonics: string[];
  costUsd: number;
  nodes: number;
  wallSeconds: number;
  tokens: number;
}

export function summarize(id: string): RunSummary {
  const text = readFileSync(resolve(process.cwd(), "public/replays", `${id}.ndjson`), "utf8");
  const s = reduceAll(parseNdjson(text).events);
  const best = s.best ? s.nodes[s.best] : null;
  if (!best?.score || !s.baseline || !s.completed) throw new Error(`replay ${id} has no completed best node`);
  return {
    id,
    title: s.workload?.title ?? id,
    baselineCycles: s.baseline.cycles,
    cycles: best.score.cycles,
    speedup: best.score.speedup,
    wallSpeedup: best.timing ? best.score.wall_speedup : null,
    areaPct: best.score.area_delta_pct,
    fmaxMhz: best.timing?.fmax_mhz ?? null,
    baseFmaxMhz: s.baseline.fmax_mhz,
    seeds: best.timing?.seeds ?? null,
    mnemonics: best.instructionSet,
    costUsd: s.completed.totals.cost_usd,
    nodes: s.completed.totals.nodes,
    wallSeconds: s.completed.totals.wall_s,
    tokens: s.completed.totals.tokens,
  };
}
