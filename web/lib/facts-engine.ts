// Figures that live in the engine's own write-ups (Board README, Matter EVALS), parsed from the text so nothing is retyped.
// facts.ts reads the engine docs when they are present in the build and falls back to the snapshot in
// public/recorded/engine-facts.json, which a test keeps equal to what this parser reads from the docs.

export interface BoardFacts {
  faultsDetected: number;
  faultsCatalogued: number;
  structuralFaults: number;
  heldoutBefore: { passed: number; of: number };
  heldoutAfter: { passed: number; of: number };
  proposeJudgedDesigns: number;
  proposeCostUsd: number;
  repairJudgedDesigns: number;
  repairCostUsd: number;
  rungs: string[];
}

export interface MatterRunFact {
  run: string;
  winner: string;
  peakC: number;
  baselineC: number;
  marginK: number;
  femErrPct: number;
  costUsd: number;
}

export interface MatterFacts {
  runs: MatterRunFact[];
  agentBeatsBaseline: { wins: number; of: number };
  rungs: string[];
  solverValidation: string;
}

export interface EngineFacts {
  board: BoardFacts;
  matter: MatterFacts;
}

function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`facts: could not read ${what} from the engine docs`);
  return v;
}

export function extractBoardFacts(readme: string): BoardFacts {
  const detected = (readme.match(/\|\s*detected\s*\|\s*$/gm) ?? []).length;
  const pending = (readme.match(/\|\s*pending\s*\|\s*$/gm) ?? []).length;
  const sl = must(readme.match(/structural faults[^:]*:([^.]*)\./), "structural faults");
  const structural = (sl[1].match(/`\w+`/g) ?? []).length;
  const held = must(readme.match(/Held-out, (\d+) sessions \| (\d+)\/(\d+)[^|]*\| \*\*(\d+)\/(\d+)\*\*/), "held-out table");
  const propose = must(readme.match(/board-propose-template-6 \|[^|]*\|\s*\*\*passed B1 to B5\*\* in (\d+) judged designs, \$([\d.]+)/), "propose run");
  const repair = must(readme.match(/board-repair-pin_mismatch-1 \|[^|]*\|\s*\*\*passed\*\* in (\d+) judged designs, \$([\d.]+)/), "repair run");
  const rungs = [...readme.matchAll(/^\| (B\d) \| [^|]+\| implemented \|$/gm)].map((m) => m[1]);
  return {
    faultsDetected: detected,
    faultsCatalogued: detected + pending,
    structuralFaults: structural,
    heldoutBefore: { passed: Number(held[2]), of: Number(held[3]) },
    heldoutAfter: { passed: Number(held[4]), of: Number(held[5]) },
    proposeJudgedDesigns: Number(propose[1]),
    proposeCostUsd: Number(propose[2]),
    repairJudgedDesigns: Number(repair[1]),
    repairCostUsd: Number(repair[2]),
    rungs,
  };
}

export function extractMatterFacts(evals: string): MatterFacts {
  const rows = [
    ...evals.matchAll(/^\| (m_[\w]+) \| (\w+) \(n[\d.]+\) \| ([\d.]+) \| [\d.]+% \| all pass \| \+([\d.]+) K \(baseline ([\d.]+) C\) \| [^|]*\| ([\d.]+)% \| ([\d.]+) \| (?:True|False) \|$/gm),
  ].map((m) => ({ run: m[1], winner: m[2], peakC: Number(m[3]), marginK: Number(m[4]), baselineC: Number(m[5]), femErrPct: Number(m[6]), costUsd: Number(m[7]) }));
  if (rows.length === 0) throw new Error("facts: no Matter eval rows found");
  const beats = must(evals.match(/rectangular-fin baseline: \*\*PASS\*\*, (\d+)\/(\d+) runs/), "Matter baseline result");
  const validation = must(evals.match(/Solver validation \(M1\): \*\*(\w+)\*\*/), "solver validation");
  return { runs: rows, agentBeatsBaseline: { wins: Number(beats[1]), of: Number(beats[2]) }, rungs: ["M1", "M2", "M3", "M4", "M5"], solverValidation: validation[1] };
}

export function extractEngineFacts(boardReadme: string, matterEvals: string): EngineFacts {
  return { board: extractBoardFacts(boardReadme), matter: extractMatterFacts(matterEvals) };
}
