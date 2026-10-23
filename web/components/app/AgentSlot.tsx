"use client";

import type { WorkbenchId } from "@/lib/brand";
import type { UiAction } from "@/lib/agent-actions";
import { AgentPanel, type AgentContext, type ModelChoice } from "../agent";

/**
 * The app's only coupling to the Agent: the visible workbench, the structured context (current design, parameters, run), the top-bar
 * model choice and the action registry. The panel fetches its own status and credits and never invents a reply.
 */
export function AgentSlot({ workbench, context, model, onModel, onAction }: { workbench: WorkbenchId; context: AgentContext; model: ModelChoice; onModel: (m: ModelChoice) => void; onAction: (a: UiAction) => Promise<unknown> }) {
  return <AgentPanel workbench={workbench} context={context} model={model} onModelChange={onModel} onAction={onAction} className="h-full" />;
}
