// Every figure on the landing page comes from here, computed at build time from real data:
//   Silicon: public/replays/*.ndjson (real engine runs)
//   Library: public/library/index.json (copied from evidence/ by the prebuild) or ../evidence/index.json
//   Board and Matter: the engine's own write-ups (see facts-engine.ts)
//   Recorded sessions: public/recorded/*.json (captured from the live agent and from Nemotron without tools)
// Server-only (reads files). Components receive the result as props.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractEngineFacts, type EngineFacts } from "./facts-engine";
import { summarize, type RunSummary } from "./results";

export interface SiliconRunFact extends RunSummary {
  candidates: number;
  rejected: number;
  verified: number;
  /** Distinct candidates that failed a correctness stage (implement, lint, unit, e2e, prove), repairs included. */
  failedCorrectness: number;
}

export interface LibraryFact {
  id: string;
  title: string;
  mnemonic: string;
  speedup: number | null;
  rungsPassed: number;
  rungsTotal: number;
  rungsSkipped: string[];
  /** The stored, proven RTL of the entry (evidence/<id>/rtl.v), or null. */
  rtl: string | null;
}

export interface RecordedAgent {
  id: string;
  title: string;
  workbench: "silicon" | "board" | "matter";
  question: string;
  model: string;
  captured: string;
  events: AgentEventRecord[];
  toolCalls: number;
}

export type AgentEventRecord = { type: string; id?: string; [k: string]: unknown };

export interface RecordedChat {
  question: string;
  answer: string;
  model: string;
  captured: string;
  costUsd: number;
  tokensOut: number;
  words: number;
  evidenceIds: number;
  toolCalls: number;
}

export interface BoardFaultFact {
  sessionId: string;
  template: string;
  passed: number;
  of: number;
  failedRung: string;
  evidenceId: string;
}

export interface Facts {
  silicon: {
    runs: SiliconRunFact[];
    candidates: number;
    rejected: number;
    verified: number;
    failedCorrectness: number;
    best: SiliconRunFact;
    totalCostUsd: number;
    llmCalls: number;
    models: string[];
  };
  board: EngineFacts["board"];
  matter: EngineFacts["matter"] & { bestPeakC: number; baselineC: number; marginK: number; totalCostUsd: number };
  library: { entries: LibraryFact[] };
  recorded: { agent: RecordedAgent[]; chat: RecordedChat; boardFault: BoardFaultFact };
}

const root = () => process.cwd();
const readJson = <T>(...p: string[]): T => JSON.parse(readFileSync(resolve(root(), ...p), "utf8")) as T;
const lines = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown> & { type: string });

const CORRECTNESS = new Set(["implement", "lint", "unit", "e2e", "prove"]);

export function siliconRunFact(id: string): SiliconRunFact {
  const ev = lines(resolve(root(), "public", "replays", `${id}.ndjson`));
  const candidates = ev.filter((e) => e.type === "node.created" && e.parent_id != null).length;
  const rejected = ev.filter((e) => e.type === "node.pruned").length;
  const verified = ev.filter((e) => e.type === "node.scored").length;
  const failed = new Set(ev.filter((e) => e.type === "node.stage" && e.status === "fail" && CORRECTNESS.has(String(e.stage))).map((e) => e.node_id));
  return { ...summarize(id), candidates, rejected, verified, failedCorrectness: failed.size };
}

function engineFacts(): EngineFacts {
  const board = resolve(root(), "..", "engine", "siliconsmith", "board", "README.md");
  const matter = resolve(root(), "..", "engine", "siliconsmith", "matter", "EVALS.md");
  if (existsSync(board) && existsSync(matter)) return extractEngineFacts(readFileSync(board, "utf8"), readFileSync(matter, "utf8"));
  return readJson<EngineFacts>("public", "recorded", "engine-facts.json");
}

function readRtl(id: string): string | null {
  for (const base of [["public", "library"], ["..", "evidence"]]) {
    const p = resolve(root(), ...base, id, "rtl.v");
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return null;
}

function libraryFacts(): LibraryFact[] {
  const p = existsSync(resolve(root(), "public", "library", "index.json")) ? ["public", "library", "index.json"] : ["..", "evidence", "index.json"];
  type Entry = { id: string; title: string; instruction: { mnemonic: string }; metrics: { speedup: number | null; wall_speedup: number | null }; ladder: Record<string, string> };
  return readJson<Entry[]>(...p).map((e) => {
    const vals = Object.entries(e.ladder);
    return {
      id: e.id,
      title: e.title,
      mnemonic: e.instruction.mnemonic,
      speedup: e.metrics.wall_speedup ?? e.metrics.speedup ?? null,
      rungsPassed: vals.filter(([, v]) => v === "pass").length,
      rungsTotal: vals.length,
      rungsSkipped: vals.filter(([, v]) => v === "skipped").map(([k]) => k),
      rtl: readRtl(e.id),
    };
  });
}

const WORD = /\S+/g;

/** The Board fault session: the tool result says how many rungs pass, the cited evidence id names the failing rung. */
function boardFault(agent: RecordedAgent[]): BoardFaultFact {
  const s = agent.find((a) => a.id === "board-fault");
  if (!s) throw new Error("facts: recorded session board-fault is missing");
  const res = s.events.find((e) => e.type === "tool.result");
  const m = String(res?.summary ?? "").match(/^(\w+): (\d+) of (\d+) rungs pass/);
  const ev = s.events.find((e) => e.type === "evidence");
  const id = (ev?.ids as string[] | undefined)?.find((i) => /#B\d$/.test(i));
  if (!m || !id) throw new Error("facts: board-fault session has no rung result");
  return { sessionId: s.id, template: m[1], passed: Number(m[2]), of: Number(m[3]), failedRung: id.slice(id.indexOf("#") + 1), evidenceId: id };
}

function recordedFacts(): Facts["recorded"] {
  const dir = resolve(root(), "public", "recorded");
  const agent = readdirSync(dir)
    .filter((f) => f.startsWith("agent-") && f.endsWith(".json"))
    .sort()
    .map((f) => {
      const r = readJson<{ id: string; title: string; workbench: RecordedAgent["workbench"]; question: string; model: string; captured: string; events: AgentEventRecord[] }>("public", "recorded", f);
      return { ...r, toolCalls: r.events.filter((e) => e.type === "tool.call").length };
    });
  const c = readJson<{ question: string; answer: string; model_id: string; captured_utc: string; cost_usd: number; tokens_out: number }>("public", "recorded", "chatbot-board-fault.json");
  const chat: RecordedChat = {
    question: c.question,
    answer: c.answer,
    model: c.model_id,
    captured: c.captured_utc.slice(0, 10),
    costUsd: c.cost_usd,
    tokensOut: c.tokens_out,
    words: (c.answer.match(WORD) ?? []).length,
    evidenceIds: (c.answer.match(/\b(?:board|run|matter|library):[\w.#-]+/g) ?? []).length,
    toolCalls: 0,
  };
  return { agent, chat, boardFault: boardFault(agent) };
}

let cache: Facts | null = null;

export function getFacts(): Facts {
  if (cache) return cache;
  const ids = readdirSync(resolve(root(), "public", "replays"))
    .filter((f) => f.endsWith(".ndjson"))
    .map((f) => f.replace(/\.ndjson$/, ""))
    .sort();
  const runs = ids.map(siliconRunFact);
  const best = runs.reduce((a, r) => ((r.wallSpeedup ?? r.speedup) > (a.wallSpeedup ?? a.speedup) ? r : a));
  const sum = (f: (r: SiliconRunFact) => number) => runs.reduce((n, r) => n + f(r), 0);
  const llm = ids.reduce((n, id) => n + lines(resolve(root(), "public", "replays", `${id}.ndjson`)).filter((e) => e.type === "llm.call").length, 0);
  const models = [
    ...new Set(ids.flatMap((id) => lines(resolve(root(), "public", "replays", `${id}.ndjson`)).filter((e) => e.type === "llm.call").map((e) => String(e.model)))),
  ].sort();
  const eng = engineFacts();
  const mr = eng.matter.runs;
  cache = {
    silicon: {
      runs,
      candidates: sum((r) => r.candidates),
      rejected: sum((r) => r.rejected),
      verified: sum((r) => r.verified),
      failedCorrectness: sum((r) => r.failedCorrectness),
      best,
      totalCostUsd: sum((r) => r.costUsd),
      llmCalls: llm,
      models,
    },
    board: eng.board,
    matter: {
      ...eng.matter,
      bestPeakC: Math.min(...mr.map((r) => r.peakC)),
      baselineC: mr[0].baselineC,
      marginK: Math.max(...mr.map((r) => r.marginK)),
      totalCostUsd: mr.reduce((n, r) => n + r.costUsd, 0),
    },
    library: { entries: libraryFacts() },
    recorded: recordedFacts(),
  };
  return cache;
}
