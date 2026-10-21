"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ENGINE_URL, isSafeRunId, LiveController, ReplayController, type ReplayOptions, type RunController, type Snapshot } from "./controller";

export type SourceState =
  | { status: "loading" }
  | { status: "ready"; controller: RunController }
  | { status: "not-found"; reason: string };

/** Replay file first (public/replays/<id>.ndjson); otherwise a live run from the engine, if configured. */
export function useRunSource(runId: string, opts: ReplayOptions = {}): SourceState {
  const [src, setSrc] = useState<SourceState>({ status: "loading" });
  const optsKey = JSON.stringify(opts);
  useEffect(() => {
    let cancelled = false;
    let controller: RunController | null = null;
    if (!isSafeRunId(runId)) {
      setSrc({ status: "not-found", reason: "That run id is not valid." });
      return;
    }
    setSrc({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(`/replays/${runId}.ndjson`, { cache: "no-store" });
        if (res.ok) {
          const text = await res.text();
          if (cancelled) return;
          controller = ReplayController.fromText(text, JSON.parse(optsKey) as ReplayOptions);
          setSrc({ status: "ready", controller });
          return;
        }
      } catch {
        // fall through to live
      }
      if (cancelled) return;
      if (ENGINE_URL) {
        controller = new LiveController(`${ENGINE_URL}/api/runs/${runId}/events`);
        setSrc({ status: "ready", controller });
      } else {
        setSrc({ status: "not-found", reason: "No recorded replay with this id, and this build is not connected to a live engine." });
      }
    })();
    return () => {
      cancelled = true;
      controller?.destroy();
    };
  }, [runId, optsKey]);
  return src;
}

const NOOP_SUB = () => () => {};

export function useSnapshot(controller: RunController | null): Snapshot | null {
  return useSyncExternalStore(
    controller ? (l) => controller.subscribe(l) : NOOP_SUB,
    () => (controller ? controller.getSnapshot() : null),
    () => (controller ? controller.getSnapshot() : null),
  );
}

export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** A number that ticks toward its target (an instrument readout). Instant under reduced motion. */
export function useTicking(target: number | null | undefined, ms = 520): number | null {
  const reduce = usePrefersReducedMotion();
  const [value, setValue] = useState<number | null>(target ?? null);
  const from = useRef<number | null>(target ?? null);
  const raf = useRef(0);
  useEffect(() => {
    if (target === null || target === undefined || !Number.isFinite(target)) {
      setValue(target ?? null);
      from.current = target ?? null;
      return;
    }
    const start = from.current;
    if (reduce || start === null || start === target) {
      setValue(target);
      from.current = target;
      return;
    }
    const t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (target - start) * eased;
      setValue(v);
      from.current = v;
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms, reduce]);
  return value;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatch(mq.matches);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
