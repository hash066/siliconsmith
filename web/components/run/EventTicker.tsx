"use client";

import { useEffect, useRef } from "react";
import type { NodeId } from "@/lib/events";
import { clock } from "@/lib/format";
import type { RunState, TickerItem } from "@/lib/run-state";

const TONE: Record<TickerItem["tone"], string> = {
  neutral: "var(--ink-3)",
  pass: "var(--ink-2)",
  fail: "var(--red)",
  warn: "var(--amber)",
  signal: "var(--signal-ink)",
};

export function EventTicker({ state, onSelect, rows = 6 }: { state: RunState; onSelect: (id: NodeId) => void; rows?: number }) {
  const ref = useRef<HTMLOListElement>(null);
  const items = state.ticker.slice(-60);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, items.at(-1)?.seq]);

  return (
    <ol
      ref={ref}
      aria-label="Event log"
      aria-live="polite"
      aria-relevant="additions"
      className="scroll-quiet overflow-y-auto font-mono text-[12px] leading-[22px]"
      style={{ height: rows * 22 + 12 }}
    >
      {items.length === 0 && <li className="px-4 py-1.5 text-ink-3">Waiting for the first event…</li>}
      {items.map((it) => (
        <li key={it.seq} className="group flex items-baseline gap-3 px-4 hover:bg-raised/60">
          <span className="num w-12 shrink-0 text-right text-ink-3">{clock(it.t)}</span>
          <span className="w-1.5 shrink-0 self-center">
            <span className="block h-1.5 w-1.5 rounded-full" style={{ background: TONE[it.tone] }} aria-hidden="true" />
          </span>
          {it.nodeId ? (
            <button type="button" onClick={() => onSelect(it.nodeId!)} className="min-w-0 flex-1 truncate text-left text-ink-2 hover:text-ink" title={it.text}>
              {it.text}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-ink-2" title={it.text}>
              {it.text}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
