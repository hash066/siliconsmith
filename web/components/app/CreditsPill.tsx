"use client";

import { useEffect, useRef, useState } from "react";
import { pillText, usd2, type CreditsView } from "./credits";
import { IconCoin } from "./ui";

export type ModelChoice = "auto" | "ultra" | "super" | "nano";
export const MODEL_CHOICES: Array<{ id: ModelChoice; label: string; hint: string }> = [
  { id: "auto", label: "Auto", hint: "The agent routes each step to the right Nemotron model" },
  { id: "ultra", label: "Ultra", hint: "Nemotron Ultra: planning and diagnosis" },
  { id: "super", label: "Super", hint: "Nemotron Super: tool calls, repairs, code" },
  { id: "nano", label: "Nano", hint: "Nemotron Nano: summaries and routing" },
];

export function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="26" height="26" rx="8" fill="var(--hw-elevated)" stroke="var(--hw-border)" />
      <path d="M8 7v14M20 7v14M8 14h12" fill="none" stroke="url(#hwg)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="hwg" x1="7" y1="8" x2="21" y2="20">
          <stop stopColor="var(--hw-ember)" />
          <stop offset="1" stopColor="var(--hw-steel)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function CreditsPill({ credits }: { credits: CreditsView }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const low = credits.mode === "ready" && credits.remainingUsd !== null && credits.allowanceUsd ? credits.remainingUsd / credits.allowanceUsd < 0.15 : false;
  const tone = credits.mode === "offline" ? "var(--hw-ink-3)" : credits.poolExhausted || low ? "var(--hw-warn)" : "var(--hw-ok)";
  const pct = credits.mode === "ready" && credits.allowanceUsd ? Math.round(((credits.remainingUsd ?? 0) / credits.allowanceUsd) * 100) : null;
  return (
    <div ref={ref} className="relative" data-tour="credits">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="credits-pill"
        className="flex h-9 min-w-[88px] items-center justify-center gap-1.5 rounded-full border border-line bg-raised px-2.5 text-[12px] text-ink transition-colors hover:border-line-2 sm:min-w-[190px] sm:px-3"
        title="Demo credits: what is left of your visitor allowance"
      >
        <IconCoin size={15} className="shrink-0" />
        <span className="num truncate sm:hidden">{pillText(credits, true)}</span>
        <span className="num hidden truncate sm:inline">{pillText(credits)}</span>
        <span className="hidden h-1.5 w-1.5 rounded-full sm:block" style={{ background: tone }} aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" aria-label="Credit balance" className="hw-pop absolute right-0 top-11 z-50 w-[min(320px,calc(100vw-24px))] rounded-xl border border-line bg-panel p-4 shadow-[var(--hw-shadow)]">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Demo credits</h2>
            <span className="hw-label !text-[10px]">not real money</span>
          </div>
          {credits.mode === "ready" && credits.remainingUsd !== null ? (
            <>
              <p className="num mt-2 text-[26px] leading-none text-ink">{usd2(credits.remainingUsd)}</p>
              <p className="mt-1 text-[12px] text-ink-3">left of {usd2(credits.allowanceUsd ?? 0)} for this visitor</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${pct ?? 0} percent of the allowance left`}>
                <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: tone }} />
              </div>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12.5px]">
                <dt className="text-ink-3">Spent this visit</dt>
                <dd className="num text-ink">{usd2(credits.spentUsd ?? 0)}</dd>
                <dt className="text-ink-3">Shared pool</dt>
                <dd className="num text-ink">{credits.poolCapUsd !== null && credits.poolSpentUsd !== null ? `${usd2(credits.poolSpentUsd)} of ${usd2(credits.poolCapUsd)}` : "not reported"}</dd>
              </dl>
              {credits.poolExhausted && <p className="mt-2 rounded-md bg-amber-dim px-2.5 py-1.5 text-[12px] text-ink">The shared pool is used up. Agent turns are paused; the free checks still work.</p>}
            </>
          ) : credits.mode === "loading" ? (
            <p className="mt-2 text-[13px] text-ink-3" role="status">Asking the server for your balance…</p>
          ) : (
            <p className="mt-2 text-[13px] leading-snug text-ink-2">The agent service is not connected, so there is no balance to show. It is never guessed.</p>
          )}
          <p className="mt-3 border-t border-line pt-2 text-[12px] leading-snug text-ink-3">Board checks, Matter simulations and recorded runs are free and never spend credits. Limits are counted per server instance{credits.scope ? ` (${credits.scope})` : ""}.</p>
        </div>
      )}
    </div>
  );
}

