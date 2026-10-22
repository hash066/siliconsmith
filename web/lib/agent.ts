// Agent panel protocol. The panel renders a conversation built from AgentEvents; a transport (a later `/api/agent`
// route handler calling Nemotron on Nebius Token Factory) produces them. With no transport the panel is in its honest
// "not connected" state and shows nothing that looks like a model answer.

export type AgentModel = "ultra" | "super" | "nano";
export const AGENT_MODELS: readonly AgentModel[] = ["ultra", "super", "nano"];

/** Read-only tools run automatically; actions need a click and show a cost estimate first (plan section 8). */
export const READ_TOOLS = ["library.search", "evidence.get", "run.explain_failure", "board.check", "matter.simulate_preview"] as const;
export const ACTION_TOOLS = ["run.start", "verify.run", "artifact.export"] as const;
export type ToolName = (typeof READ_TOOLS)[number] | (typeof ACTION_TOOLS)[number];

export const isActionTool = (name: string): boolean => (ACTION_TOOLS as readonly string[]).includes(name);

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  /** Short human summary of what came back (never raw logs). */
  result?: string;
  error?: string;
}

export interface PendingAction {
  id: string;
  tool: string;
  summary: string;
  /** USD, from the router's estimate; null when no estimate is available (the UI says so). */
  costEstimateUsd: number | null;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  model?: AgentModel;
  toolCalls: ToolCall[];
  /** Evidence ids the answer cites (for example "run:r_w1_contree3/n1" or "part:esp32.gpio12.strapping"). */
  evidence: string[];
  streaming?: boolean;
  error?: string;
}

export interface AgentState {
  messages: AgentMessage[];
  pending: PendingAction | null;
  /** The model that answered last, for the badge. Null until a model has answered. */
  activeModel: AgentModel | null;
}

export type AgentEvent =
  | { type: "turn.started"; id: string; model: AgentModel }
  | { type: "text.delta"; id: string; text: string }
  | { type: "tool.call"; id: string; call: Omit<ToolCall, "status" | "result" | "error"> }
  | { type: "tool.result"; id: string; callId: string; ok: boolean; summary: string }
  | { type: "evidence"; id: string; ids: string[] }
  | { type: "action.proposed"; action: PendingAction }
  | { type: "turn.done"; id: string }
  | { type: "turn.error"; id: string; message: string };

/** The seam for `/api/agent`: send the user's text, get events back. */
export interface AgentTransport {
  send(input: { text: string; signal: AbortSignal }): AsyncIterable<AgentEvent>;
}

export const initialAgentState = (): AgentState => ({ messages: [], pending: null, activeModel: null });

export function addUserMessage(s: AgentState, id: string, text: string): AgentState {
  return { ...s, messages: [...s.messages, { id, role: "user", text, toolCalls: [], evidence: [] }] };
}

const patch = (s: AgentState, id: string, f: (m: AgentMessage) => AgentMessage): AgentState => ({
  ...s,
  messages: s.messages.map((m) => (m.id === id ? f(m) : m)),
});

/** Pure reducer: never mutates, ignores events for unknown turns. */
export function applyAgentEvent(s: AgentState, e: AgentEvent): AgentState {
  switch (e.type) {
    case "turn.started":
      if (s.messages.some((m) => m.id === e.id)) return s;
      return { ...s, activeModel: e.model, messages: [...s.messages, { id: e.id, role: "assistant", text: "", model: e.model, toolCalls: [], evidence: [], streaming: true }] };
    case "text.delta":
      return patch(s, e.id, (m) => ({ ...m, text: m.text + e.text }));
    case "tool.call":
      return patch(s, e.id, (m) => (m.toolCalls.some((c) => c.id === e.call.id) ? m : { ...m, toolCalls: [...m.toolCalls, { ...e.call, status: "running" }] }));
    case "tool.result":
      return patch(s, e.id, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((c) => (c.id === e.callId ? { ...c, status: e.ok ? "ok" : "error", result: e.ok ? e.summary : undefined, error: e.ok ? undefined : e.summary } : c)),
      }));
    case "evidence":
      return patch(s, e.id, (m) => ({ ...m, evidence: [...new Set([...m.evidence, ...e.ids])] }));
    case "action.proposed":
      return { ...s, pending: e.action };
    case "turn.done":
      return patch(s, e.id, (m) => ({ ...m, streaming: false }));
    case "turn.error":
      return patch(s, e.id, (m) => ({ ...m, streaming: false, error: e.message }));
  }
}

export const dismissPending = (s: AgentState): AgentState => (s.pending ? { ...s, pending: null } : s);

const CLAIM = /\b(verified|proven|proved|passes|passed|formally equivalent)\b/i;

/** An answer that says verified/proven/passes without citing evidence is flagged, never shown as a finding. */
export function hasUncitedClaim(text: string, evidence: readonly string[]): boolean {
  return evidence.length === 0 && CLAIM.test(text);
}

export function formatCostEstimate(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "No estimate available";
  return `Estimated cost $${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}
