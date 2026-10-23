"use client";
// Shared building blocks of the five games: buttons, verdict box, load/error states, a keyboard-navigable line list.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { describeError, isAbort } from "./api";

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hw-steel)]";

export type Tone = "ok" | "warn" | "bad" | "info";
export const TONE_VAR: Record<Tone, string> = { ok: "var(--hw-ok)", warn: "var(--hw-warn)", bad: "var(--hw-bad)", info: "var(--hw-steel)" };

export function Btn({ variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const base = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold motion-safe:transition-[transform,background-color,opacity] motion-safe:duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 ${FOCUS}`;
  const look = variant === "primary" ? "bg-[var(--hw-ember)] text-[var(--hw-on-accent)] hover:brightness-110" : "border border-[var(--hw-border)] text-[var(--hw-ink)] hover:border-[var(--hw-border-hover)] hover:bg-[var(--hw-elevated)]";
  return <button type="button" {...p} className={`${base} ${look} ${className}`} />;
}

export function LinkBtn({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--hw-border)] px-5 text-sm font-semibold text-[var(--hw-ink)] hover:border-[var(--hw-steel)] hover:bg-[var(--hw-elevated)] motion-safe:transition-colors ${FOCUS}`}
    >
      {children}
      <span aria-hidden>{"→"}</span>
    </a>
  );
}

export function Chip({ children, tone, raw }: { children: ReactNode; tone?: Tone; raw?: boolean }) {
  return (
    <span
      className={`hw-mono inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] tracking-[0.12em] text-[var(--hw-ink-2)] ${raw ? "" : "uppercase"}`}
      style={{ borderColor: tone ? TONE_VAR[tone] : "var(--hw-border)", color: tone ? TONE_VAR[tone] : undefined }}
    >
      {children}
    </span>
  );
}

export function EvidenceIds({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <p className="mt-2 flex min-w-0 flex-wrap gap-1.5" aria-label="Evidence ids">
      {ids.map((id) => (
        <code key={id} className="hw-mono max-w-full break-all rounded-md border border-[var(--hw-border)] bg-[var(--hw-bg)] px-1.5 py-0.5 text-[11px] text-[var(--hw-ink-2)]">
          {id}
        </code>
      ))}
    </p>
  );
}

/** Explanation first (the headline sentence and the why), numbers and evidence after it. */
export function Verdict({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="min-w-0 rounded-[var(--hw-radius-sm)] border bg-[var(--hw-bg)] p-4" style={{ borderColor: TONE_VAR[tone] }}>
      <p className="text-base font-semibold leading-snug" style={{ color: TONE_VAR[tone] }}>
        {title}
      </p>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--hw-ink-2)]">{children}</div>
    </div>
  );
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-[var(--hw-radius-sm)] border border-dashed border-[var(--hw-border)] p-4 text-sm text-[var(--hw-ink-2)]">
      <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-[var(--hw-ember)] border-t-transparent motion-safe:animate-spin" />
      {children}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="min-w-0 rounded-[var(--hw-radius-sm)] border border-[var(--hw-bad)] p-4 text-sm text-[var(--hw-ink-2)]">
      <p className="break-words">{describeError(error)}</p>
      {onRetry && (
        <Btn variant="ghost" className="mt-3" onClick={onRetry}>
          Try again
        </Btn>
      )}
    </div>
  );
}

export function PlayLabel({ children }: { children: ReactNode }) {
  return <p className="hw-label mb-2">{children}</p>;
}

// ---------- remote data ----------

const cache = new Map<string, unknown>();
export type Remote<T> = { state: "loading" } | { state: "error"; error: unknown } | { state: "ready"; data: T };

/** Loads once per key and keeps successes for the page's lifetime; aborts when the game unmounts. */
export function useRemote<T>(key: string, load: (signal: AbortSignal) => Promise<T>): [Remote<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Remote<T>>(() => (cache.has(key) ? { state: "ready", data: cache.get(key) as T } : { state: "loading" }));
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (cache.has(key)) {
      setState({ state: "ready", data: cache.get(key) as T });
      return;
    }
    const ctl = new AbortController();
    setState({ state: "loading" });
    loadRef.current(ctl.signal).then(
      (data) => {
        cache.set(key, data);
        if (!ctl.signal.aborted) setState({ state: "ready", data });
      },
      (error) => {
        if (!isAbort(error, ctl.signal)) setState({ state: "error", error });
      },
    );
    return () => ctl.abort();
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return [state, retry];
}

/** Runs one request at a time and cancels it on reset or unmount. */
export function useAction<A, R>(run: (arg: A, signal: AbortSignal) => Promise<R>) {
  const [state, setState] = useState<Remote<R> | { state: "idle" }>({ state: "idle" });
  const ctl = useRef<AbortController | null>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => () => ctl.current?.abort(), []);
  const start = useCallback((arg: A) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setState({ state: "loading" });
    runRef.current(arg, c.signal).then(
      (data) => !c.signal.aborted && setState({ state: "ready", data }),
      (error) => !isAbort(error, c.signal) && setState({ state: "error", error }),
    );
  }, []);
  const reset = useCallback(() => {
    ctl.current?.abort();
    setState({ state: "idle" });
  }, []);
  return { state, start, reset };
}

// ---------- selectable lines with roving focus ----------

export interface LineItem {
  id: string;
  node: ReactNode;
  /** Extra styling when the line is part of the revealed answer. */
  mark?: "hit" | "other" | "wrong";
  label: string;
}

const MARK: Record<NonNullable<LineItem["mark"]>, string> = {
  hit: "bg-[color-mix(in_srgb,var(--hw-ok)_18%,transparent)]",
  other: "bg-[color-mix(in_srgb,var(--hw-warn)_16%,transparent)]",
  wrong: "bg-[color-mix(in_srgb,var(--hw-bad)_16%,transparent)]",
};

/** A list of code-like lines, each a button. One tab stop; arrows, Home and End move; Enter or Space select. */
export function LineList({ items, selected, onSelect, label, disabled }: { items: LineItem[]; selected: string | null; onSelect: (id: string) => void; label: string; disabled?: boolean }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabStop = focusId && items.some((i) => i.id === focusId) ? focusId : (selected ?? items[0]?.id);
  const onKey = (e: KeyboardEvent, idx: number) => {
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? idx + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? idx - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = items[Math.max(0, Math.min(items.length - 1, to))];
    setFocusId(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div role="group" aria-label={label} className="min-w-0">
      {items.map((it, idx) => {
        const on = selected === it.id;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[it.id] = el;
            }}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            aria-label={it.label}
            tabIndex={it.id === tabStop ? 0 : -1}
            onFocus={() => setFocusId(it.id)}
            onKeyDown={(e) => onKey(e, idx)}
            onClick={() => onSelect(it.id)}
            className={`hw-mono flex min-h-8 w-full min-w-0 items-start gap-2 rounded-md px-2 py-1 text-left text-[12px] leading-5 text-[var(--hw-ink-2)] enabled:hover:bg-[var(--hw-elevated)] disabled:cursor-default motion-safe:transition-colors ${FOCUS} ${on ? "outline outline-2 -outline-offset-2 outline-[var(--hw-ember)] bg-[var(--hw-elevated)] text-[var(--hw-ink)]" : ""} ${it.mark ? MARK[it.mark] : ""}`}
          >
            {it.node}
          </button>
        );
      })}
    </div>
  );
}

export const pct = (v: number) => `${v.toFixed(v >= 10 ? 1 : 2)}%`;
export const x2 = (v: number) => `${v.toFixed(2)}x`;
