"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAgentStatus, parseEventStream, type AgentStatus } from "@/lib/agent-client";
import type { AgentTransport } from "@/lib/agent";
import { AgentPanel } from "../agent/AgentPanel";
import type { ModelChoice } from "./TopBar";

/**
 * The only file that knows how the app talks to the Agent panel. The panel comes from the agent session (`components/agent/AgentPanel`);
 * the app adds the chosen model, the visible workbench and a short context string to each turn. No reply is ever invented here:
 * when the endpoint is not connected the panel shows its own "not connected" state.
 */
export function AgentSlot({ model, workbench, runId, context }: { model: ModelChoice; workbench: string; runId: string | undefined; context: string }) {
  const [status, setStatus] = useState<AgentStatus>({ connected: false });
  useEffect(() => {
    const ctl = new AbortController();
    void fetchAgentStatus(ctl.signal).then(setStatus);
    return () => ctl.abort();
  }, []);

  const live = useRef({ model, workbench, runId, context });
  live.current = { model, workbench, runId, context };
  const transport = useMemo<AgentTransport | null>(
    () =>
      status.connected
        ? {
            async *send({ text, signal }) {
              const l = live.current;
              const res = await fetch("/api/agent", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ text, run_id: l.runId, model: l.model, workbench: l.workbench, context: l.context }),
                signal,
              });
              if (!res.ok || !res.body) {
                let message = `The agent endpoint answered ${res.status}.`;
                try {
                  const j = (await res.json()) as { message?: string };
                  if (j.message) message = j.message;
                } catch {
                  // keep the status-only message
                }
                throw new Error(message);
              }
              yield* parseEventStream(res.body);
            },
          }
        : null,
    [status.connected],
  );

  const limits = status.limits;
  return (
    <AgentPanel
      transport={transport}
      context={context}
      limitsNote={limits ? `Model: ${model === "auto" ? "Auto (the agent routes each step)" : model}. Up to ${limits.visitorTurnsPerDay} turns per visitor per day and ${limits.maxInputChars} characters per message. Limits are counted in server memory (per instance).` : undefined}
    />
  );
}
