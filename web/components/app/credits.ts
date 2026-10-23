// Credit balance view-model. The agent session's credits hook is not merged yet, so this adapter reads whatever `/api/agent` reports
// and degrades honestly: no figure is invented, an unknown value is shown as unknown.

export interface CreditsView {
  /** "ready": real dollar figures reported by the server. "limits": only the older per-day turn limits are known. "offline": not connected. */
  mode: "ready" | "limits" | "offline" | "loading";
  allowanceUsd: number | null;
  spentUsd: number | null;
  remainingUsd: number | null;
  poolCapUsd: number | null;
  poolSpentUsd: number | null;
  poolExhausted: boolean;
  turnsPerDay: number | null;
  scope: string | null;
}

export const NO_CREDITS: CreditsView = { mode: "offline", allowanceUsd: null, spentUsd: null, remainingUsd: null, poolCapUsd: null, poolSpentUsd: null, poolExhausted: false, turnsPerDay: null, scope: null };
export const LOADING_CREDITS: CreditsView = { ...NO_CREDITS, mode: "loading" };

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Accepts the agent status payload: `{connected, credits?: {allowance_usd, spent_usd, pool_cap_usd, pool_spent_usd}, limits?}`. */
export function parseCredits(status: unknown): CreditsView {
  const s = status as { connected?: boolean; credits?: Record<string, unknown>; limits?: Record<string, unknown> } | null;
  if (!s || s.connected !== true) return NO_CREDITS;
  const c = s.credits;
  if (c) {
    const allowance = n(c.allowance_usd);
    const spent = n(c.spent_usd);
    const cap = n(c.pool_cap_usd);
    const poolSpent = n(c.pool_spent_usd);
    if (allowance !== null && spent !== null) {
      return {
        mode: "ready",
        allowanceUsd: allowance,
        spentUsd: spent,
        remainingUsd: Math.max(0, allowance - spent),
        poolCapUsd: cap,
        poolSpentUsd: poolSpent,
        poolExhausted: cap !== null && poolSpent !== null && poolSpent >= cap,
        turnsPerDay: null,
        scope: typeof c.scope === "string" ? c.scope : null,
      };
    }
  }
  const l = s.limits;
  return { ...NO_CREDITS, mode: "limits", turnsPerDay: n(l?.visitorTurnsPerDay), scope: typeof l?.scope === "string" ? l.scope : null };
}

export const usd2 = (v: number) => `$${v.toFixed(v < 0.1 ? 3 : 2)}`;

/** The pill text. Always labelled as demo credits. */
export function pillText(c: CreditsView, short = false): string {
  if (short) {
    if (c.mode === "ready" && c.remainingUsd !== null) return usd2(c.remainingUsd);
    return c.mode === "loading" ? "…" : c.mode === "limits" ? "Credits" : "Offline";
  }
  if (c.mode === "loading") return "Credits …";
  if (c.mode === "ready" && c.remainingUsd !== null) return `${usd2(c.remainingUsd)} demo credits`;
  if (c.mode === "limits") return c.turnsPerDay !== null ? `${c.turnsPerDay} turns/day` : "Demo credits";
  return "Credits: offline";
}
