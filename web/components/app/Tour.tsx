"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { holePath, placeCard, TOUR_STEPS, type Rect, type TourStep } from "./tour-steps";
import { btnGhost, btnPrimary } from "./ui";

function measure(step: TourStep): Rect | null {
  if (!step.target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Modal tour: dimmed and blurred backdrop with a hole over the element being explained, a focus-trapped card, keyboard operable, Esc closes. */
export function Tour({ onClose, onStep }: { onClose: () => void; onStep?: (s: TourStep) => void }) {
  const [i, setI] = useState(0);
  const step = TOUR_STEPS[i];
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: 1024, h: 768 });
  const [pos, setPos] = useState({ x: 12, y: 12 });
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus();
    };
  }, []);

  const update = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    setRect(measure(step));
  }, [step]);

  // Let the app switch panes first (narrow screens show one pane at a time), then measure; measure again once layout settles.
  useLayoutEffect(() => {
    onStep?.(step);
    update();
    const t1 = setTimeout(update, 60);
    const t2 = setTimeout(update, 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [step, update, onStep]);
  useEffect(() => {
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [update]);
  useLayoutEffect(() => {
    const c = card.current?.getBoundingClientRect();
    setPos(placeCard(rect, { w: c?.width ?? 340, h: c?.height ?? 220 }, vp.w, vp.h));
  }, [rect, vp, i]);
  useEffect(() => {
    card.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [i]);

  const last = i === TOUR_STEPS.length - 1;
  const next = () => (last ? onClose() : setI((n) => n + 1));
  const back = () => setI((n) => Math.max(0, n - 1));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    } else if (e.key === "Tab") {
      const f = card.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!f || !f.length) return;
      const first = f[0];
      const lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="hw-spot" onKeyDown={onKeyDown} data-testid="tour">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[5px]" style={rect ? { clipPath: holePath(rect, vp.w, vp.h) } : undefined} aria-hidden="true" onClick={() => undefined} />
      {rect && <div className="pointer-events-none absolute rounded-xl ring-2 ring-[var(--wb)]" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} aria-hidden="true" />}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="hw-pop absolute w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-line bg-panel p-4 shadow-[var(--hw-shadow)]"
        style={{ left: pos.x, top: pos.y }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="hw-label !text-[10.5px]" data-testid="tour-step">Step {i + 1} of {TOUR_STEPS.length}</span>
          <button type="button" onClick={onClose} className="rounded-md px-1.5 py-1 text-[12px] text-ink-3 hover:text-ink">
            Skip tour
          </button>
        </div>
        <h2 id="tour-title" className="mt-2 text-[17px] font-semibold leading-tight text-ink">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-[13.5px] leading-snug text-ink-2">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <ol className="flex items-center gap-1.5" aria-hidden="true">
            {TOUR_STEPS.map((s, k) => (
              <li key={s.id} className="h-1.5 rounded-full transition-all duration-200" style={{ width: k === i ? 18 : 6, background: k === i ? "var(--wb)" : k < i ? "var(--hw-ink-3)" : "var(--hw-border)" }} />
            ))}
          </ol>
          <div className="flex gap-2">
            {i > 0 && (
              <button type="button" onClick={back} className={btnGhost}>
                Back
              </button>
            )}
            <button type="button" onClick={next} className={btnPrimary} data-autofocus>
              {last ? "Start building" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
