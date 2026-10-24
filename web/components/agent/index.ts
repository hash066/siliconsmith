// Public surface of the Agent. The app imports from here:
//   import { AgentPanel } from "@/components/agent";
//   import { useCredits } from "@/lib/credits-client";
export { AgentPanel, AgentPanelView, SUGGESTED_PROMPTS } from "./AgentPanel";
export type { AgentPanelProps, AgentPanelViewProps } from "./AgentPanel";
export type { AgentContext, ModelChoice, AgentModel } from "@/lib/agent";
export type { UiAction, UiActionResult } from "@/lib/agent-actions";
