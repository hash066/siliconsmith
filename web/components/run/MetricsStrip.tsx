"use client";

import { int, mhz, pct, times } from "@/lib/format";
import { useTicking } from "@/lib/hooks";
import type { EvidenceMetric } from "@/lib/evidence";
import { counts, wallOf, type RunState } from "@/lib/run-state";
import { EvidenceChip } from "../evidence/EvidenceChip";

function Cell({ label, children, sub, lead = false, chip, fixed = false }: { label: string; children: React.ReactNode; sub?: React.ReactNode; lead?: boolean; chip?: React.ReactNode; fixed?: boolean }) {
  return (
    <div className={`min-w-0 px-4 py-3 ${fixed ? "bg-panel" : `max-sm:last:col-span-2 ${lead ? "col-span-2 sm:col-span-1" : ""}`}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[12px] text-ink-3">{label}</div>
        {chip}
      </div>
      <div className={`num mt-1 truncate leading-none tracking-[-0.02em] ${lead ? "text-[30px]" : "text-[20px] sm:text-[22px]"}`}>{children}</div>
      {sub && <div className="num mt-1.5 truncate text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** `cols` fixes the column count (the workstation canvas sizes it from its own width); without it the strip follows the viewport. */
export function MetricsStrip({ state, onEvidence, cols }: { state: RunState; onEvidence?: (metric: EvidenceMetric) => void; cols?: 2 | 3 | 6 }) {
  const best = state.best ? state.nodes[state.best] : null;
  const sc = best?.score ?? null;
  const wall = useTicking(sc ? wallOf(sc) : null);
  const area = useTicking(sc ? sc.area_delta_pct : null);
  const cycles = useTicking(sc ? sc.cycles : null);
  const active = useTicking(state.sandboxes.active, 300);
  const c = counts(state);
  const budget = state.config?.area_budget_pct;
  const baseCycles = state.baseline?.cycles;
  const chip = (metric: EvidenceMetric, label: string, show = true) => (onEvidence && sc && show ? <EvidenceChip metric={metric} label={label} onOpen={onEvidence} /> : undefined);
  const fmax = sc ? sc.fmax_mhz : (state.baseline?.fmax_mhz ?? null);

  const cells = (
    <>
      <Cell fixed={cols !== undefined} label="Best wall-clock speedup" lead chip={chip("wall_speedup", "best wall-clock speedup")} sub={best ? `${best.id} · ${best.proposal?.mnemonic}` : state.status === "completed" ? "No candidate beat the baseline" : "Searching…"}>
        <span style={{ color: sc ? "var(--signal-ink)" : "var(--ink-3)" }}>{wall === null ? "—" : times(wall)}</span>
      </Cell>
      <Cell fixed={cols !== undefined} label="Area Δ" chip={chip("area", "area change")} sub={budget !== undefined ? `budget ${budget.toFixed(1)}% LUT-eq` : undefined}>
        <span className="text-ink">{area === null ? "—" : pct(area)}</span>
      </Cell>
      <Cell fixed={cols !== undefined} label="Cycles" chip={chip("cycles", "cycles")} sub={baseCycles ? `baseline ${int(baseCycles)}` : undefined}>
        <span className="text-ink">{cycles === null ? (baseCycles ? int(baseCycles) : "—") : int(cycles)}</span>
      </Cell>
      <Cell fixed={cols !== undefined} label="Fmax" chip={chip("fmax", "Fmax", fmax !== null)} sub={fmax === null ? "not measured" : "MHz, est."}>
        <span className="text-ink">{mhz(fmax)}</span>
      </Cell>
      <Cell fixed={cols !== undefined} label="Sandboxes active" sub={`peak ${state.sandboxes.peak}${state.config ? ` of ${state.config.max_concurrency}` : ""}`}>
        <span className="text-ink">{int(active ?? 0)}</span>
      </Cell>
      <Cell fixed={cols !== undefined} label="Candidates" sub={c.running ? `${c.running} running · ${c.budget + c.nogain + c.failed} pruned` : `${c.feasible} verified · ${c.budget + c.nogain + c.failed} pruned`}>
        <span className="text-ink">{c.candidates}</span>
      </Cell>
    </>
  );

  if (cols === undefined)
    return (
      <div className="grid grid-cols-2 divide-line rounded-lg border border-line bg-panel sm:grid-cols-3 lg:grid-cols-6 lg:divide-x [&>*]:border-line max-lg:[&>*]:border-b sm:max-lg:[&>*:nth-child(3n)]:border-r-0 max-sm:[&>*:nth-child(odd)]:border-r sm:max-lg:[&>*]:border-r">
        {cells}
      </div>
    );
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {cells}
    </div>
  );
}
