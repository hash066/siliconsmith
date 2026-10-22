import { describe, expect, it } from "vitest";
import { addUserMessage, applyAgentEvent, dismissPending, formatCostEstimate, hasUncitedClaim, initialAgentState, isActionTool, type AgentEvent } from "./agent";

const run = (events: AgentEvent[]) => events.reduce(applyAgentEvent, addUserMessage(initialAgentState(), "u1", "why did n3 fail?"));

describe("agent panel protocol", () => {
  it("builds a turn from events and never mutates the previous state", () => {
    const base = addUserMessage(initialAgentState(), "u1", "hi");
    const next = applyAgentEvent(base, { type: "turn.started", id: "a1", model: "super" });
    expect(base.messages).toHaveLength(1);
    expect(next.messages).toHaveLength(2);
    expect(next.activeModel).toBe("super");
  });

  it("streams text, tracks tool calls and citations, then finishes", () => {
    const s = run([
      { type: "turn.started", id: "a1", model: "ultra" },
      { type: "text.delta", id: "a1", text: "n3 failed " },
      { type: "tool.call", id: "a1", call: { id: "c1", name: "run.explain_failure", args: { node: "n3" } } },
      { type: "tool.call", id: "a1", call: { id: "c1", name: "run.explain_failure", args: { node: "n3" } } },
      { type: "tool.result", id: "a1", callId: "c1", ok: true, summary: "prove failed at attempt 0" },
      { type: "text.delta", id: "a1", text: "the proof." },
      { type: "evidence", id: "a1", ids: ["run:r/n3", "run:r/n3"] },
      { type: "turn.done", id: "a1" },
    ]);
    const a = s.messages[1];
    expect(a.text).toBe("n3 failed the proof.");
    expect(a.toolCalls).toEqual([{ id: "c1", name: "run.explain_failure", args: { node: "n3" }, status: "ok", result: "prove failed at attempt 0", error: undefined }]);
    expect(a.evidence).toEqual(["run:r/n3"]);
    expect(a.streaming).toBe(false);
  });

  it("records a failing call and a turn error without losing the text so far", () => {
    const s = run([
      { type: "turn.started", id: "a1", model: "nano" },
      { type: "text.delta", id: "a1", text: "partial" },
      { type: "tool.call", id: "a1", call: { id: "c1", name: "evidence.get", args: {} } },
      { type: "tool.result", id: "a1", callId: "c1", ok: false, summary: "not found" },
      { type: "turn.error", id: "a1", message: "stream dropped" },
    ]);
    const a = s.messages[1];
    expect(a.text).toBe("partial");
    expect(a.toolCalls[0]).toMatchObject({ status: "error", error: "not found" });
    expect(a.error).toBe("stream dropped");
    expect(a.streaming).toBe(false);
  });

  it("holds a proposed action until it is dismissed, and ignores events for unknown turns", () => {
    const s = run([{ type: "action.proposed", action: { id: "p1", tool: "run.start", summary: "Start W2", costEstimateUsd: null } }, { type: "text.delta", id: "ghost", text: "x" }]);
    expect(s.pending?.tool).toBe("run.start");
    expect(s.messages).toHaveLength(1);
    expect(dismissPending(s).pending).toBeNull();
  });

  it("flags proven/verified/passes claims that cite no evidence", () => {
    expect(hasUncitedClaim("dot4 is proven correct", [])).toBe(true);
    expect(hasUncitedClaim("dot4 is proven correct", ["run:r/n1"])).toBe(false);
    expect(hasUncitedClaim("the candidate failed lint", [])).toBe(false);
  });

  it("separates actions from read-only tools and words the cost estimate honestly", () => {
    expect(isActionTool("run.start")).toBe(true);
    expect(isActionTool("evidence.get")).toBe(false);
    expect(formatCostEstimate(null)).toBe("No estimate available");
    expect(formatCostEstimate(0.0042)).toBe("Estimated cost $0.0042");
    expect(formatCostEstimate(0.21)).toBe("Estimated cost $0.21");
  });
});
