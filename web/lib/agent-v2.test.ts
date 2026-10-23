// Agent v2 turn behaviour with a scripted model (test only): UI actions, tool filtering per workbench, proposals, context, history, cost.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent";
import { configFromEnv, runAgentTurn } from "./agent-server";
import { fsReplayLoader, toolsFor, type HostedCaller } from "./agent-tools";
import { fsManifestStore } from "./manifest";

const loader = fsReplayLoader(resolve(__dirname, "../public/replays"));
const manifests = fsManifestStore(resolve(__dirname, "../../evidence"));
const cfg = configFromEnv({ NEBIUS_API_KEY: "test-key-not-real" })!;

function sse(...chunks: object[]): Response {
  return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200 });
}
const toolCall = (name: string, args: object, usage = { prompt_tokens: 3000, completion_tokens: 80 }) =>
  sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c_${name}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }], usage });
const answer = (text: string, usage = { prompt_tokens: 3400, completion_tokens: 60 }) => sse({ choices: [{ delta: { content: text }, finish_reason: "stop" }], usage });

const hosted: HostedCaller = async (path, init) => {
  const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  if (path.startsWith("/api/board/templates/")) return j(200, { design: { name: "x", instances: [], nets: [] } });
  if (path === "/api/board/check")
    return j(200, { ok: true, passed: false, rungs: [{ rung: "B1", status: "pass", label: "Netlist is well formed", detail: "ok", evidence: [] }, { rung: "B4", status: "fail", label: null, detail: "GPIO12 vs GPIO14", evidence: ["part:esp32.gpio12"] }], notice: "n" });
  if (path === "/api/matter/simulate")
    return j(200, { ok: true, ladder: [{ id: "M1", status: "pass", label: "Solver validated", detail: "d" }, { id: "M5", status: "fail", label: null, detail: "no" }], metrics: { peak_temp_c: 80, material_fraction: 0.3 }, baselines: {}, verdict: null });
  return j(404, {});
};

const run = async (opts: Partial<Parameters<typeof runAgentTurn>[0]> & { replies: Response[] }) => {
  const bodies: Array<Record<string, any>> = [];
  let n = 0;
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return opts.replies[Math.min(n++, opts.replies.length - 1)];
  }) as unknown as typeof fetch;
  const events: AgentEvent[] = [];
  for await (const e of runAgentTurn({ text: "go", cfg, loader, turnId: "t", fetchImpl, tools: { manifests, hosted }, ...opts })) events.push(e);
  return { events, bodies };
};

describe("agent turn: the server performs free tools and streams UI actions", () => {
  it("board_check on a template mirrors as load_template then check", async () => {
    const { events } = await run({ workbench: "board", text: "check the gpio12 template", replies: [toolCall("board_check", { template_id: "fault_gpio12_vs_gpio14" }), answer("B4 fails (board:fault_gpio12_vs_gpio14#B4).")] });
    const ui = events.filter((e) => e.type === "ui.action").map((e) => (e as Extract<AgentEvent, { type: "ui.action" }>).action);
    expect(ui).toEqual([{ name: "board.load_template", args: { template_id: "fault_gpio12_vs_gpio14" } }, { name: "board.check", args: {} }]);
    // the action arrives after its tool result, before the next model call's text
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("tool.result")).toBeLessThan(kinds.indexOf("ui.action"));
  });

  it("board_set_design applies a whole design object and re-checks", async () => {
    const design = { name: "mine", instances: [], nets: [] };
    const { events } = await run({ workbench: "board", replies: [toolCall("board_set_design", { design_json: JSON.stringify(design) }), answer("done")] });
    const ui = events.filter((e) => e.type === "ui.action").map((e) => (e as Extract<AgentEvent, { type: "ui.action" }>).action);
    expect(ui[0]).toEqual({ name: "board.set_design", args: { design } });
    expect(ui[1].name).toBe("board.check");
  });

  it("matter_simulate sets the exact simulated parameters in the app and runs it", async () => {
    const { events } = await run({ workbench: "matter", replies: [toolCall("matter_simulate", { generator: "rect_fins", gen_params: { n_fins: 10 } }), answer("done")] });
    const ui = events.filter((e) => e.type === "ui.action").map((e) => (e as Extract<AgentEvent, { type: "ui.action" }>).action);
    expect(ui[0]).toMatchObject({ name: "matter.set_params", args: { generator: "rect_fins", gen_params: { n_fins: 10, spine: 8 } } });
    expect(ui[1]).toEqual({ name: "matter.simulate", args: {} });
  });

  it("silicon_open_run checks the run exists; an unknown run is an error and emits no UI action", async () => {
    const ok = await run({ workbench: "silicon", replies: [toolCall("silicon_open_run", { run_id: "r_w1_contree3", node_id: "n1.2.1" }), answer("opened")] });
    expect(ok.events.find((e) => e.type === "ui.action")).toMatchObject({ action: { name: "silicon.open_run", args: { run_id: "r_w1_contree3", node_id: "n1.2.1" } } });
    const bad = await run({ workbench: "silicon", replies: [toolCall("silicon_open_run", { run_id: "r_nope" }), answer("could not")] });
    expect(bad.events.some((e) => e.type === "ui.action")).toBe(false);
    expect(bad.events.find((e) => e.type === "tool.result")).toMatchObject({ ok: false });
  });

  it("workbench_open and workflow_focus are plain UI actions", async () => {
    const { events } = await run({ workbench: "matter", replies: [toolCall("workbench_open", { workbench: "board" }), answer("ok")] });
    expect(events.find((e) => e.type === "ui.action")).toMatchObject({ action: { name: "workbench.open", args: { workbench: "board" } } });
    const bad = await run({ workbench: "matter", replies: [toolCall("workbench_open", { workbench: "plasma" }), answer("no")] });
    expect(bad.events.find((e) => e.type === "tool.result")).toMatchObject({ ok: false });
  });
});

describe("agent turn: proposals, filtering and context", () => {
  it("propose_matter_optimize only proposes: an action.proposed with the hard cap, nothing run, nothing spent by a loop", async () => {
    const { events } = await run({ workbench: "matter", text: "optimise it", replies: [toolCall("propose_matter_optimize", { generator: "rect_fins" }), answer("Click Run to start it.")] });
    const prop = events.find((e) => e.type === "action.proposed") as Extract<AgentEvent, { type: "action.proposed" }>;
    expect(prop.action).toMatchObject({ tool: "matter_optimize", costEstimateUsd: 0.05, args: { generator: "rect_fins" } });
    expect(events.some((e) => e.type === "ui.action")).toBe(false);
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ ok: true });
  });

  it("offers each workbench only its own tools and refuses a tool it was not offered", async () => {
    expect(toolsFor("matter").map((t) => t.name)).toEqual(expect.arrayContaining(["matter_simulate", "propose_matter_optimize", "library_search"]));
    expect(toolsFor("matter").map((t) => t.name)).not.toContain("board_check");
    expect(toolsFor("board").map((t) => t.name)).not.toContain("matter_simulate");
    const { events, bodies } = await run({ workbench: "matter", replies: [toolCall("board_check", { template_id: "clean_sensor" }), answer("cannot")] });
    expect(bodies[0].tools.map((t: any) => t.function.name)).not.toContain("board_check");
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ ok: false, summary: expect.stringContaining("not available here") });
    expect(events.some((e) => e.type === "ui.action")).toBe(false);
  });

  it("sends the app state and the last turns to the model, bounded", async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `m${i} ${"x".repeat(2000)}` }));
    const { bodies } = await run({ workbench: "board", context: { board: { template_id: "clean_sensor", design: { name: "d" } } }, history, replies: [answer("hi")] });
    const msgs = bodies[0].messages as Array<{ role: string; content: string }>;
    expect(msgs[0].content).toContain("Board workbench");
    expect(msgs[0].content).toContain("clean_sensor");
    const hist = msgs.slice(1, -1);
    expect(hist).toHaveLength(6);
    expect(hist.every((m) => m.content.length <= 1200)).toBe(true);
    expect(msgs.at(-1)).toEqual({ role: "user", content: "go" });
  });

  it("emits one cost event per model call with real tokens at the routed model's price, and routes Auto", async () => {
    const { events } = await run({ model: "auto", text: "simulate 12 fins", workbench: "matter", replies: [toolCall("matter_simulate", {}), answer("ok")] });
    const costs = events.filter((e) => e.type === "cost") as Array<Extract<AgentEvent, { type: "cost" }>>;
    expect(costs).toHaveLength(2);
    expect(costs[0]).toMatchObject({ model: "super", tokens_in: 3000, tokens_out: 80 });
    expect(costs[0].usd).toBeCloseTo((3000 * 0.3 + 80 * 0.9) / 1e6, 10);
    expect(events[0]).toMatchObject({ type: "turn.started", model: "super" });
    const nano = await run({ model: "auto", text: "which entries are in the library?", replies: [answer("three")] });
    expect(nano.events[0]).toMatchObject({ model: "nano" });
    const fixed = await run({ model: "ultra", text: "list things", replies: [answer("x")] });
    expect(fixed.events[0]).toMatchObject({ model: "ultra" });
  });

  it("bad tool arguments come back as a failed tool result, not a crash", async () => {
    const { events } = await run({ workbench: "board", replies: [sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "board_check", arguments: "{oops" } }] }, finish_reason: "tool_calls" }] }), answer("sorry")] });
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ ok: false });
    expect(events.at(-1)?.type).toBe("turn.done");
  });
});
