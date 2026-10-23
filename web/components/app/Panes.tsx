"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clampLayout, DEFAULT_LAYOUT, keyDelta, LAYOUT_KEY, LIMITS, parseLayout, type PaneLayout } from "./layout-state";
import { IconChevron } from "./ui";

/** Persisted pane layout. Storage access is guarded: it can throw in private windows and is absent during prerender. */
export function usePaneLayout(containerRef: React.RefObject<HTMLElement | null>) {
  const [layout, setLayoutState] = useState<PaneLayout>(DEFAULT_LAYOUT);
  const [width, setWidth] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      setLayoutState(parseLayout(localStorage.getItem(LAYOUT_KEY)));
    } catch {
      // storage unavailable: defaults stay
    }
    loaded.current = true;
  }, []);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const setLayout = useCallback((f: (l: PaneLayout) => PaneLayout) => {
    setLayoutState((l) => {
      const next = f(l);
      if (loaded.current) {
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
        } catch {
          // not persisted; the layout still works for this visit
        }
      }
      return next;
    });
  }, []);
  const reset = useCallback(() => setLayout(() => DEFAULT_LAYOUT), [setLayout]);
  return { layout: clampLayout(layout, width), raw: layout, setLayout, reset, width };
}

/** A vertical drag handle that is also a keyboard-operable separator (arrow keys, Home resets, Enter collapses the neighbour). */
export function Splitter({ label, value, min, max, onDelta, onReset, onToggle, className = "" }: { className?: string; label: string; value: number; min: number; max: number; onDelta: (dx: number) => void; onReset: () => void; onToggle: () => void }) {
  const [drag, setDrag] = useState(false);
  const last = useRef(0);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = e.clientX;
    setDrag(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = e.clientX - last.current;
    last.current = e.clientX;
    if (dx) onDelta(dx);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-drag={drag ? "1" : "0"}
      className={`hw-split ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const d = keyDelta(e.key, e.shiftKey);
        if (d !== null) {
          e.preventDefault();
          onDelta(d);
        } else if (e.key === "Home") {
          e.preventDefault();
          onReset();
        } else if (e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
    />
  );
}

/** One pane: a slim header with the title and a collapse button. Its children stay mounted while collapsed so chat and run state survive. */
export function Pane({ id, title, side, collapsed, onToggle, children, bodyClass = "", tour, className = "" }: { className?: string; id: string; title: string; side: "left" | "right"; collapsed: boolean; onToggle: () => void; children: React.ReactNode; bodyClass?: string; tour?: string }) {
  return (
    <section aria-label={title} data-pane={id} data-tour={tour} className={`relative min-h-0 min-w-0 flex-col overflow-hidden bg-panel ${className}`}>
      {collapsed && (
        <button type="button" onClick={onToggle} aria-label={`Expand ${title}`} aria-expanded={false} className="absolute inset-0 z-10 flex flex-col items-center gap-3 bg-panel pt-3 text-ink-3 hover:text-ink">
          <IconChevron dir={side === "left" ? "right" : "left"} />
          <span className="hw-label !text-[10px] [writing-mode:vertical-rl]">{title}</span>
        </button>
      )}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3 max-lg:hidden">
        <h2 className="hw-label !text-[10.5px]">{title}</h2>
        <button type="button" onClick={onToggle} aria-label={`Collapse ${title}`} aria-expanded={!collapsed} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink">
          <IconChevron dir={side === "left" ? "left" : "right"} size={14} />
        </button>
      </div>
      <div className={`min-h-0 min-w-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export { LIMITS };
