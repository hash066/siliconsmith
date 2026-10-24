import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyAgentEvent, initialAgentState, type AgentEvent, type AgentState } from "@/lib/agent";
import type { CreditsSnapshot } from "@/lib/credits";
import { AgentPanelView, ConfirmCard, SUGGESTED_PROMPTS, type AgentPanelViewProps } from "./AgentPanel";
import { Markdown } from "./Markdown";

const noop = () => {};
const credits: CreditsSnapshot = { allowanceUsd: 0.5, spentUsd: 0.02, remainingUsd: 0.48, pool: { capUsd: 25, spentUsd: 1.3 }, scope: "your balance is exact; the shared pool is per server instance, in memory until a durable store is added", scopes: { visitor: "exact (signed cookie)", pool: "per server instance, in memory" } };
const view = (state: AgentState, over: Partial<AgentPanelViewProps> = {}) =>
  renderToStaticMarkup(
    <AgentPanelView state={state} workbench="matter" connected busy={false} model="auto" onModelChange={noop} credits={credits} creditsExhausted={false} onSend={noop} onStop={noop} onRun={noop} onCancel={noop} {...over} />,
  );
const play = (events: AgentEvent[]) => events.reduce(applyAgentEvent, initialAgentState());

describe("AgentPanel (server-rendered; fixtures exist only in this test)", () => {
  it("reserves its space while the status probe is in flight: a skeleton, no 'not connected' flash, no balance yet", () => {
    const html = view(initialAgentState(), { connected: null, credits: null });
    expect(html).toContain("Checking the agent endpoint");
    expect(html).not.toContain("not connected yet");
    expect(html).toMatch(/<textarea[^>]*\sdisabled=""/);
    expect(html).toContain("animate-pulse");
  });

  it("is honest when no endpoint is connected: banner, disabled composer, no starters", () => {
    const html = view(initialAgentState(), { connected: false, credits: null });
    expect(html).toContain("Agent endpoint not connected yet");
    expect(html).toMatch(/<textarea[^>]*\sdisabled=""/);
    expect(html).not.toContain("Suggested prompts");
    expect(html).not.toContain("left</span>");
  });

  it("offers the workbench's suggested prompts when connected and empty", () => {
    for (const wb of ["matter", "board", "silicon"] as const) {
      const html = view(initialAgentState(), { workbench: wb });
      expect(html).toContain("Suggested prompts");
      expect(html).toContain(SUGGESTED_PROMPTS[wb][0].replace(/&/g, "&amp;"));
    }
  });

  it("shows the model selector with Auto selected, the balance and the context chips", () => {
    const html = view(initialAgentState(), { chips: [{ label: "Design", value: "clean_sensor" }] });
    for (const m of ["Auto", "Ultra", "Super", "Nano"]) expect(html).toContain(m);
    expect(html).toMatch(/aria-checked="true"[^>]*>Auto/);
    expect(html).toContain("$0.4800 left");
    expect(html).toContain("clean_sensor");
  });

  it("renders a collapsed tool card, applied actions with Apply, markdown, citations and the real cost", () => {
    const state = play([
      { type: "turn.started", id: "a1", model: "super" },
      { type: "tool.call", id: "a1", call: { id: "c1", name: "matter_simulate", args: { generator: "rect_fins", gen_params: { n_fins: 10 } } } },
      { type: "tool.result", id: "a1", callId: "c1", ok: true, summary: "rect_fins: peak 81.6 C, 4 of 5 rungs pass" },
      { type: "ui.action", id: "a1", action: { name: "matter.set_params", args: { generator: "rect_fins" } } },
      { type: "ui.action", id: "a1", action: { name: "matter.simulate", args: {} } },
      { type: "text.delta", id: "a1", text: "Peak is **81.6 °C**; M5 does not pass (matter:rect_fins#M5)." },
      { type: "evidence", id: "a1", ids: ["matter:rect_fins#M5"] },
      { type: "cost", id: "a1", usd: 0.001, tokens_in: 3000, tokens_out: 100, model: "super" },
      { type: "cost", id: "a1", usd: 0.0009, tokens_in: 3200, tokens_out: 60, model: "super" },
      { type: "turn.done", id: "a1" },
    ]);
    const html = view(state, { onApply: noop });
    expect(html).toContain("matter_simulate");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("rect_fins: peak 81.6 C");
    expect(html).toContain("Set the parameters");
    expect(html).toContain("Ran the simulation");
    expect(html).toContain("· Apply");
    expect(html).toContain("<strong");
    expect(html).toContain("Show the evidence behind this (1)");
    expect(html).toContain("matter:rect_fins#M5");
    expect(html).toContain("≈ $0.002");
    expect(html).toContain("6,200 in");
    expect(html).not.toContain("without citing evidence");
  });

  it("flags an uncited verified claim and an invented command", () => {
    const state = play([
      { type: "turn.started", id: "a1", model: "nano" },
      { type: "text.delta", id: "a1", text: "dot4 is proven. Run siliconsmith verify-entry run:r/n1" },
      { type: "flag", id: "a1", kind: "invented_command", message: "That command does not exist." },
      { type: "turn.done", id: "a1" },
    ]);
    const html = view(state);
    expect(html).toContain("without citing evidence");
    expect(html).toContain("That command does not exist");
  });

  it("shows a stop button while a turn runs and disables the composer when credits are used up, saying free tools still work", () => {
    expect(view(initialAgentState(), { busy: true })).toContain(">Stop<");
    const out = view(initialAgentState(), { creditsExhausted: true, credits: { ...credits, remainingUsd: 0 } });
    expect(out).toMatch(/<textarea[^>]*\sdisabled=""/);
    expect(out).toContain("demo credits are used up");
    expect(out).toContain("free tools and the recorded runs keep working");
  });

  it("a proposed loop needs a click and shows its hard cap; the Run button is disabled when the cap exceeds what is left", () => {
    const action = { id: "p1", tool: "matter_optimize", summary: "Search fin parameters: up to 6 simulations.", costEstimateUsd: 0.05, args: {} };
    const ok = renderToStaticMarkup(<ConfirmCard action={action} remainingUsd={0.4} onRun={noop} onCancel={noop} />);
    expect(ok).toContain("Up to $0.050 (hard cap), usually less");
    expect(ok).toContain("Run (up to $0.050)");
    expect(ok).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Run/);
    const low = renderToStaticMarkup(<ConfirmCard action={action} remainingUsd={0.01} onRun={noop} onCancel={noop} />);
    expect(low).toMatch(/<button[^>]*\sdisabled=""[^>]*>Run/);
    expect(low).toContain("Not enough credits left");
  });
});

describe("Markdown", () => {
  it("renders bold, inline code, fenced code and lists, and never injects HTML", () => {
    const html = renderToStaticMarkup(<Markdown text={"Use **n_fins** and `spine`.\n\n- one\n- two\n\n```\nx = 1\n```\n<img src=x onerror=alert(1)>"} />);
    expect(html).toContain("<strong");
    expect(html).toContain("<code");
    expect(html).toContain("<li");
    expect(html).toContain("<pre");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
