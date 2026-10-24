"use client";

import { MATTER_GENERATORS, MATTER_SPREADER, defaultSimulateInput, type MatterGenerator } from "@/lib/hosted";
import type { MatterBench } from "./useMatterBench";
import { Block, btnPrimary, ScopeRow } from "./ui";

export function MatterScope() {
  return (
    <ScopeRow summary="2D steady-state model; not airflow CFD; not validated on a printed part">
      <ul className="list-disc space-y-1 pl-4">
        <li>2D steady-state conduction with the convection h and conductivity k you set; one built-in generator goes through the validated solver and an independent second solver.</li>
        <li>No airflow CFD, and not validated on a printed part.</li>
        <li>Margins over the plain rectangular-fin baselines are small, and the result says so. No model is involved in a simulation.</li>
      </ul>
    </ScopeRow>
  );
}

function ParamRow({ id, label, unit, min, max, step, value, error, onChange }: { id: string; label: string; unit: string; min: number; max: number; step: number; value: number; error?: string; onChange: (v: number) => void }) {
  const ok = Number.isFinite(value);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="truncate text-[12.5px] text-ink-2">
          {label}
        </label>
        <span className="num shrink-0 text-[10.5px] text-ink-3">
          {min}–{max}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2.5">
        <input
          type="range"
          aria-label={`${label} slider`}
          min={min}
          max={max}
          step={step}
          value={ok ? Math.min(max, Math.max(min, value)) : min}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-6 min-w-0 flex-1 accent-[var(--wb)]"
          tabIndex={-1}
        />
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={ok ? value : ""}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          className={`num h-8 w-[76px] shrink-0 rounded-md border bg-sunken px-2 text-right text-[12.5px] text-ink ${error ? "border-red" : "border-line-2"}`}
        />
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-0.5 text-[11.5px] leading-snug text-red">
          {error}
        </p>
      )}
    </div>
  );
}

export function MatterInputs({ b }: { b: MatterBench }) {
  const { input, setInput, errors } = b;
  const gen = MATTER_GENERATORS[input.generator];
  return (
    <form
      className="flex min-h-full flex-col gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void b.simulate();
      }}
    >
      <Block title="Brief: the problem" data-step="brief" tabIndex={-1}>
        <div className="flex flex-col gap-3 p-3">
          {MATTER_SPREADER.map((p) => (
            <ParamRow key={p.key} id={`sp-${p.key}`} label={p.label} unit={p.unit} min={p.min} max={p.max} step={p.step} value={input.spreader[p.key]} error={errors[`spreader.${p.key}`]} onChange={(v) => setInput((i) => ({ ...i, spreader: { ...i.spreader, [p.key]: v } }))} />
          ))}
        </div>
      </Block>
      <Block title="Propose: the geometry" data-step="propose" tabIndex={-1}>
        <div className="flex flex-col gap-3 p-3">
          <div>
            <label htmlFor="mat-gen" className="text-[12.5px] text-ink-2">
              Generator
            </label>
            <select
              id="mat-gen"
              value={input.generator}
              onChange={(e) => {
                const g = e.target.value as MatterGenerator;
                setInput((i) => ({ ...defaultSimulateInput(g), spreader: i.spreader, include_stl: i.include_stl }));
              }}
              className="mt-1 h-9 w-full rounded-md border border-line-2 bg-sunken px-2.5 text-[13px] text-ink"
            >
              {(Object.keys(MATTER_GENERATORS) as MatterGenerator[]).map((g) => (
                <option key={g} value={g}>
                  {MATTER_GENERATORS[g].label}
                </option>
              ))}
            </select>
          </div>
          {gen.params.map((p) => (
            <ParamRow key={p.key} id={`gp-${p.key}`} label={p.label} unit={p.unit} min={p.min} max={p.max} step={p.step} value={input.gen_params[p.key]} error={errors[`gen_params.${p.key}`]} onChange={(v) => setInput((i) => ({ ...i, gen_params: { ...i.gen_params, [p.key]: v } }))} />
          ))}
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={!!input.include_stl} onChange={(e) => setInput((i) => ({ ...i, include_stl: e.target.checked }))} className="accent-[var(--wb)]" />
            Include the printable STL
          </label>
        </div>
      </Block>
      {Object.keys(errors).some((k) => !k.startsWith("gen_params.") && !k.startsWith("spreader.")) && <p className="text-[12px] text-red">{Object.entries(errors).filter(([k]) => !k.startsWith("gen_params.") && !k.startsWith("spreader.")).map(([k, m]) => `${k}: ${m}`).join("; ")}</p>}
      <div className="sticky bottom-0 -mx-3 mt-auto flex items-center gap-3 border-t border-line bg-panel px-3 py-2.5">
        <button type="submit" disabled={b.busy} className={btnPrimary} data-testid="matter-simulate">
          {b.busy ? "Solving…" : "Simulate"}
        </button>
        <span className="text-[12px] text-ink-3">Free · about a second</span>
      </div>
      <MatterScope />
    </form>
  );
}

