import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyAgentEvent, initialAgentState, type AgentEvent, type AgentState } from "@/lib/agent";
import { ActionConfirm, AgentPanelView } from "./AgentPanel";

const noop = () => {};
const view = (state: AgentState, connected: boolean) => renderToStaticMarkup(<AgentPanelView state={state} connected={connected} busy={false} onSend={noop} onStop={noop} onConfirm={noop} onCancel={noop} />);

describe("AgentPanel (server-rendered; the fixtures below exist only in this test)", () => {
  it("is honest when no endpoint is connected: banner, disabled composer, no active model", () => {
    const html = view(initialAgentState(), false);
    expect(html).toContain("Agent endpoint not connected yet");
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Send/);
    expect(html).not.toContain('aria-current="true"');
    for (const m of ["Ultra", "Super", "Nano"]) expect(html).toContain(m);
  });

  it("renders tool-call cards, the evidence citation and the active model badge once connected", () => {
    const events: AgentEvent[] = [
      { type: "turn.started", id: "a1", model: "super" },
      { type: "tool.call", id: "a1", call: { id: "c1", name: "run_explain_failure", args: { node: "n3" } } },
      { type: "tool.result", id: "a1", callId: "c1", ok: true, summary: "prove failed at attempt 0" },
      { type: "text.delta", id: "a1", text: "n3 failed the proof." },
      { type: "evidence", id: "a1", ids: ["run:r/n3"] },
      { type: "turn.done", id: "a1" },
    ];
    const html = view(events.reduce(applyAgentEvent, initialAgentState()), true);
    expect(html).toContain("run_explain_failure");
    expect(html).toContain("read-only");
    expect(html).toContain("prove failed at attempt 0");
    expect(html).toContain("Cites: run:r/n3");
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("without citing evidence");
  });

  it("flags a verified claim that cites nothing", () => {
    const events: AgentEvent[] = [{ type: "turn.started", id: "a1", model: "nano" }, { type: "text.delta", id: "a1", text: "dot4 is proven." }, { type: "turn.done", id: "a1" }];
    expect(view(events.reduce(applyAgentEvent, initialAgentState()), true)).toContain("without citing evidence");
  });

  it("asks before an action and shows the cost slot, with or without an estimate", () => {
    const withCost = renderToStaticMarkup(<ActionConfirm action={{ id: "p", tool: "run_start", summary: "Start W2", costEstimateUsd: 0.21 }} onConfirm={noop} onCancel={noop} />);
    expect(withCost).toContain("Estimated cost $0.21");
    expect(withCost).toContain("Confirm and run");
    expect(renderToStaticMarkup(<ActionConfirm action={{ id: "p", tool: "run_start", summary: "Start W2", costEstimateUsd: null }} onConfirm={noop} onCancel={noop} />)).toContain("No estimate available");
  });
});

describe("AgentPanel starters", () => {
  it("offers starter prompts when connected with an empty conversation, and none when not connected", () => {
    const connected = view(initialAgentState(), true);
    expect(connected).toContain("Ask about what is on this site");
    expect(connected).toContain("fault_gpio12_vs_gpio14");
    expect(view(initialAgentState(), false)).not.toContain("Ask about what is on this site");
  });
});
