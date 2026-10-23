// Server side of the agent panel: Nemotron on Nebius Token Factory (OpenAI-compatible) with native `tools`, read-only tools only.
// The API key is read from the server environment and never leaves it. Nothing here runs in the browser.

import type { AgentEvent, AgentModel } from "./agent";
import { guardText } from "./agent-guard";
import { runTool, TOOL_DEFS, type ReplayLoader, type ToolContext } from "./agent-tools";

export interface AgentConfig {
  apiKey: string;
  baseUrl: string;
  models: Record<AgentModel, string>;
  /** Completion tokens allowed per turn, across tool rounds. */
  turnMaxTokens: number;
  maxToolRounds: number;
  maxInputChars: number;
  visitorTurnsPerDay: number;
  globalTurnsPerDay: number;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** Env names are the ones in `.env.example`. A missing key means "not connected": the panel stays in its honest state. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): AgentConfig | null {
  const apiKey = env.NEBIUS_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.TOKEN_FACTORY_BASE_URL?.trim() || "https://api.tokenfactory.nebius.com/v1").replace(/\/+$/, ""),
    models: {
      nano: env.SS_MODEL_NANO?.trim() || "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
      super: env.SS_MODEL_SUPER?.trim() || "nvidia/nemotron-3-super-120b-a12b",
      ultra: env.SS_MODEL_ULTRA?.trim() || "nvidia/Nemotron-3-Ultra-550b-a55b",
    },
    turnMaxTokens: num(env.AGENT_TURN_MAX_TOKENS, 1200),
    maxToolRounds: 3,
    maxInputChars: 1000,
    visitorTurnsPerDay: num(env.AGENT_VISITOR_DAILY_TURNS, 12),
    globalTurnsPerDay: num(env.AGENT_GLOBAL_DAILY_TURNS, 150),
  };
}

/** Public, non-secret description of the limits, for the UI. */
export function publicStatus(cfg: AgentConfig | null) {
  return cfg
    ? { connected: true as const, limits: { visitorTurnsPerDay: cfg.visitorTurnsPerDay, globalTurnsPerDay: cfg.globalTurnsPerDay, turnMaxTokens: cfg.turnMaxTokens, maxInputChars: cfg.maxInputChars, scope: "per server instance, in memory" } }
    : { connected: false as const };
}

/** Conservative in-memory daily limiter. It resets when the server instance restarts and is not shared between instances; the UI says so. */
export class DailyLimiter {
  private day = "";
  private visitors = new Map<string, number>();
  private total = 0;
  constructor(
    private visitorMax: number,
    private globalMax: number,
    private now: () => Date = () => new Date(),
  ) {}
  take(visitor: string): { ok: true } | { ok: false; reason: "visitor" | "global" } {
    const d = this.now().toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.visitors.clear();
      this.total = 0;
    }
    if (this.total >= this.globalMax) return { ok: false, reason: "global" };
    const used = this.visitors.get(visitor) ?? 0;
    if (used >= this.visitorMax) return { ok: false, reason: "visitor" };
    this.visitors.set(visitor, used + 1);
    this.total += 1;
    return { ok: true };
  }
}

/** Auto routing: Ultra for diagnosis questions, Super otherwise (tool calls). A manual choice wins. */
export function pickModel(text: string, override?: string): AgentModel {
  if (override === "ultra" || override === "super" || override === "nano") return override;
  return /\b(why|diagnos|explain|cause|fail|failed|prune|pruned)\b/i.test(text) ? "ultra" : "super";
}

const SYSTEM = `You are the assistant inside SiliconSmith Workstation, a tool where Nemotron agents design custom RISC-V instructions that deterministic verifiers then check.
Rules:
- You can only use the tools provided. They read recorded runs and the evidence library, run the free deterministic Board checker and Matter simulator, and nothing else. You cannot start agent runs or change anything.
- Library entries (library_search, evidence_get with entry_id) come with a "reproduce" string. Quote it VERBATIM and never construct, shorten or adapt a command: the only valid commands are the "reproduce" strings the tools returned, and they exist only for library entries (ids like dot4-tinymaix), never for run nodes (ids like run:r_w1_final/n1.1). Say it was NOT run by you.
- "Which instruction has the biggest speedup in the library" is answered from library_search (compare the entries' speedup), not from run nodes.
- State only what tool results say. If a tool returns nothing or an error, say so plainly. Never invent numbers, nodes, runs or tool versions.
- You cannot declare anything verified or proven. Only the verifiers can. You may report what a tool result says (a run's event log, a rung status from the checker, a stored manifest) and you must cite the evidence id the tool returned (for example run:r_w1_contree3/n1.2.1#wall_speedup, board:clean_sensor#B4, matter:rect_fins#M5, library:dot4-tinymaix, part:esp32.gpio12.strapping).
- Board facts are author-curated, not independently verified; never say a board will work. Matter is a 2D steady-state model, not validated on a printed part.
- Every sentence that says something passed, was verified or proven must include such an evidence id.
- Be brief: a few sentences. Use the run id and node id exactly as given.`;

interface UpstreamToolCall {
  id: string;
  name: string;
  args: string;
}
type ChatMsg = Record<string, unknown>;

async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  const rest = buf.trim();
  if (rest.startsWith("data:")) yield rest.slice(5).trim();
}

// Token Factory list prices (USD per million tokens, in / out), the same figures the run console uses for its estimate.
const PRICE: Record<AgentModel, [number, number]> = { ultra: [1, 3], super: [0.3, 0.9], nano: [0.06, 0.24] };

export interface TurnInput {
  text: string;
  model?: string;
  /** The run the user is looking at (already validated as an id). */
  runId?: string;
  /** Hosted Board/Matter calls and the evidence library, supplied by the route. */
  tools?: ToolContext;
  cfg: AgentConfig;
  loader: ReplayLoader;
  signal?: AbortSignal;
  turnId: string;
  fetchImpl?: typeof fetch;
}

const EVIDENCE_ID = /(?:run:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.]+(?:#[a-z_]+)?|(?:board|matter):[a-z0-9_]+#[A-Z][0-9]|library:[A-Za-z0-9_.-]+|part:[a-z0-9_]+\.[a-z0-9_.]+)/g;

/** One user turn: up to `maxToolRounds` model calls with read-only tool calls in between, yielding the panel's AgentEvents. */
export async function* runAgentTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
  const { cfg, loader, turnId } = input;
  const doFetch = input.fetchImpl ?? fetch;
  const model = pickModel(input.text, input.model);
  yield { type: "turn.started", id: turnId, model };

  const messages: ChatMsg[] = [
    { role: "system", content: input.runId ? `${SYSTEM}
The user is currently viewing run ${input.runId}.` : SYSTEM },
    { role: "user", content: input.text },
  ];
  const known = new Set<string>();
  let fullText = "";
  let budget = cfg.turnMaxTokens;
  const usage = { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  try {
    for (let round = 0; round <= cfg.maxToolRounds; round++) {
      if (budget <= 0) {
        yield { type: "turn.error", id: turnId, message: "The per-turn token cap was reached before the answer finished." };
        return;
      }
      const useTools = round < cfg.maxToolRounds;
      const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal: input.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.models[model],
          messages,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: Math.min(budget, cfg.turnMaxTokens),
          temperature: 0.2,
          chat_template_kwargs: { enable_thinking: false },
          ...(useTools ? { tools: TOOL_DEFS.map((t) => ({ type: "function", function: t })), tool_choice: "auto" } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        // Never echo the upstream body: it can contain request details. Status only.
        yield { type: "turn.error", id: turnId, message: `The model endpoint answered ${res.status}.${res.status === 429 || res.status >= 500 ? " This can be transient; try again." : ""}` };
        return;
      }
      let text = "";
      let finish = "";
      let used = 0;
      let callIn = 0;
      let callOut = 0;
      const calls = new Map<number, UpstreamToolCall>();
      for await (const data of sseLines(res.body)) {
        if (data === "[DONE]") break;
        let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.usage?.completion_tokens) used = chunk.usage.completion_tokens;
        if (chunk.usage) {
          callIn = chunk.usage.prompt_tokens ?? callIn;
          callOut = chunk.usage.completion_tokens ?? callOut;
        }
        const ch = chunk.choices?.[0];
        if (!ch) continue;
        if (ch.finish_reason) finish = ch.finish_reason;
        const d = ch.delta;
        if (d?.content) {
          text += d.content;
          yield { type: "text.delta", id: turnId, text: d.content };
        }
        for (const tc of d?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(idx, cur);
        }
      }
      fullText += text;
      usage.calls += 1;
      usage.tokensIn += callIn;
      usage.tokensOut += callOut;
      usage.costUsd += (callIn * PRICE[model][0] + callOut * PRICE[model][1]) / 1e6;
      budget -= used || Math.ceil((text.length + [...calls.values()].reduce((n, c) => n + c.args.length, 0)) / 3);

      if (calls.size === 0) {
        if (finish === "length") yield { type: "text.delta", id: turnId, text: "\n[The answer was cut off by the per-turn token cap.]" };
        break;
      }
      const toolMsgs: ChatMsg[] = [];
      const made: ChatMsg[] = [];
      let n = 0;
      for (const c of calls.values()) {
        const callId = c.id || `call_${round}_${n++}`;
        let parsed: unknown = {};
        let parseError: string | null = null;
        try {
          parsed = c.args ? JSON.parse(c.args) : {};
        } catch {
          parseError = "arguments were not valid JSON";
        }
        yield { type: "tool.call", id: turnId, call: { id: callId, name: c.name, args: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {} } };
        const result = parseError ? ({ ok: false, error: parseError } as const) : await runTool(c.name, parsed, loader, input.tools);
        if (result.ok) for (const e of result.evidence) known.add(e);
        yield { type: "tool.result", id: turnId, callId, ok: result.ok, summary: result.ok ? result.summary : result.error };
        made.push({ id: callId, type: "function", function: { name: c.name, arguments: c.args || "{}" } });
        toolMsgs.push({ role: "tool", tool_call_id: callId, content: JSON.stringify(result.ok ? { ok: true, ...(result.data as object | null ? { data: result.data } : {}), evidence_ids: result.evidence } : { ok: false, error: result.error }) });
      }
      messages.push({ role: "assistant", content: text || null, tool_calls: made }, ...toolMsgs);
      if (round === cfg.maxToolRounds) break;
    }
    // A sentence-ending full stop is not part of an id (node ids contain dots).
    const cited = [...new Set((fullText.match(EVIDENCE_ID) ?? []).map((id) => id.replace(/\.+$/, "")))].filter((id) => known.has(id));
    if (cited.length) yield { type: "evidence", id: turnId, ids: cited };
    // Post-check: a verify-entry command for an id that is not a library entry is invented. The text is already streamed, so flag it.
    const entryIds = (await input.tools?.manifests?.ids()) ?? [];
    for (const f of guardText(fullText, entryIds)) yield { type: "flag", id: turnId, kind: f.kind, message: f.message };
    yield { type: "turn.done", id: turnId, usage };
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      yield { type: "turn.error", id: turnId, message: "Stopped." };
      return;
    }
    yield { type: "turn.error", id: turnId, message: "The agent connection failed." };
  }
}
