// Two bounded loops that spend credits. They run only after the user clicks Run on a proposal (the route requires `confirm`), under a hard
// cap in dollars and seconds. Every figure in their summaries comes from the free deterministic checkers, never from the model's prose;
// the model only drafts a design or proposes the next parameters.

import type { AgentEvent, AgentModel } from "./agent";
import type { UiAction } from "./agent-actions";
import type { HostedCaller } from "./agent-tools";
import { costUsd } from "./credits";
import { defaultSimulateInput, MATTER_GENERATORS, validateLocally, type BoardCheck, type MatterGenerator, type MatterSimulation, type SimulateInput } from "./hosted";

export const LOOP_CAPS = { usd: 0.05, seconds: 90 } as const;
export const MATTER_MAX_SIMULATIONS = 6;
export const BOARD_MAX_REPAIRS = 2;

export interface LlmReply {
  text: string;
  tokensIn: number;
  tokensOut: number;
}
export interface LoopLlm {
  call(args: { model: AgentModel; system: string; user: string; maxTokens: number; signal?: AbortSignal }): Promise<LlmReply>;
}

/** A non-streaming chat completion on Token Factory. Status-only errors; the upstream body is never echoed. */
export function httpLlm(cfg: { apiKey: string; baseUrl: string; models: Record<AgentModel, string> }, fetchImpl: typeof fetch = fetch): LoopLlm {
  return {
    async call({ model, system, user, maxTokens, signal }) {
      const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.models[model],
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      if (!res.ok) throw new Error(`The model endpoint answered ${res.status}.`);
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      return { text: j.choices?.[0]?.message?.content ?? "", tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
    },
  };
}

/** The first balanced JSON object in model text (models wrap JSON in prose or code fences). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        const v = JSON.parse(text.slice(start, i + 1)) as unknown;
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Tracks spend and time against the caps; a call is refused if its worst case would cross either. */
export class Meter {
  usd = 0;
  tokensIn = 0;
  tokensOut = 0;
  private t0: number;
  constructor(
    readonly caps: { usd: number; seconds: number } = LOOP_CAPS,
    private now: () => number = () => Date.now(),
  ) {
    this.t0 = now();
  }
  elapsedS() {
    return (this.now() - this.t0) / 1000;
  }
  /** Rough prompt size: 1 token per 3.5 characters, rounded up (a safe over-estimate for JSON). */
  canAfford(model: AgentModel, promptChars: number, maxOut: number): { ok: true } | { ok: false; why: string } {
    if (this.elapsedS() >= this.caps.seconds) return { ok: false, why: `the ${this.caps.seconds} s time cap was reached` };
    const worst = costUsd(model, Math.ceil(promptChars / 3.5), maxOut);
    if (this.usd + worst > this.caps.usd) return { ok: false, why: `the $${this.caps.usd.toFixed(2)} cap would be crossed` };
    return { ok: true };
  }
  add(model: AgentModel, r: LlmReply) {
    this.usd += costUsd(model, r.tokensIn, r.tokensOut);
    this.tokensIn += r.tokensIn;
    this.tokensOut += r.tokensOut;
  }
}

interface LoopInput {
  turnId: string;
  llm: LoopLlm;
  hosted: HostedCaller;
  signal?: AbortSignal;
  meter?: Meter;
}

async function hostedJson<T>(hosted: HostedCaller, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: T | null }> {
  const res = await hosted(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let json: T | null = null;
  try {
    json = (await res.json()) as T;
  } catch {
    // leave null
  }
  return { ok: res.ok, status: res.status, json };
}

let seq = 0;
const cid = (p: string) => `${p}${(seq++).toString(36)}`;

// --------------------------------------------------------------------------------------------------------- Board design

const BOARD_SYSTEM = `You edit board designs for a netlist-level checker. Output ONLY one JSON object: the complete design, in exactly the format of the reference design.
Rules: use only parts and pin names from the parts list; each net lists pins as "REF.PIN"; keep the reference's assumptions; keep mcu_assignments and firmware_pins consistent (same function, same MCU pin, same use) and make the net each function is wired to match that pin. Avoid flash pins, strapping pins and input-only pins used as outputs. No comments, no prose.`;

interface PartSummary {
  id: string;
  kind?: string;
  pins?: Array<{ name: string; direction?: string }>;
}

export const compactParts = (parts: PartSummary[]): string => parts.map((p) => `${p.id}${p.kind ? ` (${p.kind})` : ""}: ${(p.pins ?? []).map((x) => x.name).join(",")}`).join("\n");

/** Draft a design with the model, judge it with the free checker, repair up to twice. Yields the same events a normal turn does. */
export async function* runBoardDesign(input: LoopInput & { brief: string }): AsyncGenerator<AgentEvent> {
  const { turnId, llm, hosted } = input;
  const meter = input.meter ?? new Meter();
  yield { type: "turn.started", id: turnId, model: "ultra" };
  const brief = input.brief.trim().slice(0, 500);
  const evidence = new Set<string>();
  const attempts: Array<{ n: number; passed: boolean; rungs: Array<{ rung: string; status: string }>; error?: string }> = [];
  let lastDesign: Record<string, unknown> | null = null;
  let lastCheck: BoardCheck | null = null;
  let stopReason: string | null = null;

  const step = async function* (name: string, args: Record<string, unknown>, run: () => Promise<{ ok: boolean; summary: string; ui?: UiAction[] }>): AsyncGenerator<AgentEvent> {
    const id = cid("loop");
    yield { type: "tool.call", id: turnId, call: { id, name, args } };
    const r = await run();
    yield { type: "tool.result", id: turnId, callId: id, ok: r.ok, summary: r.summary };
    for (const a of r.ui ?? []) yield { type: "ui.action", id: turnId, action: a };
  };

  try {
    const [tpl, parts] = await Promise.all([hostedJson<{ design: Record<string, unknown> }>(hosted, "/api/board/templates/clean_sensor"), hostedJson<{ parts: PartSummary[] }>(hosted, "/api/board/parts")]);
    if (!tpl.ok || !tpl.json?.design || !parts.ok || !parts.json?.parts) {
      yield { type: "text.delta", id: turnId, text: "The Board service is not reachable, so no design was drafted. Nothing was spent." };
      yield { type: "turn.done", id: turnId };
      return;
    }
    const reference = JSON.stringify(tpl.json.design);
    const partList = compactParts(parts.json.parts);

    let prompt = `Reference design (a clean sensor board that passes every rung):\n${reference}\n\nParts library:\n${partList}\n\nBrief: ${brief}\n\nOutput the complete design JSON for the brief.`;
    let model: AgentModel = "ultra";
    for (let attempt = 0; attempt <= BOARD_MAX_REPAIRS; attempt++) {
      const maxOut = 3200;
      const ok = meter.canAfford(model, prompt.length + BOARD_SYSTEM.length, maxOut);
      if (!ok.ok) {
        stopReason = ok.why;
        break;
      }
      let reply: LlmReply | null = null;
      let drafted: Record<string, unknown> | null = null;
      yield* step(attempt === 0 ? "draft_design" : "repair_design", { attempt, model }, async () => {
        reply = await llm.call({ model, system: BOARD_SYSTEM, user: prompt, maxTokens: maxOut, signal: input.signal });
        meter.add(model, reply);
        drafted = extractJsonObject(reply.text);
        return { ok: !!drafted, summary: drafted ? `design JSON received (${JSON.stringify(drafted).length.toLocaleString("en-US")} chars)` : "the reply had no readable JSON object" };
      });
      if (!drafted) {
        attempts.push({ n: attempt + 1, passed: false, rungs: [], error: "no readable JSON" });
        prompt = `${prompt}\n\nYour last reply had no readable JSON object. Output ONLY the JSON object.`;
        model = "super";
        continue;
      }
      lastDesign = drafted;
      let checkRes: { passed: boolean; rungs: BoardCheck["rungs"] } | null = null;
      yield* step("board_check", { attempt: attempt + 1 }, async () => {
        const r = await hostedJson<BoardCheck & { error?: { message?: string } }>(hosted, "/api/board/check", { design: JSON.stringify(drafted) });
        if (!r.ok || !r.json?.rungs) return { ok: false, summary: r.json?.error?.message ?? `the checker answered ${r.status}` };
        lastCheck = r.json;
        checkRes = { passed: r.json.passed, rungs: r.json.rungs };
        const passN = r.json.rungs.filter((x) => x.status === "pass").length;
        const ui: UiAction[] = [
          { name: "board.set_design", args: { design: drafted } },
          { name: "board.check", args: {} },
        ];
        return { ok: true, summary: `${passN} of ${r.json.rungs.length} rungs pass${r.json.passed ? "" : "; unknown or failing rungs do not count"}`, ui };
      });
      if (!checkRes) {
        attempts.push({ n: attempt + 1, passed: false, rungs: [], error: "the checker rejected the input" });
        const r = await hostedJson<{ error?: { message?: string } }>(hosted, "/api/board/check", { design: JSON.stringify(drafted) });
        prompt = `${prompt}\n\nThe checker rejected your JSON: ${r.json?.error?.message ?? "invalid design"}. Fix it and output ONLY the JSON object.`;
        model = "super";
        continue;
      }
      const cr = checkRes as { passed: boolean; rungs: BoardCheck["rungs"] };
      attempts.push({ n: attempt + 1, passed: cr.passed, rungs: cr.rungs.map((r) => ({ rung: r.rung, status: r.status })) });
      for (const r of cr.rungs) {
        evidence.add(`board:custom#${r.rung}`);
        if (r.status !== "pass") for (const f of r.evidence.slice(0, 4)) evidence.add(f);
      }
      if (cr.passed) break;
      const failing = cr.rungs.filter((r) => r.status !== "pass").map((r) => `${r.rung} ${r.status}: ${r.detail.slice(0, 400)} [facts: ${r.evidence.slice(0, 4).join(", ")}]`);
      prompt = `Reference design:\n${reference}\n\nParts library:\n${partList}\n\nBrief: ${brief}\n\nYour design failed these rungs:\n${failing.join("\n")}\n\nYour design was:\n${JSON.stringify(drafted)}\n\nOutput the corrected complete design JSON only.`;
      model = "super";
    }
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      yield { type: "turn.error", id: turnId, message: "Stopped." };
      return;
    }
    console.error("[agent-loop]", err instanceof Error ? err.stack : err);
    stopReason = err instanceof Error ? err.message : "the loop failed";
  }

  const last = attempts.at(-1);
  const lines: string[] = [];
  if (last?.passed) lines.push(`The checker passes all ${last.rungs.length} rungs on attempt ${last.n} (author-curated facts; netlist-level only, not a claim the board works). The design is on the canvas.`);
  else if (last && last.rungs.length) lines.push(`No attempt passed every rung. The last (attempt ${last.n}) passes ${last.rungs.filter((r) => r.status === "pass").length} of ${last.rungs.length}; failing or unknown: ${last.rungs.filter((r) => r.status !== "pass").map((r) => `${r.rung} (${r.status})`).join(", ")}. It is on the canvas so you can inspect it.`);
  else lines.push("No design the checker could read was produced.");
  if (stopReason) lines.push(`Stopped early: ${stopReason}.`);
  lines.push(`Attempts: ${attempts.length}. Spent about $${meter.usd.toFixed(4)} in ${meter.elapsedS().toFixed(0)} s.`);
  yield { type: "text.delta", id: turnId, text: lines.join("\n\n") };
  if (lastDesign && !lastCheck) yield { type: "text.delta", id: turnId, text: "\n\n(The last draft could not be checked.)" };
  yield { type: "cost", id: turnId, usd: meter.usd, tokens_in: meter.tokensIn, tokens_out: meter.tokensOut, model: "ultra" };
  if (evidence.size) yield { type: "evidence", id: turnId, ids: [...evidence] };
  yield { type: "turn.done", id: turnId };
}

// ------------------------------------------------------------------------------------------------------- Matter optimise

const MATTER_SYSTEM = `You tune the parameters of a built-in heat-spreader generator to lower the peak temperature of the plate. A solver judges every proposal; you only choose numbers.
Reply with ONLY a JSON object {"gen_params": {...}} using exactly the parameter names given, integer values inside the stated ranges. Prefer changes that keep the geometry valid (rungs M2 and M3 pass). No prose.`;

interface Tried {
  params: Record<string, number>;
  /** null when nothing was solved (the geometry failed M2 before the solve): such an attempt can never be the best. */
  peak: number | null;
  m2: string;
  m3: string;
  m5: string;
  sim: MatterSimulation;
}

const sameParams = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).every((k) => a[k] === b[k]);

/** Up to six simulations. The best valid result (M2 and M3 pass, lowest peak) is applied to the canvas at the end. */
export async function* runMatterOptimize(input: LoopInput & { generator: MatterGenerator; start?: Record<string, number> }): AsyncGenerator<AgentEvent> {
  const { turnId, llm, hosted } = input;
  const meter = input.meter ?? new Meter();
  const gen = input.generator;
  const spec = MATTER_GENERATORS[gen];
  yield { type: "turn.started", id: turnId, model: "super" };
  const base = defaultSimulateInput(gen);
  const tried: Tried[] = [];
  let stopReason: string | null = null;
  let params: Record<string, number> = { ...base.gen_params, ...(input.start ?? {}) };
  const ranges = spec.params.map((p) => `${p.key}: ${p.min}..${p.max} (${p.label}, ${p.unit || "count"})`).join("\n");

  try {
    for (let i = 0; i < MATTER_MAX_SIMULATIONS; i++) {
      const simInput: SimulateInput = { generator: gen, gen_params: params, spreader: base.spreader };
      const bad = validateLocally(simInput);
      if (bad.length) {
        stopReason = `the proposed parameters were out of range (${bad.map((b) => b.path).join(", ")})`;
        break;
      }
      const callId = cid("sim");
      yield { type: "tool.call", id: turnId, call: { id: callId, name: "matter_simulate", args: { generator: gen, gen_params: params } } };
      const r = await hostedJson<MatterSimulation & { error?: { message?: string } }>(hosted, "/api/matter/simulate", simInput);
      if (!r.ok || !r.json?.ladder) {
        yield { type: "tool.result", id: turnId, callId, ok: false, summary: r.json?.error?.message ?? `the simulator answered ${r.status}` };
        stopReason = "the simulator did not answer";
        break;
      }
      const sim = r.json;
      const st = (id: string) => sim.ladder.find((x) => x.id === id)?.status ?? "unknown";
      const peak = typeof sim.metrics.peak_temp_c === "number" ? sim.metrics.peak_temp_c : null;
      tried.push({ params: { ...params }, peak, m2: st("M2"), m3: st("M3"), m5: st("M5"), sim });
      yield { type: "tool.result", id: turnId, callId, ok: true, summary: peak === null ? `not solved: ${sim.ladder.find((x) => x.status === "fail")?.detail ?? "geometry rejected"}` : `peak ${peak.toFixed(1)} °C, M2 ${st("M2")}, M3 ${st("M3")}, M5 ${st("M5")}` };
      yield { type: "ui.action", id: turnId, action: { name: "matter.set_params", args: { generator: gen, gen_params: params, spreader: base.spreader } } };
      yield { type: "ui.action", id: turnId, action: { name: "matter.simulate", args: {} } };

      if (i === MATTER_MAX_SIMULATIONS - 1) break;
      const history = tried
        .map((t, k) =>
          t.peak === null
            ? `#${k + 1} ${JSON.stringify(t.params)} -> NOT SOLVED: ${t.sim.ladder.find((x) => x.status === "fail")?.detail ?? "geometry rejected"}`
            : `#${k + 1} ${JSON.stringify(t.params)} -> peak ${t.peak.toFixed(2)} C, M2 ${t.m2}, M3 ${t.m3}, material ${((t.sim.metrics.material_fraction ?? 0) * 100).toFixed(1)}%`,
        )
        .join("\n");
      const prompt = `Generator: ${spec.label}.\nParameters and ranges:\n${ranges}\n\nSpreader: ${JSON.stringify(base.spreader)} (material limit is a fraction of the plate; M2 fails if exceeded).\n\nTried so far:\n${history}\n\nPropose the next gen_params to lower the peak temperature.`;
      const ok = meter.canAfford("super", prompt.length + MATTER_SYSTEM.length, 300);
      if (!ok.ok) {
        stopReason = ok.why;
        break;
      }
      const nid = cid("next");
      yield { type: "tool.call", id: turnId, call: { id: nid, name: "propose_parameters", args: { model: "super", tried: tried.length } } };
      const reply = await llm.call({ model: "super", system: MATTER_SYSTEM, user: prompt, maxTokens: 300, signal: input.signal });
      meter.add("super", reply);
      const obj = extractJsonObject(reply.text);
      const gp = obj && typeof obj.gen_params === "object" && obj.gen_params !== null ? (obj.gen_params as Record<string, unknown>) : null;
      const next: Record<string, number> = {};
      const flat = gp ?? (obj && spec.params.some((p) => typeof obj[p.key] === "number") ? obj : null);
      let readable = !!flat;
      let named = 0;
      if (flat)
        for (const p of spec.params) {
          const v = flat[p.key];
          if (typeof v === "number" && Number.isFinite(v)) {
            next[p.key] = Math.round(v);
            named++;
          } else next[p.key] = params[p.key];
        }
      if (named === 0) readable = false;
      if (!readable) {
        yield { type: "tool.result", id: turnId, callId: nid, ok: false, summary: "the reply was not a full parameter set" };
        stopReason = "the model did not return usable parameters";
        break;
      }
      if (tried.some((t) => sameParams(t.params, next))) {
        yield { type: "tool.result", id: turnId, callId: nid, ok: true, summary: "proposed parameters already tried; stopping" };
        stopReason = "the search stopped repeating itself";
        break;
      }
      yield { type: "tool.result", id: turnId, callId: nid, ok: true, summary: JSON.stringify(next) };
      params = next;
    }
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      yield { type: "turn.error", id: turnId, message: "Stopped." };
      return;
    }
    console.error("[agent-loop]", err instanceof Error ? err.stack : err);
    stopReason = err instanceof Error ? err.message : "the loop failed";
  }

  const solved = tried.filter((t) => t.peak !== null);
  const valid = solved.filter((t) => t.m2 === "pass" && t.m3 === "pass");
  const pool = valid.length ? valid : solved;
  const best = pool.reduce<Tried | null>((b, t) => (!b || t.peak! < b.peak! ? t : b), null);
  const lines: string[] = [];
  const evidence: string[] = [];
  if (best) {
    const idx = tried.indexOf(best) + 1;
    const first = tried[0];
    const b = best.sim.baselines;
    lines.push(
      `Best of ${tried.length} simulation${tried.length === 1 ? "" : "s"}: #${idx}, peak ${best.peak!.toFixed(2)} °C${first && first !== best && first.peak !== null ? ` (first try ${first.peak.toFixed(2)} °C)` : ""}${valid.length ? "" : ", but no attempt had a valid printable geometry (M2 and M3)"}. It is on the canvas.`,
    );
    const bl = (x: { peak_temp_c: number } | null) => (x ? `${x.peak_temp_c.toFixed(2)} °C` : "not available");
    lines.push(`Baselines (plain rectangular fins): equal material ${bl(b.equal_material)}, full budget ${bl(b.full_budget)}. ${best.sim.verdict ? best.sim.verdict.label + "." : "No verdict: the geometry did not pass M2 and M3."} Margins are small model estimates (2D steady state, not validated on a printed part).`);
    for (const r of best.sim.ladder) evidence.push(`matter:${gen}#${r.id}`);
    yield { type: "ui.action", id: turnId, action: { name: "matter.set_params", args: { generator: gen, gen_params: best.params, spreader: base.spreader } } };
    yield { type: "ui.action", id: turnId, action: { name: "matter.simulate", args: {} } };
  } else lines.push("No simulation completed, so there is no result.");
  if (stopReason) lines.push(`Stopped early: ${stopReason}.`);
  lines.push(`Spent about $${meter.usd.toFixed(4)} in ${meter.elapsedS().toFixed(0)} s.`);
  yield { type: "text.delta", id: turnId, text: lines.join("\n\n") };
  yield { type: "cost", id: turnId, usd: meter.usd, tokens_in: meter.tokensIn, tokens_out: meter.tokensOut, model: "super" };
  if (evidence.length) yield { type: "evidence", id: turnId, ids: evidence };
  yield { type: "turn.done", id: turnId };
}
