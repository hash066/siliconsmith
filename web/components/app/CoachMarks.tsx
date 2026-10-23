"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { COACH_STEPS, holePath, placeCard, type CoachStep, type Rect } from "./coach";
import { btnGhost, btnPrimary } from "./ui";

function measure(step: CoachStep): Rect | null {
  const el = document.querySelector<HTMLElement>(`[data-coach="${step.target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

/** Three coach marks, one at a time: a ring around the thing and a small card. Next/Back, Skip, Esc; focus moves into the card. */
export function CoachMarks({ onClose, onStep }: { onClose: () => void; onStep?: (s: CoachStep) => void }) {
  const [i, setI] = useState(0);
  const step = COACH_STEPS[i];
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
  useLayoutEffect(() => {
    onStep?.(step);
    update();
    const a = setTimeout(update, 80);
    const b = setTimeout(update, 300);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [step, update, onStep]);
  useEffect(() => {
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);
  useLayoutEffect(() => {
    const c = card.current?.getBoundingClientRect();
    setPos(placeCard(rect, { w: c?.width ?? 300, h: c?.height ?? 170 }, vp.w, vp.h));
  }, [rect, vp, i]);
  useEffect(() => {
    card.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [i]);

  const last = i === COACH_STEPS.length - 1;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      const f = card.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!f?.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  return (
    <div className="hw-spot" onKeyDown={onKeyDown} data-testid="coach">
      <div className="absolute inset-0 bg-black/40" style={rect ? { clipPath: holePath(rect, vp.w, vp.h) } : undefined} aria-hidden="true" />
      {rect && <div className="pointer-events-none absolute rounded-xl ring-2 ring-[var(--wb)]" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} aria-hidden="true" />}
      <div ref={card} role="dialog" aria-label="Quick tip" aria-describedby="coach-body" className="hw-pop absolute w-[300px] max-w-[calc(100vw-24px)] rounded-2xl border border-line bg-panel p-4 shadow-[var(--hw-shadow)]" style={{ left: pos.x, top: pos.y }}>
        <div className="flex items-center justify-between">
          <span className="hw-label !text-[10.5px]" data-testid="coach-step">
            Tip {i + 1} of {COACH_STEPS.length}
          </span>
          <button type="button" onClick={onClose} className="rounded-md px-1.5 py-1 text-[12px] text-ink-3 hover:text-ink">
            Skip
          </button>
        </div>
        <h2 className="mt-1.5 text-[15px] font-semibold text-ink">{step.title}</h2>
        <p id="coach-body" className="mt-1 text-[13px] leading-snug text-ink-2">
          {step.body}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          {i > 0 && (
            <button type="button" onClick={() => setI((n) => n - 1)} className={`${btnGhost} !h-8`}>
              Back
            </button>
          )}
          <button type="button" data-autofocus onClick={() => (last ? onClose() : setI((n) => n + 1))} className={`${btnPrimary} !h-8`}>
            {last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
