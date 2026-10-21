"use client";

import { MODELS, ROLES, type Model } from "@/lib/events";
import { int, tokens, usd } from "@/lib/format";
import { useTicking } from "@/lib/hooks";
import type { RunState } from "@/lib/run-state";
import { Trace } from "../charts/Trace";

const MODEL_NAME: Record<Model, string> = {
  "nemotron-ultra": "Nemotron Ultra",
  "nemotron-super": "Nemotron Super",
  "nemotron-nano": "Nemotron Nano",
};
const MODEL_JOB: Record<Model, string> = {
  "nemotron-ultra": "Architect, diagnosis, report",
  "nemotron-super": "RTL, C reference, patch, repairs",
  "nemotron-nano": "Profile brief, failure triage",
};
// Token Factory list prices used for the estimate (USD per million tokens, in / out). PLAN §8.
export const PRICE: Record<Model, [number, number]> = {
  "nemotron-ultra": [1, 3],
  "nemotron-super": [0.3, 0.9],
  "nemotron-nano": [0.06, 0.24],
};

export function CostPanel({ state, t, duration }: { state: RunState; t: number; duration: number }) {
  const total = state.usage.total;
  const cost = useTicking(total.costUsd);
  const maxCost = Math.max(...MODELS.map((m) => state.usage.byModel[m].costUsd), 1e-9);
  const sb = state.sandboxes;
  const cap = state.config?.max_concurrency;
  const active = useTicking(sb.active, 300);
  const roles = ROLES.map((r) => ({ r, u: state.usage.byRole[r] })).filter((x) => x.u && x.u.calls > 0);

  return (
    <div className="divide-y divide-line">
      <section className="px-4 py-4" aria-labelledby="cost-h">
        <h2 id="cost-h" className="text-[13px] font-medium text-ink-2">
          Nemotron on Token Factory
        </h2>
        <p className="num mt-2 text-[30px] leading-none tracking-[-0.02em] text-ink">{usd(cost ?? 0, 3)}</p>
        <p className="num mt-1.5 text-[12px] text-ink-3">
          {int(total.calls)} calls · {tokens(total.tokensIn)} in · {tokens(total.tokensOut)} out
        </p>
        <ul className="mt-4 space-y-3.5">
          {MODELS.map((m) => {
            const u = state.usage.byModel[m];
            return (
              <li key={m}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-ink">{MODEL_NAME[m]}</span>
                  <span className="num text-[13px] text-ink">{usd(u.costUsd, 3)}</span>
                </div>
                <div className="mt-1 h-[3px] rounded-full bg-raised">
                  <div className="h-[3px] rounded-full bg-signal transition-[width] duration-500" style={{ width: `${(u.costUsd / maxCost) * 100}%` }} />
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2 text-[11.5px] text-ink-3">
                  <span className="truncate">{MODEL_JOB[m]}</span>
                  <span className="num shrink-0">
                    {u.calls} · {tokens(u.tokensIn + u.tokensOut)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {roles.length > 0 && (
          <details className="group mt-4">
            <summary className="flex h-8 cursor-pointer list-none items-center justify-between text-[12px] text-ink-3 hover:text-ink">
              By role <span className="transition-transform duration-150 group-open:rotate-90" aria-hidden="true">›</span>
            </summary>
            <table className="mt-1 w-full text-[12px]">
              <tbody>
                {roles.map(({ r, u }) => (
                  <tr key={r} className="border-t border-line/70">
                    <td className="py-1.5 text-ink-2">{r}</td>
                    <td className="num py-1.5 text-right text-ink-3">{u.calls}</td>
                    <td className="num py-1.5 text-right text-ink-3">{tokens(u.tokensIn + u.tokensOut)}</td>
                    <td className="num py-1.5 text-right text-ink">{usd(u.costUsd, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              Priced per million tokens in / out: Ultra $1.00 / $3.00, Super $0.30 / $0.90, Nano $0.06 / $0.24.
            </p>
          </details>
        )}
      </section>

      <section className="px-4 py-4" aria-labelledby="sb-h">
        <h2 id="sb-h" className="text-[13px] font-medium text-ink-2">
          Token Factory Sandboxes
        </h2>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="num text-[30px] leading-none tracking-[-0.02em] text-ink">{int(active ?? 0)}</span>
          <span className="text-[12px] text-ink-3">active{cap ? ` of ${cap}` : ""}</span>
        </div>
        <p className="num mt-1.5 text-[12px] text-ink-3">
          peak {sb.peak} · {int(sb.total)} ops · {sb.failed} failed
        </p>
        <div className="mt-3">
          <Trace series={sb.series} duration={duration} cursor={t} reference={cap} referenceLabel={cap ? `cap ${cap}` : undefined} label="Active sandboxes over run time" />
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
          Each candidate forks from its parent&apos;s checkpoint image; unit vectors and proofs fan out across branches.
          {state.backend ? ` Backend: ${state.backend}.` : ""}
        </p>
      </section>
    </div>
  );
}
