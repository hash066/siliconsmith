"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addUserMessage,
  AGENT_MODELS,
  applyAgentEvent,
  dismissPending,
  formatCostEstimate,
  hasUncitedClaim,
  initialAgentState,
  isActionTool,
  type AgentEvent,
  type AgentMessage,
  type AgentModel,
  type AgentState,
  type AgentTransport,
  type PendingAction,
  type ToolCall,
} from "@/lib/agent";

const MODEL_LABEL: Record<AgentModel, string> = { ultra: "Ultra", super: "Super", nano: "Nano" };
const MODEL_TITLE: Record<AgentModel, string> = {
  ultra: "Nemotron Ultra: planning and diagnosis",
  super: "Nemotron Super: tool calls, repairs, code",
  nano: "Nemotron Nano: summaries and routing",
};

export function ModelBadge({ model, active, connected }: { model: AgentModel; active: boolean; connected: boolean }) {
  return (
    <span
      title={connected ? MODEL_TITLE[model] : `${MODEL_TITLE[model]} (not connected)`}
      aria-current={active ? "true" : undefined}
      className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[12px] ${active ? "border-signal-line bg-signal-dim text-signal-ink" : "border-line text-ink-3"}`}
    >
      {MODEL_LABEL[model]}
    </span>
  );
}

const short = (v: unknown) => {
  const t = JSON.stringify(v);
  return t.length > 96 ? `${t.slice(0, 95)}…` : t;
};

export function ToolCallCard({ call }: { call: ToolCall }) {
  const action = isActionTool(call.name);
  const tone = call.status === "error" ? "var(--red)" : call.status === "ok" ? "var(--signal-ink)" : "var(--ink-3)";
  return (
    <div className="min-w-0 rounded-md border border-line bg-sunken px-3 py-2" role="group" aria-label={`Tool call ${call.name}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${call.status === "running" ? "anim-breathe" : ""}`} style={{ background: tone }} aria-hidden="true" />
        <code className="num min-w-0 flex-1 truncate text-[12px] text-ink">{call.name}</code>
        <span className="shrink-0 text-[11px] text-ink-3">{action ? "action" : "read-only"} · {call.status === "running" ? "running" : call.status === "ok" ? "done" : "failed"}</span>
      </div>
      <p className="num mt-1 break-all text-[11.5px] text-ink-3">{short(call.args)}</p>
      {call.result && <p className="mt-1 text-[12.5px] text-ink-2">{call.result}</p>}
      {call.error && <p className="mt-1 text-[12.5px] text-red">{call.error}</p>}
    </div>
  );
}

export function ActionConfirm({ action, onConfirm, onCancel }: { action: PendingAction; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="rounded-lg border border-amber/40 bg-amber-dim p-3" role="group" aria-label="Confirm action">
      <p className="text-[12px] text-ink-3">The agent wants to run</p>
      <p className="num mt-0.5 break-all text-[13px] text-ink">{action.tool}</p>
      <p className="mt-1 text-[13px] leading-snug text-ink">{action.summary}</p>
      <p className="num mt-1.5 text-[12px] text-amber" data-testid="cost-estimate">
        {formatCostEstimate(action.costEstimateUsd)}
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onConfirm} className="h-9 rounded-md bg-signal px-3 text-[13px] font-medium text-on-signal">
          Confirm and run
        </button>
        <button type="button" onClick={onCancel} className="h-9 rounded-md border border-line-2 px-3 text-[13px] text-ink-2 hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function MessageView({ m }: { m: AgentMessage }) {
  if (m.role === "user") {
    return (
      <li className="ml-auto max-w-[88%] min-w-0 rounded-lg bg-raised px-3 py-2 text-[13px] leading-snug text-ink">
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
      </li>
    );
  }
  const uncited = !m.streaming && hasUncitedClaim(m.text, m.evidence);
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        {m.model && <ModelBadge model={m.model} active connected />}
        {m.streaming && <span role="status">answering…</span>}
      </div>
      {m.toolCalls.map((c) => (
        <ToolCallCard key={c.id} call={c} />
      ))}
      {m.text && <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-ink">{m.text}</p>}
      {uncited && (
        <p className="rounded-md bg-amber-dim px-2.5 py-1.5 text-[12px] text-amber" role="note">
          This answer says something is verified or proven without citing evidence. Only the verifiers can set a status; treat it as unverified.
        </p>
      )}
      {m.evidence.length > 0 && (
        <p className="num break-all text-[11.5px] text-ink-3">
          Cites: {m.evidence.join(", ")}
        </p>
      )}
      {m.error && <p className="text-[12.5px] text-red">{m.error}</p>}
    </li>
  );
}

export interface AgentPanelViewProps {
  state: AgentState;
  connected: boolean;
  busy: boolean;
  /** One line of real project context shown above the composer (never model output). */
  context?: string;
  /** A failure before any turn started (for example the request could not be sent). */
  error?: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Presentational panel. `connected=false` is the honest state: nothing here looks like a model answer. */
export function AgentPanelView({ state, connected, busy, context, error, onSend, onStop, onConfirm, onCancel }: AgentPanelViewProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && state.messages.length > 0) el.scrollTop = el.scrollHeight;
  }, [state.messages]);
  const submit = () => {
    const t = draft.trim();
    if (!t || !connected || busy) return;
    onSend(t);
    setDraft("");
  };
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Agent">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="mr-auto text-[13px] font-medium text-ink">Agent</h2>
        <div className="flex items-center gap-1.5" role="group" aria-label="Models on Nebius Token Factory">
          {AGENT_MODELS.map((m) => (
            <ModelBadge key={m} model={m} active={connected && state.activeModel === m} connected={connected} />
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!connected && state.messages.length === 0 ? (
          <div className="rounded-lg border border-line bg-sunken p-4" role="status">
            <h3 className="text-[14px] font-medium text-ink">Agent endpoint not connected yet</h3>
            <p className="mt-1.5 text-[13px] leading-snug text-ink-3">
              Nemotron on Nebius Token Factory will answer here. Until the endpoint exists, nothing in this panel is a model response, and no model is active.
            </p>
            <p className="mt-2 text-[13px] leading-snug text-ink-3">Replays, the evidence drawer and every number on the canvas work without it.</p>
          </div>
        ) : (
          <ol className="flex min-w-0 flex-col gap-4" aria-label="Conversation" aria-live="polite">
            {state.messages.map((m) => (
              <MessageView key={m.id} m={m} />
            ))}
          </ol>
        )}
        {error && (
          <p className="mt-3 rounded-md bg-red-dim px-3 py-2 text-[12.5px] text-red" role="alert">
            {error}. Nothing was changed; you can send it again.
          </p>
        )}
        {state.pending && (
          <div className="mt-4">
            <ActionConfirm action={state.pending} onConfirm={onConfirm} onCancel={onCancel} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {context && <p className="num mb-2 truncate text-[11.5px] text-ink-3" title={context}>Context: {context}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2"
        >
          <label htmlFor="agent-input" className="sr-only">
            Message the agent
          </label>
          <textarea
            id="agent-input"
            rows={2}
            value={draft}
            disabled={!connected}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={connected ? "Ask about this run" : "Agent endpoint not connected"}
            className="min-h-[56px] min-w-0 flex-1 resize-none rounded-md border border-line-2 bg-sunken px-3 py-2 text-[13px] text-ink placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {busy ? (
            <button type="button" onClick={onStop} className="h-10 shrink-0 rounded-md border border-line-2 px-3 text-[13px] text-ink">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!connected || !draft.trim()} className="h-10 shrink-0 rounded-md bg-signal px-3 text-[13px] font-medium text-on-signal disabled:cursor-not-allowed disabled:opacity-40">
              Send
            </button>
          )}
        </form>
      </div>
    </section>
  );
}

let nextId = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Stateful panel. Pass a transport to connect it; with none (today) it stays in the "not connected" state. */
export function AgentPanel({ transport, context }: { transport?: AgentTransport | null; context?: string }) {
  const [state, setState] = useState<AgentState>(initialAgentState);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const [connError, setConnError] = useState<string | null>(null);

  const consume = useCallback(async (events: AsyncIterable<AgentEvent>) => {
    let turn: string | null = null;
    setConnError(null);
    try {
      for await (const e of events) {
        if (e.type === "turn.started") turn = e.id;
        setState((s) => applyAgentEvent(s, e));
      }
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        const message = err instanceof Error ? err.message : "The agent connection failed";
        if (turn) setState((s) => applyAgentEvent(s, { type: "turn.error", id: turn!, message }));
        else setConnError(message);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const onSend = useCallback(
    (text: string) => {
      if (!transport) return;
      const ctl = new AbortController();
      abort.current = ctl;
      setBusy(true);
      setState((s) => addUserMessage(s, newId("u"), text));
      void consume(transport.send({ text, signal: ctl.signal }));
    },
    [transport, consume],
  );

  const onConfirm = useCallback(() => {
    const action = state.pending;
    if (!transport?.confirm || !action) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setState((s) => dismissPending(s));
    void consume(transport.confirm(action, ctl.signal));
  }, [transport, state.pending, consume]);

  return (
    <AgentPanelView
      state={state}
      connected={!!transport}
      busy={busy}
      context={context}
      error={connError}
      onSend={onSend}
      onStop={() => abort.current?.abort()}
      onConfirm={onConfirm}
      onCancel={() => setState((s) => dismissPending(s))}
    />
  );
}
