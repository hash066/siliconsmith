"use client";

import { useMemo } from "react";
import { MATTER_GENERATORS, MATTER_SPREADER, defaultSimulateInput, type MatterGenerator, type MatterSimulation } from "@/lib/hosted";
import { matterRungEvidence } from "@/lib/evidence";
import { buildPlate, heatColor, heatGradientCss } from "@/lib/plate";
import { ApiErrorView } from "../domain/ApiErrorView";
import { CellGlyph } from "../domain/RungMatrix";
import { MeshCanvas } from "../domain/StlViewer";
import { EvidenceTag } from "../evidence/EvidenceChip";
import type { DrawerRef } from "../domain/BoardCheckPanel";
import { wasSolved, type MatterBench } from "./useMatterBench";
import { Block, btnPrimary, ScopeRow } from "./ui";

const f1 = (n: number, d = 1) => n.toFixed(d);

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

function PlateViewer({ sim }: { sim: MatterSimulation }) {
  const plate = useMemo(() => buildPlate(sim.viewer), [sim]);
  const lo = plate.tMin;
  const hi = sim.viewer.field.peak;
  const byTri = useMemo(() => {
    const span = Math.max(hi - lo, 1e-9);
    return (tri: number) => heatColor((plate.temps[Math.floor(tri / 2)] - lo) / span);
  }, [plate, lo, hi]);
  return (
    <div>
      <MeshCanvas
        mesh={plate.mesh}
        colorOf={byTri}
        zScale={6}
        label={`Plate drawn from the simulation: ${plate.cells} material cells coloured by the solver's temperature from ${f1(lo)} to ${f1(hi)} degrees C, coolest cell to peak. Drag to rotate.`}
        footer={<span className="num ml-auto">{plate.cells.toLocaleString("en-US")} cells · z exaggerated 6×</span>}
      />
      <div className="mt-2" aria-label="Temperature scale">
        <div className="h-2 rounded-full" style={{ background: heatGradientCss() }} />
        <div className="num mt-1 flex justify-between text-[11px] text-ink-3">
          <span>{f1(lo)} °C coolest cell</span>
          <span>{f1(hi)} °C peak</span>
        </div>
      </div>
    </div>
  );
}

export function MatterCanvasView({ b, onEvidence }: { b: MatterBench; onEvidence: (r: DrawerRef) => void }) {
  const { sim, busy, failure, stale } = b;
  if (failure && failure.kind !== "field" && !sim) return <div className="p-4"><ApiErrorView failure={failure} onRetry={() => void b.simulate()} /></div>;
  if (busy && !sim)
    return (
      <div className="grid min-h-[320px] place-items-center p-4" role="status">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto h-40 w-full max-w-xs animate-pulse rounded-xl bg-raised" />
          <p className="mt-3 text-[13px] text-ink-3">Solving the plate and checking it with a second solver…</p>
        </div>
      </div>
    );
  if (!sim)
    return (
      <div className="grid min-h-[320px] place-items-center p-6" role="status">
        <div className="max-w-sm text-center">
          <h3 className="text-[16px] font-semibold text-ink">No simulation yet</h3>
          <p className="mt-1.5 text-[13px] leading-snug text-ink-3">Set the problem and geometry on the left, then press Simulate. You get the plate coloured by the solver, rungs M1 to M5 and both baselines. Nothing is shown until the solver has run.</p>
          <button type="button" onClick={() => void b.simulate()} disabled={busy || !b.valid} className={`${btnPrimary} mt-4`}>
            Simulate now
          </button>
          {!b.valid && <p className="mt-2 text-[12px] text-red">A parameter is out of range.</p>}
        </div>
      </div>
    );
  const passN = sim.ladder.filter((r) => r.status === "pass").length;
  const solved = wasSolved(sim);
  const tag = (rung: string, label: string) => <EvidenceTag label={label} onClick={() => { const e = matterRungEvidence(sim, rung); if (e) onEvidence(e); }} />;
  return (
    <div className="@container flex min-w-0 flex-col gap-3 p-3" aria-live="polite" aria-busy={busy}>
      {(stale || busy || failure) && (
        <p className="rounded-md bg-amber-dim px-3 py-2 text-[12.5px] text-ink" role="status">
          {busy ? "Solving again…" : failure ? `The last run failed: ${failure.message}` : "The parameters changed after this result. Press Simulate to refresh it."}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] [&>*]:min-w-0">
        {solved ? <Block title="Plate" aside={<span className="num text-[11.5px] text-ink-3">{sim.generator} · {sim.timings_ms} ms</span>} data-step="verify" tabIndex={-1}>
          <div className="p-3">
            <PlateViewer sim={sim} />
          </div>
        </Block> : <Block title="Plate"><p className="px-4 py-8 text-center text-[13px] leading-snug text-ink-2" role="status">Nothing was solved: {sim.first_failure ?? "a rung"} rejected this geometry, so there is no temperature field to draw. The rungs show why.</p></Block>}
        <div className="flex min-w-0 flex-col gap-3">
          {solved && <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-[13px] [&>div]:bg-panel [&>div]:px-3 [&>div]:py-2">
            <div>
              <dt className="flex items-center justify-between gap-1 text-[11.5px] text-ink-3">Peak {tag("M4", "peak temperature")}</dt>
              <dd className="num text-[18px] text-ink">{f1(sim.metrics.peak_temp_c)} °C</dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-ink-3">Rise over ambient</dt>
              <dd className="num text-[18px] text-ink">{f1(sim.metrics.peak_rise_k)} K</dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-ink-3">Material</dt>
              <dd className="num text-[18px] text-ink">{f1(sim.metrics.material_fraction * 100)}%</dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-ink-3">Heat balance error</dt>
              <dd className="num text-[18px] text-ink">{sim.metrics.heat_balance_rel.toExponential(1)}</dd>
            </div>
          </dl>}
          <Block title="Ladder M1–M5" aside={<span className="num text-[11.5px] text-ink-3">{passN} of {sim.ladder.length} pass</span>}>
            <ul className="divide-y divide-line">
              {sim.ladder.map((r) => (
                <li key={r.id} className="min-w-0 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <CellGlyph status={r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : "unknown"} />
                    <span className="num text-[12.5px] text-ink">{r.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3" title={r.check}>
                      {r.status === "pass" && r.label ? r.label : r.status === "fail" ? "Did not pass" : "Unknown (not counted as pass)"}
                    </span>
                    {tag(r.id, `rung ${r.id}`)}
                  </div>
                  {r.status !== "pass" && r.detail && <p className="mt-1 break-words text-[12px] leading-snug text-ink-2">{r.detail}</p>}
                </li>
              ))}
            </ul>
          </Block>
        </div>
      </div>

      {solved && <Block title="Baselines (plain rectangular fins)">
        <div className="min-w-0 overflow-x-auto p-3">
          <table className="w-full min-w-[300px] table-fixed border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[11.5px] text-ink-3">
                <th scope="col" className="w-[44%] py-1 font-normal">Baseline</th>
                <th scope="col" className="py-1 font-normal">Peak</th>
                <th scope="col" className="py-1 font-normal">This plate is</th>
              </tr>
            </thead>
            <tbody className="num text-ink">
              {([["Equal material", sim.baselines.equal_material], ["Full budget", sim.baselines.full_budget]] as const).map(([name, bl]) => (
                <tr key={name} className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink-2">{name} <span className="text-ink-3">({bl.cells} cells)</span></th>
                  <td>{f1(bl.peak_temp_c)} °C</td>
                  <td>{bl.delta_k >= 0 ? `${f1(bl.delta_k, 2)} K cooler` : `${f1(-bl.delta_k, 2)} K hotter`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[13px] leading-snug text-ink">
            {sim.verdict ? `${sim.verdict.label}. The lowest peak any geometry could reach is ${f1(sim.verdict.lower_bound_peak_c)} °C (the isothermal floor).` : `No verdict: it needs M2 (geometry valid) and M3 (printable) to pass, and ${sim.first_failure ?? "a rung"} did not.`}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-ink-3">{sim.verdict?.note ?? "2D steady-state model, stated h and k, no airflow CFD, not validated on a printed part."} Small margins are model estimates, not guarantees.</p>
        </div>
      </Block>}

      <Block title="Export" data-step="export" tabIndex={-1}>
        <div className="p-3 text-[12.5px] text-ink-2">
          {sim.stl ? (
            <p>
              <a href={`data:model/stl;base64,${sim.stl.base64}`} download="plate.stl" className="text-signal-ink underline-offset-2 hover:underline">
                Download plate.stl
              </a>{" "}
              <span className="num text-ink-3">{sim.stl.bytes.toLocaleString("en-US")} bytes · mm · sha256 {sim.stl.sha256.slice(0, 16)}…</span>
            </p>
          ) : (
            <p className="text-ink-3">No STL in this result. Tick “Include the printable STL” and simulate again.</p>
          )}
          <details className="mt-2 text-[12px] text-ink-3">
            <summary className="cursor-pointer text-ink-2">Honest limits ({sim.limits.length})</summary>
            <ul className="mt-1 list-disc pl-4 leading-snug">
              {sim.limits.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        </div>
      </Block>
    </div>
  );
}
