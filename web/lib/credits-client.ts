"use client";

// The credit balance for the app's top bar and the Agent panel. `useCredits()` reads GET /api/credits and refreshes whenever an agent
// turn finishes (the transport dispatches CREDITS_CHANGED), so every pill on the page stays in step.

import { useCallback, useEffect, useState } from "react";
import type { CreditsSnapshot } from "./credits";

export const CREDITS_CHANGED = "hw:credits-changed";
/** Below this the cheapest turn cannot start (a Nano turn's worst case is about $0.0006, a Super turn about $0.0035): treated as used up. */
export const MIN_TURN_USD = 0.001;

export type { CreditsSnapshot };

export async function fetchCredits(signal?: AbortSignal): Promise<CreditsSnapshot | null> {
  try {
    const res = await fetch("/api/credits", { cache: "no-store", signal });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<CreditsSnapshot>;
    return typeof j.allowanceUsd === "number" && typeof j.remainingUsd === "number" && j.pool ? (j as CreditsSnapshot) : null;
  } catch {
    return null;
  }
}

/** Formats demo credits for a pill: "$0.48". */
export const formatUsd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

export interface UseCredits {
  credits: CreditsSnapshot | null;
  loading: boolean;
  /** True when the server could not tell (store down or no connection). */
  unavailable: boolean;
  /** Remaining is zero: the agent is paused; free tools and replays still work. */
  exhausted: boolean;
  refresh: () => void;
}

export function useCredits(): UseCredits {
  const [credits, setCredits] = useState<CreditsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    void fetchCredits(ctl.signal).then((c) => {
      if (ctl.signal.aborted) return;
      setCredits(c);
      setLoading(false);
    });
    return () => ctl.abort();
  }, [tick]);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(CREDITS_CHANGED, on);
    return () => window.removeEventListener(CREDITS_CHANGED, on);
  }, []);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { credits, loading, unavailable: !loading && credits === null, exhausted: !!credits && credits.remainingUsd < MIN_TURN_USD, refresh };
}
