"use client";

import { useEffect, useRef } from "react";
import type { WorkbenchId } from "@/lib/brand";
import type { UiAction } from "@/lib/agent-actions";
import { AgentPanel, type AgentContext, type ModelChoice } from "../agent";

const PANEL_SUPPORTS_PROMPT = false;

/** A message the app pushes into the conversation as if the visitor typed it (the first prompt, a "Fix it" button). `id` changes for every push. */
export interface PushedPrompt {
  id: number;
  text: string;
}

/**
 * The app's only coupling to the Agent: the visible workbench, the structured context, the model choice, the action registry and the
 * pushed prompt. The panel fetches its own status and credits and never invents a reply. `prompt`, `suggestions` and `onBusyChange`
 * are passed as extra props: the panel uses them when it supports them (conversation-first build) and ignores them otherwise.
 */
export function AgentSlot({ workbench, context, model, onModel, onAction, prompt, suggestions, onBusyChange }: { workbench: WorkbenchId; context: AgentContext; model: ModelChoice; onModel: (m: ModelChoice) => void; onAction: (a: UiAction) => Promise<unknown>; prompt: PushedPrompt | null; suggestions: string[]; onBusyChange: (busy: boolean) => void }) {
  const extra: Record<string, unknown> = { prompt, suggestions, onBusyChange };
  const root = useRef<HTMLDivElement>(null);
  // TEMPORARY bridge until the panel supports the `prompt` prop (set PANEL_SUPPORTS_PROMPT to true and delete this effect then):
  // type the text into the panel's own composer and press its Send button, exactly as a visitor would.
  useEffect(() => {
    if (!prompt || PANEL_SUPPORTS_PROMPT) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const ta = root.current?.querySelector<HTMLTextAreaElement>("textarea:not([disabled])");
      if (ta) {
        clearInterval(timer);
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, prompt.text);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        setTimeout(() => root.current?.querySelector<HTMLButtonElement>("button[type=submit]:not([disabled])")?.click(), 60);
      } else if (tries > 50) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [prompt]);
  return (
    <div ref={root} className="h-full min-h-0">
      <AgentPanel workbench={workbench} context={context} model={model} onModelChange={onModel} onAction={onAction} className="h-full" {...extra} />
    </div>
  );
}
