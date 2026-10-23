// UX v2 behaviour of the agent with a scripted model (test only): routing a free-form goal from the start screen, translating plain requests
// into parameters, plain-language output, follow-up chips, the Silicon proposal and the live-run stub stream.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent";
import { configFromEnv, followUps, routeModel, runAgentTurn } from "./agent-server";
import { runSiliconRun } from "./agent-silicon";
import { fsReplayLoader, toolsFor, type HostedCaller } from "./agent-tools";
import { fsManifestStore } from "./manifest";

const loader = fsReplayLoader(resolve(__dirname, "../public/replays"));
const manifests = fsManifestStore(resolve(__dirname, "../../evidence"));
const cfg = configFromEnv({ NEBIUS_API_KEY: ["test", "key", "not", "real"].join("-") })!;

const sse = (...chunks: object[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200 });
const usage = { prompt_tokens: 3000, completion_tokens: 80 };
const toolCall = (name: string, args: object) => sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c_${name}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }], usage });
const say = (text: string) => sse({ choices: [{ delta: { content: text }, finish_reason: "stop" }], usage });
/** Text, then a tool call in the same reply (the model's one sentence before it acts). */
const sayThenCall = (text: string, name: string, args: object) =>
  sse({ choices: [{ delta: { content: text } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: `c_${name}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }], usage });

const simBodies: Array<Record<string, any>> = [];
const hosted: HostedCaller = async (path, init) => {
  const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  if (path === "/api/matter/simulate") {
    simBodies.push(JSON.parse(String(init?.body)));
    return j(200, { ok: true, ladder: [{ id: "M1", status: "pass", label: "Solver validated", detail: "d" }, { id: "M2", status: "pass", label: "Geometry valid", detail: "d" }, { id: "M5", status: "fail", label: null, detail: "does not beat baseline" }], metrics: { peak_temp_c: 68.4, material_fraction: 0.3 }, baselines: {}, verdict: null });
  }
  if (path.startsWith("/api/board/templates/")) return j(200, { design: { name: "x", instances: [], nets: [] } });
  if (path === "/api/board/check") return j(200, { ok: true, passed: false, rungs: [{ rung: "B4", status: "fail", label: null, detail: "GPIO12 vs GPIO14", evidence: ["part:esp32.gpio12.strapping"] }], notice: "n" });
  return j(404, {});
};

const run = async (text: string, replies: Response[], extra: Partial<Parameters<typeof runAgentTurn>[0]> = {}) => {
  const bodies: Array<Record<string, any>> = [];
  let n = 0;
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return replies[Math.min(n++, replies.length - 1)];
  }) as unknown as typeof fetch;
  const events: AgentEvent[] = [];
  for await (const e of runAgentTurn({ text, cfg, loader, turnId: "t", fetchImpl, tools: { manifests, hosted }, ...extra })) events.push(e);
  return { events, bodies };
};
const proseOf = (events: AgentEvent[]) => events.filter((e) => e.type === "text.delta").map((e) => (e as { text: string }).text).join("");
const uiOf = (events: AgentEvent[]) => events.filter((e) => e.type === "ui.action").map((e) => (e as { action: { name: string } }).action);

describe("intent routing from the start screen", () => {
  it("offers every workbench's tools when no workbench is open, and says so in the prompt", async () => {
    const names = toolsFor(undefined).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["workbench_open", "matter_simulate", "board_check", "propose_silicon_run"]));
    const { bodies } = await run("A heat sink for a 5 W chip, 40 mm square, under 70 C.", [say("hi")]);
    const system = String(bodies[0].messages[0].content);
    expect(system).toMatch(/start screen/);
    expect(system).toMatch(/ROUTING/);
    expect(system).toMatch(/plate_mm 40/);
  });

  it("a heat-sink goal opens Matter first, then simulates with the chip power and plate size translated into parameters", async () => {
    simBodies.length = 0;
    const { events } = await run("A heat sink for a 5 W chip, 40 mm square, under 70 C.", [
      sayThenCall("I will open the heat sink workbench.", "workbench_open", { workbench: "matter" }),
      sayThenCall("Now I will model a 5 W chip on a 40 mm plate.", "matter_simulate", { Q: 5, plate_mm: 40 }),
      say("The plate peaks at 68.4 C, under your 70 C target. It is a simple model, so treat it as an estimate."),
    ]);
    const ui = uiOf(events);
    expect(ui[0]).toEqual({ name: "workbench.open", args: { workbench: "matter" } });
    expect(ui.map((a) => a.name)).toEqual(["workbench.open", "matter.set_params", "matter.simulate"]);
    expect(simBodies[0].spreader).toMatchObject({ Q: 5, n: 40 });
    // two sentences before each tool, a paragraph break before the verdict
    const prose = proseOf(events);
    expect(prose).toContain("I will open the heat sink workbench.");
    expect(prose).toMatch(/40 mm plate\.\n\nThe plate peaks at 68\.4 C/);
    expect(events.at(-1)?.type).toBe("turn.done");
  });

  it("refuses a plate size the solver cannot do, in words the model can use", async () => {
    const { events } = await run("heat sink 200 mm", [toolCall("matter_simulate", { plate_mm: 200 }), say("The solver only does 30 to 80 mm plates.")]);
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ ok: false, summary: expect.stringContaining("30 and 80") });
  });

  it("flags a temperature the model quotes that no simulation returned, and a workbench is opened once", async () => {
    const { events } = await run("A heat sink for a 5 W chip, 40 mm square, under 70 C.", [
      toolCall("workbench_open", { workbench: "matter" }),
      toolCall("matter_simulate", { Q: 5, plate_mm: 40 }),
      say("In still air it reaches about 288 C, far above your 70 C target."),
    ]);
    const f = events.find((e) => e.type === "flag") as { kind: string; message: string };
    expect(f).toMatchObject({ kind: "invented_number" });
    expect(f.message).toContain("288 °C");
    const ok = await run("A heat sink for a 5 W chip, 40 mm square, under 70 C.", [toolCall("matter_simulate", { Q: 5 }), say("It peaks at 68.4 C, under your 70 C target.")]);
    expect(ok.events.some((e) => e.type === "flag")).toBe(false);
    const dup = await run("Make this loop faster", [toolCall("workbench_open", { workbench: "silicon" }), toolCall("propose_silicon_run", { workload: "w1" }), say("Click Run when ready.")]);
    expect(uiOf(dup.events).filter((a) => a.name === "workbench.open")).toHaveLength(1);
  });

  it("when the first geometry is rejected and the model gives up, it is asked once to try a smaller one and the give-up text is dropped", async () => {
    let sims = 0;
    const rejecting: HostedCaller = async (path, init) => {
      if (path !== "/api/matter/simulate") return hosted(path, init);
      sims++;
      return sims === 1
        ? new Response(JSON.stringify({ ok: true, ladder: [{ id: "M1", status: "pass", label: "x", detail: "d" }, { id: "M2", status: "fail", label: null, detail: "material 68% exceeds budget 40%" }], metrics: {}, baselines: { equal_material: null, full_budget: null }, verdict: null }), { status: 200 })
        : hosted(path, init);
    };
    const { events, bodies } = await run(
      "A heat sink for a 5 W chip, 40 mm square, under 70 C.",
      [toolCall("matter_simulate", { Q: 5, plate_mm: 40 }), say("It did not solve. Please run it again with fewer fins."), toolCall("matter_simulate", { Q: 5, plate_mm: 40, gen_params: { n_fins: 4, fin_len: 8 } }), say("It peaks at 68.4 C, under your 70 C target.")],
      { tools: { manifests, hosted: rejecting } },
    );
    expect(sims).toBe(2);
    const prose = proseOf(events);
    expect(prose).not.toContain("Please run it again");
    expect(prose).toContain("68.4 C");
    expect(bodies[2].messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("Nothing was solved yet") });
    expect(events.filter((e) => e.type === "cost")).toHaveLength(4);
    expect(events.some((e) => e.type === "flag")).toBe(false);
  });

  it("an unclear goal can be answered with one question and no tool", async () => {
    const { events } = await run("make it better", [say("Do you want to cool a chip, check a board or speed up a program?")]);
    expect(events.some((e) => e.type === "tool.call")).toBe(false);
    expect(proseOf(events)).toMatch(/\?$/);
  });

  it("'check my ESP32 board' checks a template and the follow-up chips offer the fix", async () => {
    const { events } = await run("Check my ESP32 board", [sayThenCall("I will check the example board.", "board_check", { template_id: "fault_gpio12_vs_gpio14" }), say("One check failed: the button pin does not match the firmware.")]);
    expect(uiOf(events).map((a) => a.name)).toEqual(["board.load_template", "board.check"]);
    const chips = events.find((e) => e.type === "suggest") as { chips: string[] };
    expect(chips.chips).toEqual(["Fix the failing check", "Explain the failing check"]);
  });

  it("routes 'fix it' and planning words to Ultra, check/simulate to Super", () => {
    expect(routeModel("fix it")).toBe("ultra");
    expect(routeModel("a heat sink for a 5 W chip, 40 mm square")).toBe("super");
    expect(routeModel("check my ESP32 board")).toBe("super");
  });
});

describe("plain language in the stream", () => {
  it("rewords jargon and strips ids from what the model writes, while the evidence stays available", async () => {
    const { events } = await run("What does the check say?", [
      toolCall("board_check", { template_id: "fault_gpio12_vs_gpio14" }),
      say("Rung B4 failed (board:fault_gpio12_vs_gpio14#B4, part:esp32.gpio12.strapping). The strapping pin is wired to the wrong GPIO."),
    ]);
    const prose = proseOf(events);
    expect(prose).not.toMatch(/\brung\b/i);
    expect(prose).not.toMatch(/board:|part:/);
    expect(prose).toContain("Check B4 failed.");
    expect(prose).toContain("boot-setting pin");
    const ev = events.find((e) => e.type === "evidence") as { ids: string[] };
    expect(ev.ids).toContain("board:fault_gpio12_vs_gpio14#B4");
  });

  it("the honesty filters still see the model's own words: an invented command is flagged even if the prose is reworded", async () => {
    const { events } = await run("how do I reproduce n1.1.1?", [say("Run siliconsmith verify-entry run:r_w1_final/n1.1.1 to formally prove it.")]);
    expect(events.some((e) => e.type === "flag" && e.kind === "invented_command")).toBe(true);
  });

  it("does not let a 'proved' claim through when no tool backed it", async () => {
    const { events } = await run("is it correct?", [say("Yes, it is formally proven.")]);
    expect(proseOf(events)).toContain("proved for every possible input");
    expect(events.some((e) => e.type === "evidence")).toBe(false); // the panel flags this message as unsupported
  });
});

describe("follow-up chips are computed from what ran", () => {
  it("matter, board and nothing", () => {
    expect(followUps("matter", [{ name: "matter_simulate", ok: true, data: { peak_temp_c: 60 } }], false)).toContain("Make it cooler");
    expect(followUps("board", [{ name: "board_check", ok: true, data: { passed: true } }], false)).toContain("What does this not prove?");
    expect(followUps("board", [{ name: "board_check", ok: false, data: null }], false)).toEqual([]);
  });
});

describe("Silicon: proposal and the live run", () => {
  it("propose_silicon_run only proposes, with the cap, and opens the Silicon workbench", async () => {
    const { events } = await run("Make this loop faster with a custom RISC-V instruction.", [toolCall("propose_silicon_run", { workload: "w1" }), say("I can try one. It costs credits, so click Run when you are ready.")]);
    const prop = events.find((e) => e.type === "action.proposed") as { action: { tool: string; costEstimateUsd: number; args: unknown } };
    expect(prop.action).toMatchObject({ tool: "silicon_run", costEstimateUsd: 0.15, args: { workload: "w1" } });
    expect(uiOf(events).map((a) => a.name)).toEqual(["workbench.open"]);
    expect(events.filter((e) => e.type === "cost").length).toBe(2);
  });

  const nd = (...evs: object[]) => new Response(evs.map((e) => JSON.stringify(e)).join("\n") + "\n", { status: 200 });
  const base = { v: 1, seq: 0, t: 0, run_id: "live1" };
  const good = () =>
    nd(
      { ...base, type: "run.started", workload: { id: "w1_tinymaix_fc", title: "TinyMaix" } },
      { ...base, type: "run.baseline", cycles: 860730 },
      { ...base, type: "llm.call", node_id: null, model: "nemotron-ultra", role: "architect", tokens_in: 2000, tokens_out: 400, cost_usd: 0.0032, latency_ms: 4000 },
      { ...base, type: "node.created", node_id: "n1", parent_id: null, depth: 0, proposal: { mnemonic: "dot4", title: "4-way int8 dot product" }, instruction_set: [] },
      { ...base, type: "node.stage", node_id: "n1", stage: "lint", status: "running", attempt: 1 },
      { ...base, type: "node.stage", node_id: "n1", stage: "lint", status: "pass", attempt: 1 },
      { ...base, type: "node.stage", node_id: "n1", stage: "prove", status: "pass", attempt: 1 },
      { ...base, type: "node.stage", node_id: "n1", stage: "synth", status: "skipped", attempt: 1 },
      { ...base, type: "llm.call", node_id: "n1", model: "nemotron-super", role: "implement", tokens_in: 6000, tokens_out: 1500, cost_usd: 0.0031, latency_ms: 9000 },
      { ...base, type: "node.scored", node_id: "n1", cycles: 215000, speedup: 4.0, luts: 100, ffs: 50, area_delta_pct: 2.5, fmax_mhz: null, wall_speedup: 4.0, feasible: true, on_pareto: true, ladder: {} },
      { ...base, type: "run.completed", best_node_id: "n1", pareto: ["n1"], totals: { nodes: 1, sandboxes: 6, cost_usd: 0.0063, tokens: 9900, wall_s: 60 }, report: {} },
    );
  const collect = async (h: HostedCaller) => {
    const out: AgentEvent[] = [];
    for await (const e of runSiliconRun({ turnId: "s1", workload: "w1", hosted: h })) out.push(e);
    return out;
  };

  it("streams stage chips in plain words, charges the real llm.call costs and ends with the measured speedup", async () => {
    let body: unknown;
    const events = await collect(async (path, init) => {
      expect(path).toBe("/api/silicon/run");
      body = JSON.parse(String(init?.body));
      return good();
    });
    expect(body).toEqual({ workload: "w1" });
    expect(uiOf(events).map((a) => a.name)).toEqual(["workbench.open", "silicon.run_live", "preview.tab"]);
    const results = events.filter((e) => e.type === "tool.result").map((e) => (e as { summary: string }).summary);
    expect(results).toEqual(
      expect.arrayContaining(["The agent proposes the instruction dot4: 4-way int8 dot product", "Checking the hardware code for mistakes passed", "Proving it for every possible input passed", "Measuring chip area was skipped"]),
    );
    const cost = events.filter((e) => e.type === "cost") as Array<{ usd: number; model: string }>;
    expect(cost.map((c) => c.model)).toEqual(["ultra", "super"]);
    expect(cost.reduce((s, c) => s + c.usd, 0)).toBeCloseTo(0.0063, 6);
    const text = proseOf(events);
    expect(text).toContain("makes the TinyMaix int8 fully-connected layer 4.00× faster in processor cycles (860,730 cycles down to 215,000)");
    expect(text).toContain("2.5% more chip area");
    expect(text).toMatch(/clock speed on a real chip was not measured/);
    expect(text).toContain("Spent about $0.0063");
    expect((events.find((e) => e.type === "suggest") as { chips: string[] }).chips).toContain("Explain the proof checks");
    expect(events.at(-1)?.type).toBe("turn.done");
  });

  it("claims nothing when no candidate passed, and when the endpoint is missing says so", async () => {
    const failed = await collect(async () =>
      nd(
        { ...base, type: "run.baseline", cycles: 1000 },
        { ...base, type: "node.stage", node_id: "n1", stage: "prove", status: "fail", attempt: 1, detail: "counterexample found" },
        { ...base, type: "run.completed", best_node_id: "n1", pareto: [], totals: { nodes: 1, sandboxes: 1, cost_usd: 0, tokens: 0, wall_s: 5 }, report: {} },
      ),
    );
    const t = proseOf(failed);
    expect(t).toContain("No instruction passed every check");
    expect(t).not.toMatch(/faster in processor cycles/);
    expect(failed.filter((e) => e.type === "tool.result").map((e) => (e as { ok: boolean }).ok)).toEqual([false]);

    const missing = await collect(async () => new Response(JSON.stringify({ error: { message: "not configured" } }), { status: 404 }));
    expect(missing.at(-1)).toMatchObject({ type: "turn.error", message: expect.stringContaining("not available") });
  });

  it("stops at the spending cap and still reports what was spent", async () => {
    const events: AgentEvent[] = [];
    for await (const e of runSiliconRun({
      turnId: "s2",
      workload: "w2",
      hosted: async () => nd({ ...base, type: "llm.call", node_id: null, model: "nemotron-ultra", role: "architect", tokens_in: 1, tokens_out: 1, cost_usd: 0.4, latency_ms: 1 }, { ...base, type: "run.completed", best_node_id: "n1", pareto: [], totals: { nodes: 0, sandboxes: 0, cost_usd: 0, tokens: 0, wall_s: 1 }, report: {} }),
    }))
      events.push(e);
    expect(proseOf(events)).toMatch(/stopped it early because the \$0\.15 spending cap was reached/);
    expect(proseOf(events)).toContain("Spent about $0.4000");
  });
});
