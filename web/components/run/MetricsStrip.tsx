"use client";

import { int, mhz, pct, times } from "@/lib/format";
import { useTicking } from "@/lib/hooks";
import { counts, wallOf, type RunState } from "@/lib/run-state";

function Cell({ label, children, sub, lead = false }: { label: string; children: React.ReactNode; sub?: React.ReactNode; lead?: boolean }) {
  return (
    <div className={`min-w-0 px-4 py-3 max-sm:last:col-span-2 ${lead ? "col-span-2 sm:col-span-1" : ""}`}>
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={`num mt-1 truncate leading-none tracking-[-0.02em] ${lead ? "text-[30px]" : "text-[20px] sm:text-[22px]"}`}>{children}</div>
      {sub && <div className="num mt-1.5 truncate text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function MetricsStrip({ state }: { state: RunState }) {
  const best = state.best ? state.nodes[state.best] : null;
  const sc = best?.score ?? null;
  const wall = useTicking(sc ? wallOf(sc) : null);
  const area = useTicking(sc ? sc.area_delta_pct : null);
  const cycles = useTicking(sc ? sc.cycles : null);
  const active = useTicking(state.sandboxes.active, 300);
  const c = counts(state);
  const budget = state.config?.area_budget_pct;
  const baseCycles = state.baseline?.cycles;
  const fmax = sc ? sc.fmax_mhz : (state.baseline?.fmax_mhz ?? null);

  return (
    <div className="grid grid-cols-2 divide-line rounded-lg border border-line bg-panel sm:grid-cols-3 lg:grid-cols-6 lg:divide-x [&>*]:border-line max-lg:[&>*]:border-b sm:max-lg:[&>*:nth-child(3n)]:border-r-0 max-sm:[&>*:nth-child(odd)]:border-r sm:max-lg:[&>*]:border-r">
      <Cell label="Best wall-clock speedup" lead sub={best ? `${best.id} · ${best.proposal?.mnemonic}` : state.status === "completed" ? "No candidate beat the baseline" : "Searching…"}>
        <span style={{ color: sc ? "var(--signal-ink)" : "var(--ink-3)" }}>{wall === null ? "—" : times(wall)}</span>
      </Cell>
      <Cell label="Area Δ" sub={budget !== undefined ? `budget ${budget.toFixed(1)}% LUT-eq` : undefined}>
        <span className="text-ink">{area === null ? "—" : pct(area)}</span>
      </Cell>
      <Cell label="Cycles" sub={baseCycles ? `baseline ${int(baseCycles)}` : undefined}>
        <span className="text-ink">{cycles === null ? (baseCycles ? int(baseCycles) : "—") : int(cycles)}</span>
      </Cell>
      <Cell label="Fmax" sub={fmax === null ? "not measured" : "MHz, est."}>
        <span className="text-ink">{mhz(fmax)}</span>
      </Cell>
      <Cell label="Sandboxes active" sub={`peak ${state.sandboxes.peak}${state.config ? ` of ${state.config.max_concurrency}` : ""}`}>
        <span className="text-ink">{int(active ?? 0)}</span>
      </Cell>
      <Cell label="Candidates" sub={c.running ? `${c.running} running · ${c.budget + c.nogain + c.failed} pruned` : `${c.feasible} verified · ${c.budget + c.nogain + c.failed} pruned`}>
        <span className="text-ink">{c.candidates}</span>
      </Cell>
    </div>
  );
}
