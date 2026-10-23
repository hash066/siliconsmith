// Agent panel protocol. The panel renders a conversation built from AgentEvents; a transport (a later `/api/agent`
// route handler calling Nemotron on Nebius Token Factory) produces them. With no transport the panel is in its honest
// "not connected" state and shows nothing that looks like a model answer.

import type { UiAction } from "./agent-actions";
import type { WorkbenchId } from "./brand";

export type AgentModel = "ultra" | "super" | "nano";
export const AGENT_MODELS: readonly AgentModel[] = ["ultra", "super", "nano"];
/** What the user picks: a fixed model, or Auto (the server routes by task: Nano lookups, Super tool turns, Ultra planning and diagnosis). */
export type ModelChoice = "auto" | AgentModel;
export const MODEL_CHOICES: readonly ModelChoice[] = ["auto", "ultra", "super", "nano"];

/** Read-only tools run automatically; actions need a click and show a cost estimate first (plan section 8). */
export const READ_TOOLS = [
  "library_search",
  "run_nodes_search",
  "evidence_get",
  "run_explain_failure",
  "board_check",
  "board_set_design",
  "matter_simulate",
  "workbench_open",
  "silicon_open_run",
  "workflow_focus",
] as const;
/** Bounded loops that spend credits. The model can only PROPOSE them; the user clicks, and the server re-checks credits and caps. */
export const ACTION_TOOLS = ["board_design", "matter_optimize"] as const;
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
  /** USD: the hard cap of the loop (a typical run costs less). Null when no estimate is available (the UI says so). */
  costEstimateUsd: number | null;
  /** The arguments to run it with. Validated again on the server when the user confirms. */
  args?: Record<string, unknown>;
}

/** What one turn cost, from the model's reported token usage at list prices. */
export interface TurnCost {
  usd: number;
  tokensIn: number;
  tokensOut: number;
  model: AgentModel;
}

/** The app's current state, sent with each turn so the agent can act on what the user sees. Bounded by the server. */
export interface AgentContext {
  /** Short chips shown above the composer, e.g. "Design: clean_sensor", "Run: r_w1_contree3". */
  chips?: Array<{ label: string; value?: string }>;
  board?: { template_id?: string; design?: unknown; last_check?: { passed: boolean; rungs: Array<{ rung: string; status: string }> } };
  matter?: { generator?: string; gen_params?: Record<string, number>; spreader?: Record<string, number>; last?: { peak_temp_c: number; rungs: Array<{ id: string; status: string }> } };
  silicon?: { run_id?: string; node_id?: string };
}

export interface AgentRequest {
  text: string;
  model: ModelChoice;
  workbench: WorkbenchId;
  context?: AgentContext;
  /** The last few turns, so the conversation has continuity. The server truncates. */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Set only by the Run button of a proposed loop: `confirm: true` plus the action. The server re-validates both and re-checks credits. */
  confirm?: true;
  action?: { tool: (typeof ACTION_TOOLS)[number]; args: Record<string, unknown> };
}

export interface MessageFlag {
  kind: "invented_command" | "claims_run";
  message: string;
}

/** Tokens and an estimated cost for one turn, summed over its model calls. The cost uses list prices, so it is an estimate. */
export interface TurnUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  model?: AgentModel;
  toolCalls: ToolCall[];
  /** Evidence ids the answer cites (for example "run:r_w1_contree3/n1" or "part:esp32.gpio12.strapping"). */
  evidence: string[];
  /** Server post-check findings about the final text (an invented command, a claim that a command was run). */
  flags?: MessageFlag[];
  /** Actions the agent performed in the app during this turn (the app mirrors them; the user can apply one again). */
  uiActions?: UiAction[];
  streaming?: boolean;
  usage?: TurnUsage;
  cost?: TurnCost;
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
  | { type: "flag"; id: string; kind: MessageFlag["kind"]; message: string }
  | { type: "ui.action"; id: string; action: UiAction }
  | { type: "cost"; id: string; usd: number; tokens_in: number; tokens_out: number; model: AgentModel }
  | { type: "action.proposed"; action: PendingAction }
  | { type: "turn.done"; id: string; usage?: TurnUsage }
  | { type: "turn.error"; id: string; message: string };

/** The seam for `/api/agent`: send a request, get events back. */
export interface AgentTransport {
  send(input: AgentRequest & { signal: AbortSignal }): AsyncIterable<AgentEvent>;
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
    case "flag":
      return patch(s, e.id, (m) => ({ ...m, flags: [...(m.flags ?? []), { kind: e.kind, message: e.message }] }));
    case "ui.action":
      return patch(s, e.id, (m) => ({ ...m, uiActions: [...(m.uiActions ?? []), e.action] }));
    case "cost":
      return patch(s, e.id, (m) => ({
        ...m,
        cost: { usd: (m.cost?.usd ?? 0) + e.usd, tokensIn: (m.cost?.tokensIn ?? 0) + e.tokens_in, tokensOut: (m.cost?.tokensOut ?? 0) + e.tokens_out, model: e.model },
      }));
    case "action.proposed":
      return { ...s, pending: e.action };
    case "turn.done":
      return patch(s, e.id, (m) => ({ ...m, streaming: false, usage: e.usage ?? m.usage }));
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
