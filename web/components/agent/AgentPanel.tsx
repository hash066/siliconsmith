"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addUserMessage,
  applyAgentEvent,
  dismissPending,
  formatCostEstimate,
  hasUncitedClaim,
  initialAgentState,
  isActionTool,
  MODEL_CHOICES,
  type AgentContext,
  type AgentEvent,
  type AgentMessage,
  type AgentModel,
  type AgentRequest,
  type AgentState,
  type AgentTransport,
  type ModelChoice,
  type PendingAction,
  type ToolCall,
} from "@/lib/agent";
import type { UiAction } from "@/lib/agent-actions";
import { CreditsError, fetchAgentStatus, httpAgentTransport } from "@/lib/agent-client";
import { WORKBENCHES, type WorkbenchId } from "@/lib/brand";
import { formatBalance, formatUsd, useCredits, type CreditsSnapshot } from "@/lib/credits-client";
import { STAGE_PLAIN } from "@/lib/agent-silicon";
import { Markdown } from "./Markdown";

export const SUGGESTED_PROMPTS: Record<WorkbenchId, string[]> = {
  matter: ["Try 10 fins and show me the plate.", "Switch to radial spokes and simulate it.", "Propose an optimisation of the fin parameters for a lower peak temperature."],
  board: ["Check the GPIO12 fault template and tell me which rung fails.", "Load the clean template and move the wake button to GPIO13, then re-check.", "Draft a design for a 3.3 V sensor board with an LED and check it."],
  silicon: ["Why was n2.2.4 pruned in r_w1_contree3?", "Open the best node of r_w1_contree3 and explain what it does.", "Which library instruction has the biggest speedup, and how do I reproduce it?"],
};

/** What a person sees on the start screen (no workbench yet): one real, working prompt per workbench. */
export const START_PROMPTS: string[] = [
  "A heat sink for a 5 W chip, 40 mm square, under 70 C.",
  "A battery ESP32 sensor board with a BME280 and USB-C charging; check it against its firmware.",
  "Make this loop faster with a custom RISC-V instruction.",
];

/** Plain names for the chips in a conversation; the technical name stays in the expanded card. */
const TOOL_PLAIN: Record<string, string> = {
  board_check: "Checking the board",
  board_set_design: "Updating the board design and checking it",
  matter_simulate: "Simulating the heat sink",
  matter_optimize: "Searching for a cooler heat sink",
  board_design: "Drafting a board design",
  silicon_run: "Running the live Silicon pipeline",
  silicon_propose: "Choosing the instruction",
  library_search: "Looking up the stored results",
  evidence_get: "Opening the stored evidence",
  run_nodes_search: "Searching the recorded runs",
  run_explain_failure: "Finding out why it failed",
  workbench_open: "Opening the workbench",
  silicon_open_run: "Opening a recorded run",
  workflow_focus: "Moving to the next step",
  propose_parameters: "Choosing the next parameters",
  propose_board_design: "Proposing a board design",
  propose_matter_optimize: "Proposing a search for a cooler heat sink",
  propose_silicon_run: "Proposing a live Silicon run",
};
export const toolPlain = (c: { name: string; args: Record<string, unknown> }): string => (c.name === "silicon_stage" ? (STAGE_PLAIN[String(c.args.stage)] ?? "Working") : (TOOL_PLAIN[c.name] ?? c.name));

const MODEL_LABEL: Record<ModelChoice, string> = { auto: "Auto", ultra: "Ultra", super: "Super", nano: "Nano" };
const MODEL_TITLE: Record<ModelChoice, string> = {
  auto: "Auto: Nano for lookups, Super for turns that act with tools, Ultra for planning and diagnosis",
  ultra: "Nemotron Ultra: planning and diagnosis",
  super: "Nemotron Super: tool calls and edits",
  nano: "Nemotron Nano: lookups",
};

export function ModelSelector({ value, onChange, active, disabled }: { value: ModelChoice; onChange: (m: ModelChoice) => void; active: AgentModel | null; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Model" className="order-last flex h-7 w-full items-center rounded-md border border-line-2 p-0.5 sm:order-none sm:w-auto">
      {MODEL_CHOICES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          disabled={disabled}
          title={MODEL_TITLE[m]}
          onClick={() => onChange(m)}
          className={`h-full rounded-[5px] px-2 text-[12px] transition-colors duration-150 disabled:opacity-50 ${value === m ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
        >
          {MODEL_LABEL[m]}
          {m === "auto" && value === "auto" && active ? <span className="ml-1 text-ink-3">· {MODEL_LABEL[active]}</span> : null}
        </button>
      ))}
    </div>
  );
}

const short = (v: unknown, n = 1400) => {
  const t = JSON.stringify(v, null, 2);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function ToolCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const action = isActionTool(call.name);
  const tone = call.status === "error" ? "var(--red)" : call.status === "ok" ? "var(--signal-ink)" : "var(--ink-3)";
  return (
    <div className="min-w-0 rounded-md border border-line bg-sunken" role="group" aria-label={`Tool call ${call.name}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${call.status === "running" ? "anim-breathe" : ""}`} style={{ background: tone }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{toolPlain(call)}</span>
        <span className="shrink-0 text-[11px] text-ink-3">{call.status === "running" ? "working" : call.status === "ok" ? "done" : "failed"}</span>
        <span className="shrink-0 text-[11px] text-ink-3" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {(call.result || call.error) && !open && <p className={`px-3 pb-2 text-[12px] leading-snug ${call.error ? "text-red" : "text-ink-2"}`}>{call.error ?? call.result}</p>}
      {open && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2">
          <div>
            <p className="text-[11px] text-ink-3">{action ? "Action" : "Tool"} <code className="num text-ink-2">{call.name}</code></p>
            <p className="mt-1.5 text-[11px] text-ink-3">Arguments</p>
            <pre className="scroll-quiet num mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11.5px] text-ink-2">{short(call.args)}</pre>
          </div>
          <div>
            <p className="text-[11px] text-ink-3">{call.error ? "Error" : "Result"}</p>
            <p className={`mt-0.5 break-words text-[12.5px] leading-snug ${call.error ? "text-red" : "text-ink-2"}`}>{call.error ?? call.result ?? "waiting…"}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export const actionLabel = (a: UiAction): string => {
  switch (a.name) {
    case "workbench.open":
      return `Opened ${a.args.workbench}`;
    case "board.load_template":
      return `Loaded template ${a.args.template_id}`;
    case "board.set_design":
      return "Set the design";
    case "board.check":
      return "Ran the check";
    case "matter.set_params":
      return "Set the parameters";
    case "matter.simulate":
      return "Ran the simulation";
    case "silicon.open_run":
      return `Opened ${a.args.run_id}${a.args.node_id ? ` · ${a.args.node_id}` : ""}`;
    case "workflow.focus":
      return `Focused ${a.args.step}`;
    case "silicon.run_live":
      return "Started the live Silicon run";
    case "board.design":
      return "Started a board design";
    case "preview.tab":
      return `Showed the ${a.args.tab}`;
  }
};

export function ConfirmCard({ action, remainingUsd, onRun, onCancel }: { action: PendingAction; remainingUsd: number | null; onRun: () => void; onCancel: () => void }) {
  const cap = action.costEstimateUsd;
  const lacking = remainingUsd !== null && cap !== null && remainingUsd < cap;
  return (
    <div className="rounded-lg border border-amber/40 bg-amber-dim p-3" role="group" aria-label="Confirm before spending credits">
      <p className="text-[12px] text-ink-3">The agent proposes a loop that spends demo credits</p>
      <p className="mt-1 text-[13px] leading-snug text-ink">{action.summary}</p>
      <p className="num mt-1.5 text-[12px] text-amber" data-testid="cost-estimate">
        {cap === null ? formatCostEstimate(null) : `Up to ${formatUsd(cap)} (hard cap), usually less`}
      </p>
      {lacking && <p className="mt-1 text-[12px] text-red">Not enough credits left for this cap ({formatUsd(remainingUsd!)} remaining).</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onRun} disabled={lacking} className="h-9 rounded-md bg-signal px-3 text-[13px] font-medium text-on-signal disabled:cursor-not-allowed disabled:opacity-40">
          Run{cap !== null ? ` (up to ${formatUsd(cap)})` : ""}
        </button>
        <button type="button" onClick={onCancel} className="h-9 rounded-md border border-line-2 px-3 text-[13px] text-ink-2 hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function MessageView({ m, onApply }: { m: AgentMessage; onApply?: (a: UiAction) => void }) {
  if (m.role === "user") {
    return (
      <li className="ml-auto min-w-0 max-w-[88%] rounded-lg bg-raised px-3 py-2 text-[13px] leading-snug text-ink">
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
      </li>
    );
  }
  const uncited = !m.streaming && hasUncitedClaim(m.text, m.evidence);
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        {m.model && <span className="inline-flex h-5 items-center rounded-full border border-signal-line bg-signal-dim px-2 text-[11px] text-signal-ink">{MODEL_LABEL[m.model]}</span>}
        {m.streaming && <span role="status">working…</span>}
      </div>
      {m.toolCalls.map((c) => (
        <ToolCard key={c.id} call={c} />
      ))}
      {(m.uiActions?.length ?? 0) > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Actions applied in the app">
          {m.uiActions!.map((a, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onApply?.(a)}
                disabled={!onApply}
                title="Apply this action in the app again"
                className="inline-flex h-6 items-center gap-1 rounded-full border border-line-2 px-2 text-[11.5px] text-ink-2 hover:text-ink disabled:cursor-default disabled:hover:text-ink-2"
              >
                <span aria-hidden="true" className="text-signal-ink">
                  ✓
                </span>
                {actionLabel(a)}
                {onApply && <span className="text-ink-3">· Apply</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {m.text && <Markdown text={m.text} />}
      {uncited && (
        <p className="rounded-md bg-amber-dim px-2.5 py-1.5 text-[12px] leading-snug text-amber" role="note">
          This answer says something is verified or proven without citing evidence. Only the verifiers can set a status; treat it as unverified.
        </p>
      )}
      {m.evidence.length > 0 && (
        <details className="text-[11.5px] text-ink-3">
          <summary className="cursor-pointer select-none">Show the evidence behind this ({m.evidence.length})</summary>
          <p className="num mt-1 break-all">{m.evidence.join(", ")}</p>
        </details>
      )}
      {(m.flags ?? []).map((f, i) => (
        <p key={i} className="rounded-md bg-red-dim px-2.5 py-1.5 text-[12px] leading-snug text-red" role="note">
          {f.message}
        </p>
      ))}
      {m.cost && !m.streaming && (
        <p className="num text-[11px] text-ink-3" title="Real token usage at Token Factory list prices, so an estimate">
          {m.cost.usd > 0 ? `≈ ${formatUsd(m.cost.usd)}` : "$0"} · {m.cost.tokensIn.toLocaleString("en-US")} in · {m.cost.tokensOut.toLocaleString("en-US")} out · {MODEL_LABEL[m.cost.model]}
        </p>
      )}
      {m.error && <p className="text-[12.5px] text-red">{m.error}</p>}
    </li>
  );
}

export interface AgentPanelViewProps {
  state: AgentState;
  /** Absent on the start screen: the agent routes the goal itself. */
  workbench?: WorkbenchId;
  /** Starter prompts for an empty conversation (default: the built-in ones for the workbench). */
  prompts?: string[];
  /** null while the status probe is in flight: the panel reserves its space instead of flashing "not connected". */
  connected: boolean | null;
  busy: boolean;
  model: ModelChoice;
  onModelChange: (m: ModelChoice) => void;
  credits: CreditsSnapshot | null;
  creditsExhausted: boolean;
  chips?: Array<{ label: string; value?: string }>;
  /** A failure before any turn started (a request that could not be sent). */
  error?: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onRun: () => void;
  onCancel: () => void;
  onApply?: (a: UiAction) => void;
}

const Skeleton = ({ className }: { className: string }) => <span aria-hidden="true" className={`block animate-pulse rounded bg-raised ${className}`} />;

/** Presentational panel. `connected=false` is the honest state: nothing here looks like a model answer. */
export function AgentPanelView(p: AgentPanelViewProps) {
  const { state, workbench, connected, busy, model, credits, creditsExhausted } = p;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && state.messages.length > 0) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.pending]);
  const lastMsg = state.messages[state.messages.length - 1];
  const followUps = !busy && !state.pending && lastMsg && lastMsg.role === "assistant" && !lastMsg.streaming && !lastMsg.error ? (lastMsg.suggestions ?? []) : [];
  const checking = connected === null;
  const blocked = connected !== true || creditsExhausted;
  const submit = () => {
    const t = draft.trim();
    if (!t || blocked || busy) return;
    p.onSend(t);
    setDraft("");
  };
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Agent">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-2.5">
        <h2 className="mr-auto text-[13px] font-medium text-ink">Agent</h2>
        <ModelSelector value={model} onChange={p.onModelChange} active={state.activeModel} disabled={busy} />
        {connected !== false && (credits ? (
          <span className="num min-w-[88px] text-right text-[11.5px] text-ink-3" title={`Demo credits. Pool ${formatUsd(credits.pool.spentUsd)} of ${formatUsd(credits.pool.capUsd)}. ${credits.scope}.`}>
            {formatBalance(credits.remainingUsd)} left
          </span>
        ) : (
          <Skeleton className="ml-auto h-3.5 w-[88px]" />
        ))}
      </div>

      <div ref={scrollRef} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {checking && state.messages.length === 0 ? (
          <div role="status" aria-label="Checking the agent endpoint" className="min-h-[188px]">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2.5 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-4/5" />
            <Skeleton className="mt-4 h-9 w-full" />
            <Skeleton className="mt-2 h-9 w-full" />
            <Skeleton className="mt-2 h-9 w-full" />
          </div>
        ) : connected === false && state.messages.length === 0 ? (
          <div className="rounded-lg border border-line bg-sunken p-4" role="status">
            <h3 className="text-[14px] font-medium text-ink">Agent endpoint not connected yet</h3>
            <p className="mt-1.5 text-[13px] leading-snug text-ink-3">Nemotron on Nebius Token Factory will answer here. Until the server has a key, nothing in this panel is a model response, and no model is active.</p>
            <p className="mt-2 text-[13px] leading-snug text-ink-3">The Board check, the Matter simulation and the recorded runs work without it.</p>
          </div>
        ) : state.messages.length === 0 ? (
          <div role="status">
            <h3 className="text-[14px] font-medium text-ink">Ask the agent to do it</h3>
            <p className="mt-1 text-[13px] leading-snug text-ink-3">It runs the free checkers in the app for you and cites what the verifiers say. It cannot declare anything proven.</p>
            <ul className="mt-3 flex flex-col gap-2" aria-label="Suggested prompts">
              {(p.prompts ?? (workbench ? SUGGESTED_PROMPTS[workbench] : START_PROMPTS)).map((q) => (
                <li key={q}>
                  <button type="button" onClick={() => p.onSend(q)} disabled={busy || blocked} className="w-full rounded-md border border-line px-3 py-2 text-left text-[13px] leading-snug text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="flex min-w-0 flex-col gap-4" aria-label="Conversation" aria-live="polite">
            {state.messages.map((m) => (
              <MessageView key={m.id} m={m} onApply={p.onApply} />
            ))}
          </ol>
        )}
        {followUps.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Suggested next steps">
            {followUps.map((q) => (
              <li key={q}>
                <button type="button" onClick={() => p.onSend(q)} disabled={busy || blocked} className="inline-flex min-h-7 items-center rounded-full border border-line-2 px-2.5 py-1 text-left text-[12px] leading-snug text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-50">
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}
        {p.error && (
          <p className="mt-3 rounded-md bg-red-dim px-3 py-2 text-[12.5px] text-red" role="alert">
            {p.error}
          </p>
        )}
        {state.pending && (
          <div className="mt-4">
            <ConfirmCard action={state.pending} remainingUsd={credits ? credits.remainingUsd : null} onRun={p.onRun} onCancel={p.onCancel} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {creditsExhausted && connected === true && (
          <p className="mb-2 rounded-md bg-amber-dim px-2.5 py-1.5 text-[12px] leading-snug text-amber" role="status">
            Your demo credits are used up{credits && credits.pool.spentUsd >= credits.pool.capUsd ? " (the shared pool is empty)" : ""}. The free tools and the recorded runs keep working.
          </p>
        )}
        {(p.chips?.length ?? 0) > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Context the agent can see">
            {p.chips!.map((c, i) => (
              <li key={i} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2" title="The agent sees this">
                <span className="truncate">
                  {c.label}
                  {c.value ? <span className="num text-ink-3">: {c.value}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
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
            disabled={blocked}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={checking ? "Checking the agent endpoint" : !connected ? "Agent endpoint not connected" : creditsExhausted ? "Demo credits used up" : "Ask or tell the agent what to do"}
            className="min-h-[56px] min-w-0 flex-1 resize-none rounded-md border border-line-2 bg-sunken px-3 py-2 text-[13px] text-ink placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {busy ? (
            <button type="button" onClick={p.onStop} className="h-10 shrink-0 rounded-md border border-line-2 px-3 text-[13px] text-ink">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={blocked || !draft.trim()} className="h-10 shrink-0 rounded-md bg-signal px-3 text-[13px] font-medium text-on-signal disabled:cursor-not-allowed disabled:opacity-40">
              Send
            </button>
          )}
        </form>
        <p className="mt-1.5 min-h-[30px] text-[11px] leading-snug text-ink-3">Demo credits.{credits ? ` ${credits.scope[0].toUpperCase()}${credits.scope.slice(1)}.` : ""}</p>
      </div>
    </section>
  );
}

let nextId = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export interface AgentPanelProps {
  /** A prompt pushed in by the app (the start screen's first goal, a "Fix it" button): sent as a normal user turn once per `id`, after the panel
   * is connected and has credits. If a turn is running it waits for it to end; with no credits left it is not sent. */
  prompt?: { id: number; text: string };
  /** Starter prompts shown on an empty conversation instead of the built-in ones. */
  suggestions?: string[];
  /** Called whenever a turn starts or ends, for a progress chip elsewhere in the app. */
  onBusyChange?: (busy: boolean) => void;
  /** A saved conversation to start from (read once, on mount: remount the panel with a new key to switch conversations). */
  initialState?: AgentState;
  /** Called after every change to the conversation, so the app can save it. */
  onStateChange?: (s: AgentState) => void;
  /** Absent on the start screen: the agent routes the goal itself. */
  workbench?: WorkbenchId;
  /** What the user sees right now. The agent can act on it (edit the current design, tune the current parameters). */
  context?: AgentContext;
  /** Controlled model choice (for a top-bar selector). Omit it and the panel keeps its own. */
  model?: ModelChoice;
  onModelChange?: (m: ModelChoice) => void;
  /** Apply an action in the app: the agent performed it on the server and the app mirrors it. Also called by the Apply button. */
  onAction?: (action: UiAction) => void | Promise<unknown>;
  /** Override for tests; by default `/api/agent`. */
  transport?: AgentTransport;
  className?: string;
}

/** The agent. Streaming chat, model selector, tool cards, actions in the app, confirmed loops and real per-message cost. */
export function AgentPanel({ prompt, suggestions, onBusyChange, initialState, onStateChange, workbench, context, model: modelProp, onModelChange, onAction, transport: transportProp, className = "" }: AgentPanelProps) {
  const [state, setState] = useState<AgentState>(() => initialState ?? initialAgentState());
  const changeRef = useRef(onStateChange);
  changeRef.current = onStateChange;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    changeRef.current?.(state);
  }, [state]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(transportProp ? true : null);
  const [ownModel, setOwnModel] = useState<ModelChoice>("auto");
  const [connError, setConnError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const { credits, exhausted, refresh } = useCredits();
  const transport = useMemo(() => transportProp ?? httpAgentTransport(), [transportProp]);
  const model = modelProp ?? ownModel;

  useEffect(() => {
    if (transportProp) return;
    const ctl = new AbortController();
    void fetchAgentStatus(ctl.signal).then((s) => setConnected(s.connected));
    return () => ctl.abort();
  }, [transportProp]);

  const consume = useCallback(
    async (events: AsyncIterable<AgentEvent>) => {
      let turn: string | null = null;
      setConnError(null);
      try {
        for await (const e of events) {
          if (e.type === "turn.started") turn = e.id;
          setState((s) => applyAgentEvent(s, e));
          if (e.type === "ui.action") void Promise.resolve(actionRef.current?.(e.action)).catch(() => undefined);
        }
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          const message = err instanceof Error ? err.message : "The agent connection failed";
          if (turn) setState((s) => applyAgentEvent(s, { type: "turn.error", id: turn!, message }));
          else setConnError(err instanceof CreditsError ? message : `${message} Nothing was spent.`);
        }
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [refresh],
  );

  const request = useCallback(
    (extra: Partial<AgentRequest> & { text: string }) => {
      const ctl = new AbortController();
      abort.current = ctl;
      setBusy(true);
      const history = stateRef.current.messages
        .filter((m) => m.text.trim())
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text }));
      void consume(transport.send({ model, workbench, context, history, ...extra, signal: ctl.signal }));
    },
    [transport, model, workbench, context, consume],
  );

  const onSend = useCallback(
    (text: string) => {
      setState((s) => addUserMessage(dismissPending(s), newId("u"), text));
      request({ text });
    },
    [request],
  );

  const busyRef = useRef(onBusyChange);
  busyRef.current = onBusyChange;
  useEffect(() => {
    busyRef.current?.(busy);
  }, [busy]);
  const lastPrompt = useRef<number | null>(null);
  useEffect(() => {
    if (!prompt || !prompt.text.trim() || lastPrompt.current === prompt.id || connected !== true || !credits || exhausted || busy) return;
    lastPrompt.current = prompt.id;
    onSend(prompt.text.trim());
  }, [prompt, connected, credits, exhausted, busy, onSend]);

  const onRun = useCallback(() => {
    const p = stateRef.current.pending;
    if (!p || !p.args) return;
    setState((s) => dismissPending(s));
    request({ text: p.summary, confirm: true, action: { tool: p.tool as "board_design", args: p.args } });
  }, [request]);

  const chips = useMemo(() => {
    if (context?.chips?.length) return context.chips;
    const out: Array<{ label: string; value?: string }> = workbench ? [{ label: "Workbench", value: WORKBENCHES[workbench].name }] : [];
    if (context?.board?.template_id) out.push({ label: "Design", value: context.board.template_id });
    if (context?.matter?.generator) out.push({ label: "Generator", value: context.matter.generator });
    if (context?.silicon?.run_id) out.push({ label: "Run", value: context.silicon.run_id });
    return out;
  }, [context, workbench]);

  return (
    <div className={`h-full min-h-0 min-w-0 ${className}`}>
      <AgentPanelView
        state={state}
        workbench={workbench}
        prompts={suggestions}
        connected={connected}
        busy={busy}
        model={model}
        onModelChange={(m) => (onModelChange ? onModelChange(m) : setOwnModel(m))}
        credits={credits}
        creditsExhausted={exhausted}
        chips={chips}
        error={connError}
        onSend={onSend}
        onStop={() => abort.current?.abort()}
        onRun={onRun}
        onCancel={() => setState((s) => dismissPending(s))}
        onApply={onAction ? (a) => void Promise.resolve(onAction(a)).catch(() => undefined) : undefined}
      />
    </div>
  );
}
