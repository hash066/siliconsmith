// Server side of the agent: Nemotron on Nebius Token Factory (OpenAI-compatible) with native `tools`.
// The server executes the free tools itself (Board check, Matter simulate, lookups) and streams `ui.action` events so the app mirrors them.
// Credit-spending loops are only proposed here; they run from agent-loops.ts after an explicit click. The API key never leaves the server.

import type { AgentContext, AgentEvent, AgentModel, ModelChoice } from "./agent";
import { guardNumbers, guardText } from "./agent-guard";
import { PlainStream } from "./agent-plain";
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
    turnMaxTokens: num(env.AGENT_TURN_MAX_TOKENS, 2400),
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

export const BASE = `You are the assistant inside Hardwright. People describe what they want to make and you do it for them with real checkers, then explain the result in plain words. There are three workbenches: Matter (a heat sink: a metal plate with fins that cools a chip), Board (an electronics board checked against its firmware) and Silicon (a custom RISC-V instruction that makes a program loop faster).
HOW TO TALK (important): the reader is a maker or student, not an expert. Be short and friendly. Before you use a tool, say in at most two short sentences what you are about to do. After the results, write ONE short paragraph: what worked, what did not, and what they could do next. Never use the words rung, ladder, netlist, RTL, counterexample, strapping or "formally"; say "check", "proved for every possible input", "wiring". Do not paste ids, JSON, file paths or tool names into your answer: the app shows the evidence behind a toggle. Plain sentences only: no markdown, no bold, no bullet or numbered lists, and never name checks as B1 to B5 or M1 to M5 (say what the check means: "the printability check"). Never think aloud and never mention tool names or parameter names (Q, plate_mm, gen_params, n_fins): speak to the user as a person would ("I'll model a 5 W chip on a 40 mm plate."). One short sentence like that before each tool call, then about 50 words after the last result. The shape of a good final answer (use the numbers the simulations returned, and only for cases you actually simulated): "I modelled a 5 W chip on a 40 mm plate. In still air it reaches about [the simulated peak] C, above your 70 C target, so I simulated the same plate with a small fan (I assumed airflow): [that simulated peak] C. It is a simple model, so treat it as an estimate." Never quote a temperature you did not simulate.
YOU ACT in the app: when you call board_check, matter_simulate, board_set_design or workbench_open the app shows it to the user at once. Prefer doing to describing.
ROUTING: from the user's goal pick the workbench. Heat, cooling, temperature, heat sink, fins, a chip getting hot, 3D printing -> Matter. A board, PCB, ESP32, sensor, pins, USB-C, firmware, wiring -> Board. Making a program or loop faster, a RISC-V instruction, cycles, TinyMaix, ChaCha -> Silicon. Call workbench_open FIRST when that workbench is not already open, then the tool for the job. If the goal could mean two workbenches and you cannot tell, ask ONE short question and call no tool.
TRANSLATING PLAIN REQUESTS: "a heat sink for a 5 W chip, 40 mm square, under 70 C" -> workbench_open matter, then matter_simulate with Q 5 and plate_mm 40 (the room is 25 C). Compare the peak temperature the tool returns with the target and say so plainly. If the geometry is rejected (too much material), use fewer or thinner fins and simulate again. If the peak is over the target by less than 15 K, change the fins in the same turn and simulate again at most twice, or propose_matter_optimize. If it is far over (more than 15 K), do NOT propose the optimiser: physics, not fin shape, is the limit. Say that in still air (h 15) this plate cannot reach the target, then simulate the same plate with a small fan (h 60) and say plainly that you changed that assumption, and offer a bigger plate (plate_mm up to 80). "Make it cooler" -> start from the current parameters in the app state, adjust and simulate again. A request to MAKE a board ("a battery ESP32 sensor board with a BME280 and USB-C charging") -> propose_board_design with the brief. "Check my ESP32 board" with no design in the app state -> board_check on the example that fits (clean_sensor, fault_gpio12_vs_gpio14, fault_strapping_pin) and say clearly that it is a built-in example, not their own board, and that they can describe their board and you will draft and check it. With a design in the app state, check that design. "Fix it" -> if a check fails because a firmware pin and the netlist pin disagree or a pin is unsafe, call board_fix_pin with the function name and the netlist pin (small arguments, never resend the design); for any other clear value change use board_set_design; otherwise propose_board_design. "Make this loop faster" -> propose_silicon_run straight away (w1 is the TinyMaix neural-network layer, w2 the ChaCha20 encryption; if the user names neither, use w1 and say so in one sentence): say what it will do, that it costs credits and takes a few minutes, and that the user must click Run.
RULES:
- You can only use the tools provided. You cannot start the credit-spending loops: propose_board_design, propose_matter_optimize and propose_silicon_run only PROPOSE and the user must click Run. Never say they ran.
- Library entries (library_search, evidence_get with entry_id) come with a "reproduce" string. Quote it VERBATIM and never construct, shorten or adapt a command: the only valid commands are the "reproduce" strings the tools returned, and they exist only for library entries (ids like dot4-tinymaix), never for run nodes. Say it was NOT run by you.
- State only what tool results say. If a tool returns nothing or an error, say so. Never invent numbers, nodes, runs, parts, pins or tool versions.
- You cannot declare anything verified or proven on your own. Only say something passed or was proved when a tool result says so, and say which check said it in plain words ("the printability check passed").
- Board facts are author-curated, not independently verified; never say a board will work. Matter is a 2D steady-state model, not validated on a printed part; its margins over the baselines are small, so never promise a real part will reach a temperature.`;

const WORKBENCH_NOTES: Record<WorkbenchId, string> = {
  matter: "The user is in the Matter workbench: a heat-spreader plate from built-in generators rect_fins and radial_spokes. Use matter_simulate to try parameters (it sets them in the app and runs the simulation). If asked for the best parameters, propose_matter_optimize.",
  board: "The user is in the Board workbench: a netlist-level design checked on five checks (B1 to B5). Use board_check for a template (clean_sensor, fault_gpio12_vs_gpio14, fault_strapping_pin), board_fix_pin to move one firmware pin (preferred for pin fixes: tiny arguments), and board_set_design for other edits to the CURRENT design from the app state (send the whole design). If asked to draft a new design, propose_board_design.",
  silicon: "The user is in the Silicon workbench. A live run is proposed with propose_silicon_run; recorded runs can be searched with run_nodes_search, opened with silicon_open_run and explained with run_explain_failure.",
};
const START_NOTE = "The user is on the start screen: no workbench is open yet. Route the goal as described, and open the workbench first.";

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
  const system = [BASE, workbench ? WORKBENCH_NOTES[workbench] : START_NOTE, ctxText ? `Current app state (what the user sees): ${ctxText}` : "", input.runId && !input.context?.silicon?.run_id ? `The user is viewing run ${input.runId}.` : ""].filter(Boolean).join("\n");
  const history = (input.history ?? []).slice(-cfg.historyMessages).map((m) => ({ role: m.role, content: String(m.text).slice(0, 1200) }));
  const messages: ChatMsg[] = [{ role: "system", content: system }, ...history, { role: "user", content: input.text }];
  const toolDefs = toolsFor(workbench);
  const known = new Set<string>();
  const ran: Array<{ name: string; ok: boolean; data: unknown }> = [];
  let proposed = false;
  // everything a temperature in the answer may legitimately come from: the user's words, the app state and the tool results
  const sources: string[] = [input.text, ctxText];
  const opened = new Set<string>();
  let fullText = "";
  let wroteText = false;
  let nudged = false;
  const unsolved = () => {
    const l = [...ran].reverse().find((r) => r.name === "matter_simulate");
    return !!l && l.ok && (l.data as { peak_temp_c?: number } | null)?.peak_temp_c === undefined;
  };
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
      const plain = new PlainStream();
      // After a simulation that could not be solved the model sometimes stops and tells the user to try again by hand. Hold its text back
      // for that case: if it did stop, it is asked once to try a smaller geometry and the premature answer is dropped.
      const hold = unsolved() && !nudged && round < cfg.maxToolRounds;
      const held: AgentEvent[] = [];
      const say = function* (t: string): Generator<AgentEvent> {
        if (!t) return;
        const e: AgentEvent = { type: "text.delta", id: turnId, text: t };
        if (hold) held.push(e);
        else {
          wroteText = true;
          yield e;
        }
      };
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
          // the text before a tool and the verdict after it are separate paragraphs
          const lead = text === "" && wroteText ? "\n\n" : "";
          text += d.content;
          yield* say(plain.push(lead + d.content));
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
      yield* say(plain.flush());
      const nudge = hold && calls.size === 0;
      if (!nudge) {
        for (const e of held) {
          wroteText = true;
          yield e;
        }
        fullText += text;
      }
      const callCost = costUsd(model, callIn, callOut);
      usage.calls += 1;
      usage.tokensIn += callIn;
      usage.tokensOut += callOut;
      usage.costUsd += callCost;
      // One cost event per model call, so a stopped or failed turn is still charged for what it used.
      yield { type: "cost", id: turnId, usd: callCost, tokens_in: callIn, tokens_out: callOut, model };
      budget -= used || Math.ceil((text.length + [...calls.values()].reduce((n, c) => n + c.args.length, 0)) / 3);

      if (nudge) {
        nudged = true;
        messages.push({ role: "assistant", content: text }, { role: "user", content: "Nothing was solved yet, so there is no temperature to report. Call matter_simulate again now with fewer or thinner fins (for example n_fins 4 and fin_len 8, or a larger budget_fraction), then answer." });
        continue;
      }
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
        const result = parseError ? ({ ok: false, error: parseError } as const) : !offered ? ({ ok: false, error: `${c.name} is not available here` } as const) : await runTool(c.name, parsed, loader, { ...input.tools, boardDesign: input.context?.board?.design });
        if (result.ok) for (const e of result.evidence) known.add(e);
        ran.push({ name: c.name, ok: result.ok, data: result.ok ? result.data : null });
        sources.push(result.ok ? `${result.summary} ${JSON.stringify(result.data ?? "")}` : result.error);
        if (result.ok && result.proposal) proposed = true;
        yield { type: "tool.result", id: turnId, callId, ok: result.ok, summary: result.ok ? result.summary : result.error };
        if (result.ok) {
          for (const a of result.ui ?? []) {
            // the model often opens a workbench and then calls a tool that opens it again: show it once
            if (a.name === "workbench.open") {
              if (opened.has(a.args.workbench)) continue;
              opened.add(a.args.workbench);
            }
            yield { type: "ui.action", id: turnId, action: a };
          }
          if (result.proposal) yield { type: "action.proposed", action: { id: `p_${turnId}_${callId}`, ...result.proposal } };
        }
        made.push({ id: callId, type: "function", function: { name: c.name, arguments: c.args || "{}" } });
        toolMsgs.push({ role: "tool", tool_call_id: callId, content: JSON.stringify(result.ok ? { ok: true, summary: result.summary, ...(result.data as object | null ? { data: result.data } : {}), evidence_ids: result.evidence } : { ok: false, error: result.error }) });
      }
      messages.push({ role: "assistant", content: text || null, tool_calls: made }, ...toolMsgs);
      if (round === cfg.maxToolRounds) break;
    }
    // A sentence-ending full stop is not part of an id (node ids contain dots).
    // The answer no longer carries ids in its prose (the app shows them behind a toggle), so the evidence is what this turn's tools returned,
    // with the ids the model did cite first.
    const cited = [...new Set((fullText.match(EVIDENCE_ID) ?? []).map((id) => id.replace(/\.+$/, "")))].filter((id) => known.has(id));
    const shown = [...new Set([...cited, ...known])].slice(0, 12);
    if (shown.length) yield { type: "evidence", id: turnId, ids: shown };
    const chips = followUps(workbench, ran, proposed);
    if (chips.length) yield { type: "suggest", id: turnId, chips };
    // Post-check: a verify-entry command for an id that is not a library entry is invented. The text is already streamed, so flag it.
    const entryIds = (await input.tools?.manifests?.ids()) ?? [];
    for (const f of [...guardText(fullText, entryIds), ...guardNumbers(fullText, sources)]) yield { type: "flag", id: turnId, kind: f.kind, message: f.message };
    yield { type: "turn.done", id: turnId, usage };
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      yield { type: "turn.error", id: turnId, message: "Stopped." };
      return;
    }
    yield { type: "turn.error", id: turnId, message: "The agent connection failed." };
  }
}

/** Follow-up prompts, from what the turn actually did. Deterministic: the model does not write these. */
export function followUps(workbench: WorkbenchId | undefined, ran: ReadonlyArray<{ name: string; ok: boolean; data: unknown }>, proposed: boolean): string[] {
  const ok = ran.filter((r) => r.ok);
  const last = (n: string) => [...ok].reverse().find((r) => r.name === n);
  const board = last("board_check") ?? last("board_set_design");
  if (board) {
    const passed = (board.data as { passed?: boolean } | null)?.passed;
    return passed === false ? ["Fix the failing check", "Explain the failing check"] : ["Try the board with a wrong pin", "What does this not prove?"];
  }
  const sim = last("matter_simulate");
  if (sim) {
    const peak = (sim.data as { peak_temp_c?: number } | null)?.peak_temp_c;
    return peak === undefined ? ["Try fewer fins", "Use radial spokes instead"] : ["Make it cooler", "Use radial spokes instead", "How much material does it use?"];
  }
  if (proposed) return [];
  if (!workbench) return [];
  return workbench === "silicon" ? ["Make this loop faster with a custom instruction"] : [];
}
