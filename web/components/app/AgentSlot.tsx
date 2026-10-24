"use client";

import type { WorkbenchId } from "@/lib/brand";
import type { UiAction } from "@/lib/agent-actions";
import type { AgentState } from "@/lib/agent";
import { AgentPanel, type AgentContext, type ModelChoice } from "../agent";

/** A message the app pushes into the conversation as if the visitor typed it (the first prompt, a "Fix it" button). `id` changes for every push. */
export interface PushedPrompt {
  id: number;
  text: string;
}

/**
 * The app's only coupling to the Agent: the visible workbench, the structured context, the model choice, the action registry and the
 * pushed prompt. The panel fetches its own status and credits and never invents a reply. `prompt` (first prompt, "Fix it") is sent as a normal user turn once per id.
 */
export function AgentSlot({ workbench, context, model, onModel, onAction, prompt, suggestions, onBusyChange, initialState, onStateChange }: { workbench: WorkbenchId; context: AgentContext; model: ModelChoice; onModel: (m: ModelChoice) => void; onAction: (a: UiAction) => Promise<unknown>; prompt: PushedPrompt | null; suggestions: string[]; onBusyChange: (busy: boolean) => void; initialState?: AgentState; onStateChange?: (s: AgentState) => void }) {
  return (
    <AgentPanel workbench={workbench} context={context} model={model} onModelChange={onModel} onAction={onAction} prompt={prompt ?? undefined} suggestions={suggestions} onBusyChange={onBusyChange} initialState={initialState} onStateChange={onStateChange} className="h-full" />
  );
}
