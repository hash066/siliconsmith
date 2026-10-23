"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** True when the visitor asked for reduced motion. Updates live. */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const f = () => setR(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return r;
}

/**
 * Wraps the page: marks the root as JS-enabled (so .mk-reveal hides only when it can be revealed again),
 * mirrors prefers-reduced-motion as a class, and reveals every .mk-reveal as it enters the viewport.
 */
export function Runtime({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.classList.toggle("mk-reduce", reduce);
    root.classList.add("mk-js");
    const els = [...root.querySelectorAll<HTMLElement>(".mk-reveal")];
    if (reduce || typeof IntersectionObserver === "undefined") {
      els.forEach((e) => e.classList.add("mk-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries)
          if (en.isIntersecting) {
            en.target.classList.add("mk-in");
            io.unobserve(en.target);
          }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [reduce]);
  return (
    <div ref={ref} className="mk" data-mk>
      {children}
    </div>
  );
}

/** Counts up from 0 to `to` the first time it scrolls into view. Server render and reduced motion show the final value. */
export function Counter({ to, decimals = 0, prefix = "", suffix = "", duration = 1400 }: { to: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const [v, setV] = useState(to);
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || typeof IntersectionObserver === "undefined") {
      setV(to);
      return;
    }
    setV(0);
    let raf = 0;
    const io = new IntersectionObserver(
      ([en]) => {
        if (!en.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const k = Math.min(1, (t - t0) / duration);
          setV(to * (1 - Math.pow(1 - k, 3)));
          if (k < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, reduce, duration]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Marks an element when it is in view (for the stack spine progress etc). */
export function useInView<T extends HTMLElement>(threshold = 0.3): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([en]) => en.isIntersecting && setSeen(true), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
}
