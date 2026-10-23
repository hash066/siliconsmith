// The two credit-spending loops with a scripted model and scripted hosted checkers (test only).
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent";
import { BOARD_MAX_REPAIRS, extractJsonObject, LOOP_CAPS, MATTER_MAX_SIMULATIONS, Meter, runBoardDesign, runMatterOptimize, type LlmReply, type LoopLlm } from "./agent-loops";
import type { HostedCaller } from "./agent-tools";

const collect = async (g: AsyncGenerator<AgentEvent>) => {
  const out: AgentEvent[] = [];
  for await (const e of g) out.push(e);
  return out;
};
const reply = (text: string, tokensIn = 2500, tokensOut = 400): LlmReply => ({ text, tokensIn, tokensOut });
const scriptedLlm = (replies: Array<LlmReply | Error>) => {
  const calls: Array<{ model: string; user: string }> = [];
  let i = 0;
  const llm: LoopLlm = {
    async call({ model, user }) {
      calls.push({ model, user });
      const r = replies[Math.min(i++, replies.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { llm, calls };
};
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("extractJsonObject", () => {
  it("finds the object in prose and code fences, with braces inside strings", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"a": {"b": "}"}, "c": [1]}\n```\nbye')).toEqual({ a: { b: "}" }, c: [1] });
    expect(extractJsonObject("no json")).toBeNull();
    expect(extractJsonObject('{"a": ')).toBeNull();
    expect(extractJsonObject("[1,2]")).toBeNull();
  });
});

describe("Meter caps", () => {
  it("refuses a call whose worst case crosses the dollar cap or the time cap", () => {
    let t = 1000;
    const m = new Meter({ usd: 0.05, seconds: 90 }, () => t);
    expect(m.canAfford("super", 10_000, 1000).ok).toBe(true);
    m.add("ultra", { text: "", tokensIn: 40_000, tokensOut: 4000 }); // 0.04 + 0.012
    expect(m.usd).toBeCloseTo(0.052, 6);
    expect(m.canAfford("nano", 1000, 100)).toMatchObject({ ok: false });
    const m2 = new Meter({ usd: 1, seconds: 90 }, () => t);
    t += 91_000;
    expect(m2.canAfford("nano", 10, 10)).toMatchObject({ ok: false, why: expect.stringContaining("time cap") });
  });
  it("has the documented hard caps", () => {
    expect(LOOP_CAPS).toEqual({ usd: 0.05, seconds: 90 });
    expect(BOARD_MAX_REPAIRS).toBe(2);
    expect(MATTER_MAX_SIMULATIONS).toBe(6);
  });
});

// ------------------------------------------------------------------------------------------------------------- board_design

const REFERENCE = { name: "ref", instances: [{ ref: "U1", part: "esp32" }], nets: [] };
function boardHosted(checkResults: Array<{ passed: boolean }>): { hosted: HostedCaller; checked: string[] } {
  const checked: string[] = [];
  let n = 0;
  const hosted: HostedCaller = async (path, init) => {
    if (path === "/api/board/templates/clean_sensor") return j(200, { design: REFERENCE });
    if (path === "/api/board/parts") return j(200, { parts: [{ id: "esp32", kind: "mcu", pins: [{ name: "GPIO4" }, { name: "GPIO12" }] }] });
    if (path === "/api/board/check") {
      checked.push(JSON.parse(String(init?.body)).design);
      const r = checkResults[Math.min(n++, checkResults.length - 1)];
      return j(200, {
        ok: true,
        passed: r.passed,
        rungs: ["B1", "B2", "B3", "B4", "B5"].map((x) => ({ rung: x, status: r.passed || x !== "B4" ? "pass" : "fail", label: r.passed ? "claim" : null, detail: r.passed || x !== "B4" ? "ok" : "wake_btn: GPIO12 vs GPIO14", evidence: x === "B4" ? ["part:esp32.gpio12"] : [] })),
      });
    }
    return j(404, {});
  };
  return { hosted, checked };
}

describe("board_design loop", () => {
  it("drafts with Ultra, repairs with Super, stops when the checker passes, and applies each attempt to the app", async () => {
    const { llm, calls } = scriptedLlm([reply('{"name":"draft1","instances":[],"nets":[]}'), reply('```json\n{"name":"draft2","instances":[],"nets":[]}\n```')]);
    const { hosted, checked } = boardHosted([{ passed: false }, { passed: true }]);
    const events = await collect(runBoardDesign({ turnId: "b", brief: "an ESP32 with an LED", llm, hosted }));
    expect(calls.map((c) => c.model)).toEqual(["ultra", "super"]);
    expect(calls[1].user).toContain("B4 fail");
    expect(calls[1].user).toContain("part:esp32.gpio12");
    expect(checked).toHaveLength(2);
    const ui = events.filter((e) => e.type === "ui.action") as Array<Extract<AgentEvent, { type: "ui.action" }>>;
    expect(ui.map((u) => u.action.name)).toEqual(["board.set_design", "board.check", "board.set_design", "board.check"]);
    const text = events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("passes all 5 rungs on attempt 2");
    expect(text).toContain("author-curated");
    expect(text).toContain("not a claim the board works");
    const ev = events.find((e) => e.type === "evidence") as Extract<AgentEvent, { type: "evidence" }>;
    expect(ev.ids).toContain("board:custom#B4");
    const cost = events.find((e) => e.type === "cost") as Extract<AgentEvent, { type: "cost" }>;
    expect(cost.usd).toBeCloseTo((2500 * 1 + 400 * 3 + 2500 * 0.3 + 400 * 0.9) / 1e6, 8);
    expect(events.at(-1)?.type).toBe("turn.done");
  });

  it("gives up after 2 repairs and says no attempt passed; the model never decides the outcome", async () => {
    const { llm, calls } = scriptedLlm([reply('{"name":"d","instances":[],"nets":[]}')]);
    const { hosted } = boardHosted([{ passed: false }]);
    const events = await collect(runBoardDesign({ turnId: "b", brief: "x", llm, hosted }));
    expect(calls).toHaveLength(1 + BOARD_MAX_REPAIRS);
    const text = events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("No attempt passed every rung");
    expect(text).toContain("B4 (fail)");
    expect(text).not.toMatch(/passes all/);
  });

  it("an unreadable reply costs an attempt and is repaired; a model error stops the loop with the reason and no crash", async () => {
    const a = scriptedLlm([reply("sorry I cannot"), reply('{"name":"d","instances":[],"nets":[]}')]);
    const { hosted } = boardHosted([{ passed: true }]);
    const events = await collect(runBoardDesign({ turnId: "b", brief: "x", llm: a.llm, hosted }));
    expect(events.some((e) => e.type === "tool.result" && !e.ok && e.summary.includes("no readable JSON"))).toBe(true);
    expect(events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("")).toContain("passes all 5 rungs on attempt 2");

    const err = scriptedLlm([new Error("The model endpoint answered 429.")]);
    const stopped = await collect(runBoardDesign({ turnId: "b", brief: "x", llm: err.llm, hosted }));
    const t = stopped.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
    expect(t).toContain("Stopped early: The model endpoint answered 429.");
    expect(stopped.at(-1)?.type).toBe("turn.done");
  });

  it("stops before a call that would cross the $0.05 cap, charging only what was used", async () => {
    // the first reply reports 40k in / 2.8k out on Ultra = $0.0484, so the repair call's worst case would cross $0.05
    const { llm, calls } = scriptedLlm([reply('{"name":"d","instances":[],"nets":[]}', 40_000, 2800)]);
    const { hosted } = boardHosted([{ passed: false }]);
    const events = await collect(runBoardDesign({ turnId: "b", brief: "x", llm, hosted }));
    expect(calls).toHaveLength(1);
    const text = events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("Stopped early:");
    expect(text).toContain("cap would be crossed");
    const cost = events.find((e) => e.type === "cost") as Extract<AgentEvent, { type: "cost" }>;
    expect(cost.usd).toBeLessThan(0.05);
  });

  it("without the Board service it spends nothing and says so", async () => {
    const { llm, calls } = scriptedLlm([reply("{}")]);
    const events = await collect(runBoardDesign({ turnId: "b", brief: "x", llm, hosted: async () => j(503, {}) }));
    expect(calls).toHaveLength(0);
    expect(events.find((e) => e.type === "text.delta")).toMatchObject({ text: expect.stringContaining("Nothing was spent") });
  });
});

// ----------------------------------------------------------------------------------------------------------- matter_optimize

function matterHosted(peakFor: (p: Record<string, number>) => number, m2 = "pass") {
  const sims: Array<Record<string, number>> = [];
  const hosted: HostedCaller = async (path, init) => {
    if (path !== "/api/matter/simulate") return j(404, {});
    const body = JSON.parse(String(init?.body));
    sims.push(body.gen_params);
    const peak = peakFor(body.gen_params);
    return j(200, {
      ok: true,
      ladder: [{ id: "M1", status: "pass" }, { id: "M2", status: m2 }, { id: "M3", status: "pass" }, { id: "M4", status: "pass" }, { id: "M5", status: "fail" }],
      metrics: { peak_temp_c: peak, peak_rise_k: peak - 25, material_cells: 1000, material_fraction: 0.3, heat_balance_rel: 1e-12 },
      baselines: { equal_material: { peak_temp_c: 80, delta_k: 0, cells: 1000, params: {} }, full_budget: { peak_temp_c: 72, delta_k: 0, cells: 1440, params: {} } },
      verdict: { label: "Does not beat a rectangular-fin baseline", note: "n" },
    });
  };
  return { hosted, sims };
}
const gp = (n_fins: number, fin_len = 16) => JSON.stringify({ gen_params: { spine: 8, n_fins, fin_w: 3, fin_len } });

describe("matter_optimize loop", () => {
  it("tries parameters, keeps the lowest valid peak, applies it to the app, and reports the baselines honestly", async () => {
    const { llm } = scriptedLlm([reply(gp(10), 600, 40), reply(gp(12), 600, 40), reply(gp(9), 600, 40), reply(gp(11), 600, 40), reply(gp(13), 600, 40)]);
    const { hosted, sims } = matterHosted((p) => 90 - p.n_fins); // more fins -> lower peak
    const events = await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm, hosted }));
    expect(sims).toHaveLength(MATTER_MAX_SIMULATIONS);
    const ui = events.filter((e) => e.type === "ui.action") as Array<Extract<AgentEvent, { type: "ui.action" }>>;
    const last = ui.at(-2)!.action;
    expect(last).toMatchObject({ name: "matter.set_params", args: { gen_params: { n_fins: 13 } } });
    expect(ui.at(-1)!.action.name).toBe("matter.simulate");
    const text = events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("Best of 6 simulations: #6, peak 77.00 °C (first try 82.00 °C)");
    expect(text).toContain("equal material 80.00 °C");
    expect(text).toContain("full budget 72.00 °C");
    expect(text).toContain("Does not beat a rectangular-fin baseline");
    expect(text).toContain("not validated on a printed part");
    const ev = events.find((e) => e.type === "evidence") as Extract<AgentEvent, { type: "evidence" }>;
    expect(ev.ids).toContain("matter:rect_fins#M5");
  });

  it("never runs more than 6 simulations and stops when the model repeats itself", async () => {
    const { llm } = scriptedLlm([reply(gp(8))]); // the default start is n_fins 8: the very first proposal repeats
    const { hosted, sims } = matterHosted(() => 82);
    const events = await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm, hosted }));
    expect(sims).toHaveLength(1);
    const text = events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("the search stopped repeating itself");
  });

  it("out-of-range or unreadable proposals stop the loop without simulating them", async () => {
    const bad = scriptedLlm([reply('{"gen_params":{"spine":99,"n_fins":10,"fin_w":3,"fin_len":16}}')]);
    const a = matterHosted(() => 82);
    const evA = await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm: bad.llm, hosted: a.hosted }));
    expect(a.sims).toHaveLength(1);
    expect(evA.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("")).toContain("out of range");
    const junk = scriptedLlm([reply("try more fins")]);
    const b = matterHosted(() => 82);
    const evB = await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm: junk.llm, hosted: b.hosted }));
    expect(b.sims).toHaveLength(1);
    expect(evB.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("")).toContain("did not return usable parameters");
  });

  it("a reply that names only some parameters keeps the others from the last attempt, and a bare object without the gen_params wrapper is accepted", async () => {
    const { llm } = scriptedLlm([reply('{"n_fins": 11}'), reply('{"gen_params": {"fin_len": 18}}'), reply("{}")]);
    const { hosted, sims } = matterHosted((p) => 90 - p.n_fins);
    await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm, hosted }));
    expect(sims[1]).toEqual({ spine: 8, n_fins: 11, fin_w: 3, fin_len: 16 });
    expect(sims[2]).toEqual({ spine: 8, n_fins: 11, fin_w: 3, fin_len: 18 });
    expect(sims).toHaveLength(3); // the third reply names nothing usable, so the loop stops
  });

  it("prefers a valid geometry over a lower peak from an invalid one, and says when none was valid", async () => {
    const { llm } = scriptedLlm([reply(gp(12))]);
    const { hosted } = matterHosted(() => 70, "fail"); // M2 fails for every attempt
    const events = await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm, hosted }));
    const text = events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("no attempt had a valid printable geometry");
  });

  it("an invalid geometry that was never solved (empty metrics, no baselines) is recorded, shown to the model, and can never be the best", async () => {
    const hostedMixed: HostedCaller = async (path, init) => {
      const body = JSON.parse(String(init?.body));
      const bad = body.gen_params.n_fins >= 10;
      return j(200, {
        ok: true,
        ladder: [{ id: "M1", status: "pass" }, { id: "M2", status: bad ? "fail" : "pass", detail: "material 1620 cells exceeds budget 1440" }, { id: "M3", status: bad ? "skipped" : "pass" }, { id: "M4", status: bad ? "skipped" : "pass" }, { id: "M5", status: bad ? "skipped" : "fail" }],
        metrics: bad ? {} : { peak_temp_c: 82, peak_rise_k: 57, material_cells: 1000, material_fraction: 0.3, heat_balance_rel: 0 },
        baselines: { equal_material: bad ? null : { peak_temp_c: 80, delta_k: -2, cells: 1000, params: {} }, full_budget: { peak_temp_c: 72, delta_k: null, cells: 1440, params: {} } },
        verdict: null,
      });
    };
    const { llm, calls } = scriptedLlm([reply(gp(12)), reply(gp(9))]);
    const events = await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm, hosted: hostedMixed }));
    expect(calls[1].user).toContain("NOT SOLVED");
    expect(calls[1].user).toContain("exceeds budget");
    const text = events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("peak 82.00 °C");
    expect(text).not.toMatch(/Stopped early: Cannot read/);
    expect(events.some((e) => e.type === "tool.result" && e.summary.startsWith("not solved"))).toBe(true);
    // when nothing at all was solved there is no result and no invented peak
    const none = await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm: scriptedLlm([reply(gp(12))]).llm, hosted: async () => j(200, { ok: true, ladder: [{ id: "M2", status: "fail", detail: "x" }], metrics: {}, baselines: { equal_material: null, full_budget: null }, verdict: null }) }));
    expect(none.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("")).toContain("No simulation completed");
  });

  it("the simulator being down ends the loop without a result or a crash", async () => {
    const { llm } = scriptedLlm([reply(gp(10))]);
    const events = await collect(runMatterOptimize({ turnId: "m", generator: "rect_fins", llm, hosted: async () => j(503, {}) }));
    expect(events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("")).toContain("No simulation completed");
    expect(events.at(-1)?.type).toBe("turn.done");
  });
});
