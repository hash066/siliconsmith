"use client";

import { useCallback, useRef, useState } from "react";
import { SPEEDS, type RunController, type Snapshot } from "@/lib/controller";
import { clock } from "@/lib/format";
import type { Marker } from "@/lib/run-state";

const MARK: Record<Marker["kind"], string> = {
  best: "var(--signal)",
  fail: "var(--red)",
  prune: "var(--ink-3)",
  done: "var(--ink)",
};

export function PlayerControls({ c, snap }: { c: RunController; snap: Snapshot }) {
  if (snap.mode === "live") {
    const color = snap.connection === "open" ? "var(--signal)" : snap.connection === "connecting" ? "var(--amber)" : "var(--ink-3)";
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
        <span className={`h-2 w-2 rounded-full ${snap.connection === "open" ? "anim-breathe" : ""}`} style={{ background: color }} aria-hidden="true" />
        Live · {snap.connection}
        <span className="num text-ink-3">{clock(snap.t)}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => c.toggle()}
        aria-label={snap.playing ? "Pause replay" : snap.ended ? "Replay from the start" : "Play replay"}
        className="grid h-9 w-9 place-items-center rounded-md bg-ink text-bg transition-transform duration-150 active:scale-95"
      >
        {snap.playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2" y="1.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
            <rect x="7.4" y="1.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
          </svg>
        ) : snap.ended ? (
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 7a4 4 0 1 0 1.3-2.95" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M3.4 1.6v2.9h2.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 1.6v8.8L10.2 6z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div role="radiogroup" aria-label="Replay speed" className="flex h-9 items-center rounded-md border border-line-2 p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={snap.speed === s}
            onClick={() => c.setSpeed(s)}
            className={`num h-full min-w-8 rounded-[5px] px-1.5 text-[12px] transition-colors duration-150 ${snap.speed === s ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
          >
            {s}×
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          c.pause();
          c.seek(snap.duration);
        }}
        className="hidden h-9 rounded-md px-2 text-[12.5px] text-ink-3 transition-colors hover:text-ink sm:block"
      >
        Skip to end
      </button>
    </div>
  );
}

/** The time base: a scrubber over run time with markers for new bests, failures and prunes. */
export function Scrubber({ c, snap }: { c: RunController; snap: Snapshot }) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dur = Math.max(1, snap.duration);
  const live = snap.mode === "live";
  const tAt = useCallback(
    (clientX: number) => {
      const r = track.current!.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur;
    },
    [dur],
  );
  const markers = snap.state.markers.filter((m) => m.kind !== "prune" || snap.state.markers.length < 80);

  return (
    <div className="flex items-center gap-3">
      <span className="num w-12 shrink-0 text-right text-[12px] text-ink-2">{clock(snap.t)}</span>
      <div
        ref={track}
        role="slider"
        tabIndex={live ? -1 : 0}
        aria-label="Run time"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur / 1000)}
        aria-valuenow={Math.round(snap.t / 1000)}
        aria-valuetext={`${clock(snap.t)} of ${clock(dur)}`}
        className={`relative h-8 flex-1 touch-none select-none ${live ? "" : "cursor-pointer"}`}
        onPointerDown={(e) => {
          if (live) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          c.seek(tAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (live) return;
          setHover(tAt(e.clientX));
          if (e.buttons === 1) c.seek(tAt(e.clientX));
        }}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (live) return;
          const step = e.shiftKey ? 60_000 : 10_000;
          if (e.key === "ArrowRight") c.seek(snap.t + step);
          else if (e.key === "ArrowLeft") c.seek(snap.t - step);
          else if (e.key === "Home") c.seek(0);
          else if (e.key === "End") c.seek(dur);
          else if (e.key === " ") c.toggle();
          else return;
          e.preventDefault();
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-raised" />
        <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-ink-3" style={{ width: `${(snap.t / dur) * 100}%` }} />
        {markers.map((m) => (
          <span
            key={`${m.kind}${m.seq}`}
            title={m.label}
            className="absolute top-1/2 block -translate-x-1/2"
            style={{
              left: `${(m.t / dur) * 100}%`,
              width: m.kind === "best" ? 2 : m.kind === "fail" ? 2 : 3,
              height: m.kind === "best" ? 16 : m.kind === "fail" ? 10 : 3,
              marginTop: m.kind === "best" ? -8 : m.kind === "fail" ? -5 : -1.5,
              borderRadius: m.kind === "prune" ? 9 : 1,
              background: MARK[m.kind],
              opacity: m.t <= snap.t ? 1 : 0.45,
            }}
          />
        ))}
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-ink" style={{ left: `${(snap.t / dur) * 100}%` }} />
        {hover !== null && (
          <span className="num pointer-events-none absolute -top-5 -translate-x-1/2 rounded bg-raised px-1.5 text-[11px] text-ink-2 shadow-[var(--shadow-float)]" style={{ left: `${(hover / dur) * 100}%` }}>
            {clock(hover)}
          </span>
        )}
      </div>
      <span className="num w-12 shrink-0 text-[12px] text-ink-3">{clock(live ? snap.t : dur)}</span>
    </div>
  );
}
