// Server side of the agent: Nemotron on Nebius Token Factory (OpenAI-compatible) with native `tools`.
// The server executes the free tools itself (Board check, Matter simulate, lookups) and streams `ui.action` events so the app mirrors them.
// Credit-spending loops are only proposed here; they run from agent-loops.ts after an explicit click. The API key never leaves the server.

import type { AgentContext, AgentEvent, AgentModel, ModelChoice } from "./agent";
import { guardText } from "./agent-guard";
import { runTool, toolsFor, type ReplayLoader, type ToolContext } from "./agent-tools";
import type { WorkbenchId } from "./brand";
import { costUsd, estimateCallUsd } from "./credits";

export interface AgentConfig {
  apiKey: string;
  baseUrl: string;
  models: Record<AgentModel, string>;
  /** Completion tokens allowed per turn, across tool rounds. */
  turnMaxTokens: number;
  maxToolRounds: number;
  maxInputChars: number;
  /** The app context sent with a turn is cut to this many characters. */
  maxContextChars: number;
  historyMessages: number;
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
    maxToolRounds: 4,
    maxInputChars: 1200,
    maxContextChars: 9000,
    historyMessages: 6,
  };
}

/** Public, non-secret description for the UI. Credits come from /api/credits. */
export function publicStatus(cfg: AgentConfig | null) {
  return cfg ? { connected: true as const, limits: { turnMaxTokens: cfg.turnMaxTokens, maxInputChars: cfg.maxInputChars } } : { connected: false as const };
}

/**
 * Auto routing by task: Ultra for planning and diagnosis, Super for turns that act with tools, Nano for plain lookups.
 * A fixed choice from the user always wins.
 */
export function routeModel(text: string, choice: ModelChoice | string | undefined = "auto"): AgentModel {
  if (choice === "ultra" || choice === "super" || choice === "nano") return choice;
  const t = text.toLowerCase();
  if (/\b(why|diagnos\w*|plan|design|optimi[sz]e|improve|trade-?offs?|compare|explain|debug|fix|fail\w*|root cause|prun\w*)\b/.test(t)) return "ultra";
  if (/\b(check|simulate|set|load|run|apply|change|try|open|switch|edit|swap|move|add|remove|increase|decrease|use|focus)\b/.test(t)) return "super";
  if (/\b(what|which|list|show|who|when|how many|where|reproduce|command)\b/.test(t)) return "nano";
  return "super";
}

/** Worst-case cost of starting a turn on this model (one call with a large prompt and the whole output cap). Used for the credit preflight. */
export const turnEstimateUsd = (model: AgentModel, cfg: AgentConfig) => estimateCallUsd(model, 8000, cfg.turnMaxTokens);

const BASE = `You are the agent inside Hardwright, an app where you design and check hardware with deterministic verifiers: Silicon (custom RISC-V instructions), Board (netlist-level board checks) and Matter (heat-spreader plates).
You ACT in the app with your tools: when you call board_check, matter_simulate, board_set_design, workbench_open, silicon_open_run or workflow_focus the app shows it to the user at once. Prefer doing to describing.
Rules:
- You can only use the tools provided. You cannot start credit-spending loops: propose_board_design and propose_matter_optimize only PROPOSE them and the user must click Run. Never say they ran.
- Library entries (library_search, evidence_get with entry_id) come with a "reproduce" string. Quote it VERBATIM and never construct, shorten or adapt a command: the only valid commands are the "reproduce" strings the tools returned, and they exist only for library entries (ids like dot4-tinymaix), never for run nodes. Say it was NOT run by you.
- State only what tool results say. If a tool returns nothing or an error, say so. Never invent numbers, nodes, runs, parts, pins or tool versions.
- You cannot declare anything verified or proven. Only the verifiers can. Report what a tool result says (a rung status, a stored manifest, a run event) and cite the evidence id it returned (for example run:r_w1_contree3/n1.2.1#wall_speedup, board:clean_sensor#B4, matter:rect_fins#M5, library:dot4-tinymaix, part:esp32.gpio12.strapping). Every sentence that says something passed, was verified or proven must include such an id.
- Board facts are author-curated, not independently verified; never say a board will work. Matter is a 2D steady-state model, not validated on a printed part; its margins over the baselines are small.
- Be brief: two to four short sentences. Details belong in the tool results the user can open. No headings, no long lists.`;

const WORKBENCH_NOTES: Record<WorkbenchId, string> = {
  matter: "The user is in the Matter workbench: a heat-spreader plate from built-in generators rect_fins and radial_spokes. Use matter_simulate to try parameters (it sets them in the app and runs the simulation). If asked for the best parameters, propose_matter_optimize.",
  board: "The user is in the Board workbench: a netlist-level design checked on rungs B1 to B5. Use board_check for a template (clean_sensor, fault_gpio12_vs_gpio14, fault_strapping_pin) and board_set_design to apply an edit to the CURRENT design from the app state: change only what was asked and send the whole design. If asked to draft a new design, propose_board_design.",
  silicon: "The user is in the Silicon workbench: recorded runs of the agent that invents RISC-V instructions. Use run_nodes_search to find nodes, silicon_open_run to open one, run_explain_failure to explain a pruned node.",
};

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

export interface TurnInput {
  text: string;
  model?: ModelChoice | string;
  workbench?: WorkbenchId;
  context?: AgentContext;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  /** The run the user is looking at (already validated as an id). Kept for callers that only know the run. */
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

/** The app state as text for the model, cut to `max` characters. A design that does not fit is left out and the model is told. */
export function contextText(ctx: AgentContext | undefined, max: number): string {
  if (!ctx) return "";
  const { chips: _chips, ...rest } = ctx;
  void _chips;
  let s = JSON.stringify(rest);
  if (s.length <= max) return s === "{}" ? "" : s;
  const slim: AgentContext = { ...rest, board: rest.board ? { ...rest.board, design: "[omitted: too large to send]" } : undefined };
  s = JSON.stringify(slim);
  return s.length <= max ? s : s.slice(0, max);
}

/** One user turn: up to `maxToolRounds` model calls with tool calls in between, yielding the panel's AgentEvents (including ui.action and cost). */
export async function* runAgentTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
  const { cfg, loader, turnId } = input;
  const doFetch = input.fetchImpl ?? fetch;
  const model = routeModel(input.text, input.model);
  yield { type: "turn.started", id: turnId, model };

  const workbench = input.workbench;
  const ctxText = contextText(input.context, cfg.maxContextChars);
  const system = [BASE, workbench ? WORKBENCH_NOTES[workbench] : "", ctxText ? `Current app state (what the user sees): ${ctxText}` : "", input.runId && !input.context?.silicon?.run_id ? `The user is viewing run ${input.runId}.` : ""].filter(Boolean).join("\n");
  const history = (input.history ?? []).slice(-cfg.historyMessages).map((m) => ({ role: m.role, content: String(m.text).slice(0, 1200) }));
  const messages: ChatMsg[] = [{ role: "system", content: system }, ...history, { role: "user", content: input.text }];
  const toolDefs = toolsFor(workbench);
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
          ...(useTools ? { tools: toolDefs.map((t) => ({ type: "function", function: t })), tool_choice: "auto" } : {}),
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
      const callCost = costUsd(model, callIn, callOut);
      usage.calls += 1;
      usage.tokensIn += callIn;
      usage.tokensOut += callOut;
      usage.costUsd += callCost;
      // One cost event per model call, so a stopped or failed turn is still charged for what it used.
      yield { type: "cost", id: turnId, usd: callCost, tokens_in: callIn, tokens_out: callOut, model };
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
        const args = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        yield { type: "tool.call", id: turnId, call: { id: callId, name: c.name, args } };
        // A tool the workbench was not offered is refused even if the model names it.
        const offered = toolDefs.some((t) => t.name === c.name);
        const result = parseError ? ({ ok: false, error: parseError } as const) : !offered ? ({ ok: false, error: `${c.name} is not available here` } as const) : await runTool(c.name, parsed, loader, input.tools);
        if (result.ok) for (const e of result.evidence) known.add(e);
        yield { type: "tool.result", id: turnId, callId, ok: result.ok, summary: result.ok ? result.summary : result.error };
        if (result.ok) {
          for (const a of result.ui ?? []) yield { type: "ui.action", id: turnId, action: a };
          if (result.proposal) yield { type: "action.proposed", action: { id: `p_${turnId}_${callId}`, ...result.proposal } };
        }
        made.push({ id: callId, type: "function", function: { name: c.name, arguments: c.args || "{}" } });
        toolMsgs.push({ role: "tool", tool_call_id: callId, content: JSON.stringify(result.ok ? { ok: true, summary: result.summary, ...(result.data as object | null ? { data: result.data } : {}), evidence_ids: result.evidence } : { ok: false, error: result.error }) });
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
