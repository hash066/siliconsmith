// Credit balance view-model for the top-bar pill, derived from the agent session's credits hook (`@/lib/credits-client`).

export interface CreditsView {
  /** "ready": real dollar figures from the server. "offline": the server could not tell. "loading": not asked yet. */
  mode: "ready" | "offline" | "loading";
  allowanceUsd: number | null;
  spentUsd: number | null;
  remainingUsd: number | null;
  poolCapUsd: number | null;
  poolSpentUsd: number | null;
  poolExhausted: boolean;
  /** Where the counters live, as the server states it (for example "per server instance, in memory"). */
  scope: string | null;
}

export const NO_CREDITS: CreditsView = { mode: "offline", allowanceUsd: null, spentUsd: null, remainingUsd: null, poolCapUsd: null, poolSpentUsd: null, poolExhausted: false, scope: null };
export const LOADING_CREDITS: CreditsView = { ...NO_CREDITS, mode: "loading" };

/** Shape of `useCredits()` from `@/lib/credits-client`, restated so this module stays pure. */
export interface CreditsInput {
  credits: { allowanceUsd: number; spentUsd: number; remainingUsd: number; pool: { capUsd: number; spentUsd: number }; scope: string } | null;
  loading: boolean;
}

/** Turn the agent session's credits state into what the pill shows. Nothing is invented: no snapshot means offline. */
export function viewCredits({ credits: c, loading }: CreditsInput): CreditsView {
  if (!c) return loading ? LOADING_CREDITS : NO_CREDITS;
  return {
    mode: "ready",
    allowanceUsd: c.allowanceUsd,
    spentUsd: c.spentUsd,
    remainingUsd: c.remainingUsd,
    poolCapUsd: c.pool.capUsd,
    poolSpentUsd: c.pool.spentUsd,
    poolExhausted: c.pool.spentUsd >= c.pool.capUsd,
    scope: c.scope,
  };
}

export const usd2 = (v: number) => `$${v.toFixed(v < 1 ? 3 : 2)}`;

/** The pill text. Always labelled as demo credits. */
export function pillText(c: CreditsView, short = false): string {
  if (short) {
    if (c.mode === "ready" && c.remainingUsd !== null) return usd2(c.remainingUsd);
    return c.mode === "loading" ? "…" : "Offline";
  }
  if (c.mode === "loading") return "Credits …";
  if (c.mode === "ready" && c.remainingUsd !== null) return `${usd2(c.remainingUsd)} demo credits`;
  return "Credits: offline";
}
