"use client";

import { useMemo, useState } from "react";
import {
  defaultSimulateInput,
  MATTER_GENERATORS,
  MATTER_SPREADER,
  matterApi,
  validateLocally,
  type ApiFailure,
  type MatterGenerator,
  type MatterSimulation,
  type SimulateInput,
} from "@/lib/hosted";
import { matterRungEvidence } from "@/lib/evidence";
import { buildPlate, heatColor, heatGradientCss } from "@/lib/plate";
import { EvidenceTag } from "../evidence/EvidenceChip";
import { ApiErrorView } from "./ApiErrorView";
import { Panel } from "./DomainShell";
import { CellGlyph } from "./RungMatrix";
import { MeshCanvas } from "./StlViewer";
import type { DrawerRef } from "./BoardCheckPanel";

const f1 = (n: number, d = 1) => n.toFixed(d);

function PlateViewer({ sim }: { sim: MatterSimulation }) {
  const plate = useMemo(() => buildPlate(sim.viewer), [sim]);
  // Colour runs from the coolest material cell to the peak, so the (often small) spread is visible; the legend states both numbers.
  const lo = plate.tMin;
  const hi = sim.viewer.field?.peak ?? lo;
  // two triangles per quad share one temperature entry: triangle t belongs to quad floor(t / 2)
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
      <div className="mt-3" aria-label="Temperature scale">
        <div className="h-2.5 rounded-full" style={{ background: heatGradientCss() }} />
        <div className="num mt-1 flex justify-between text-[11.5px] text-ink-3">
          <span>{f1(lo)} °C (coolest material cell)</span>
          <span>{f1(hi)} °C (peak)</span>
        </div>
      </div>
    </div>
  );
}

function NumberField({ id, label, unit, min, max, step, value, error, onChange }: { id: string; label: string; unit: string; min: number; max: number; step: number; value: number; error?: string; onChange: (v: number) => void }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-[12px] text-ink-3">
        <span className="truncate">{label}</span>
        <span className="num shrink-0 text-[11px]">
          {min}–{max}
          {unit ? ` ${unit}` : ""}
        </span>
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
        className={`num mt-1 h-9 w-full min-w-0 rounded-md border bg-sunken px-2.5 text-[13px] text-ink ${error ? "border-red" : "border-line-2"}`}
      />
      {error && (
        <p id={`${id}-err`} className="mt-1 text-[11.5px] leading-snug text-red">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Simulate": choose a generator and parameters, run the validated solver and ladder M1..M5 on the hosted function. */
export function MatterSimulatePanel({ onEvidence }: { onEvidence: (ref: DrawerRef) => void }) {
  const [input, setInput] = useState<SimulateInput>(() => ({ ...defaultSimulateInput("rect_fins"), include_stl: false }));
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState<MatterSimulation | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [local, setLocal] = useState<Array<{ path: string; message: string }>>([]);

  const gen = MATTER_GENERATORS[input.generator];
  const fieldErrors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of local) m[e.path] = e.message;
    if (failure?.kind === "field") for (const e of failure.fields) m[e.path] = e.message;
    return m;
  }, [local, failure]);

  const setGenerator = (g: MatterGenerator) => {
    setInput((i) => ({ ...defaultSimulateInput(g), spreader: i.spreader, include_stl: i.include_stl }));
    setLocal([]);
    setFailure(null);
  };
  const run = async () => {
    const errs = validateLocally(input);
    setLocal(errs);
    if (errs.length) return;
    setBusy(true);
    setFailure(null);
    const r = await matterApi.simulate(input);
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setSim(r.data);
  };

  const stlHref = sim?.stl ? `data:model/stl;base64,${sim.stl.base64}` : null;
  const passN = sim ? sim.ladder.filter((r) => r.status === "pass").length : 0;
  const solved = !!sim && sim.metrics.peak_temp_c !== undefined && !!sim.viewer.field;
  const chip = (rung: string, label: string) =>
    sim ? (
      <EvidenceTag
        label={label}
        onClick={() => {
          const e = matterRungEvidence(sim, rung);
          if (e) onEvidence(e);
        }}
      />
    ) : null;

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[12.5px] leading-snug text-ink-2" role="note">
        2D steady-state model with stated convection and conductivity; one of our built-in generators goes through the validated solver and an independent second solver. No model, no key. Not validated on a printed part, and no airflow CFD. Margins over the rectangular-fin baselines are small, and the result says so.
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)] [&>*]:min-w-0">
        <Panel title="Simulate">
          <form
            className="flex flex-col gap-3 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <div>
              <label htmlFor="mat-gen" className="text-[12px] text-ink-3">
                Generator
              </label>
              <select id="mat-gen" value={input.generator} onChange={(e) => setGenerator(e.target.value as MatterGenerator)} className="mt-1 h-9 w-full rounded-md border border-line-2 bg-sunken px-2.5 text-[13px] text-ink">
                {(Object.keys(MATTER_GENERATORS) as MatterGenerator[]).map((g) => (
                  <option key={g} value={g}>
                    {MATTER_GENERATORS[g].label}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-1.5 text-[12px] text-ink-3">Geometry (cells of the grid)</legend>
              {gen.params.map((p) => (
                <NumberField key={p.key} id={`gp-${p.key}`} label={p.label} unit={p.unit} min={p.min} max={p.max} step={p.step} value={input.gen_params[p.key]} error={fieldErrors[`gen_params.${p.key}`]} onChange={(v) => setInput((i) => ({ ...i, gen_params: { ...i.gen_params, [p.key]: v } }))} />
              ))}
            </fieldset>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-1.5 text-[12px] text-ink-3">Problem</legend>
              {MATTER_SPREADER.map((p) => (
                <NumberField key={p.key} id={`sp-${p.key}`} label={p.label} unit={p.unit} min={p.min} max={p.max} step={p.step} value={input.spreader[p.key]} error={fieldErrors[`spreader.${p.key}`]} onChange={(v) => setInput((i) => ({ ...i, spreader: { ...i.spreader, [p.key]: v } }))} />
              ))}
            </fieldset>
            {Object.keys(fieldErrors).some((k) => !k.startsWith("gen_params.") && !k.startsWith("spreader.")) && (
              <p className="text-[12px] text-red">{Object.entries(fieldErrors).filter(([k]) => !k.startsWith("gen_params.") && !k.startsWith("spreader.")).map(([k, m]) => `${k}: ${m}`).join("; ")}</p>
            )}
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={!!input.include_stl} onChange={(e) => setInput((i) => ({ ...i, include_stl: e.target.checked }))} />
              Include the printable STL (about 0.3 MB)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={busy} className="h-10 rounded-md bg-signal px-4 text-[14px] font-medium text-on-signal disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? "Solving…" : "Simulate"}
              </button>
              <span className="text-[12px] text-ink-3">Free. About a second.</span>
            </div>
          </form>
        </Panel>

        <Panel title="Result" aside={sim && <span className="num text-[12px] text-ink-3">{passN} of {sim.ladder.length} rungs pass · {sim.timings_ms} ms</span>}>
          <div className="flex flex-col gap-3 p-3" aria-live="polite">
            {failure && failure.kind !== "field" && <ApiErrorView failure={failure} onRetry={() => void run()} />}
            {failure?.kind === "field" && <ApiErrorView failure={failure} />}
            {busy && (
              <div role="status" className="grid min-h-[260px] place-items-center rounded-md bg-sunken text-[13px] text-ink-3">
                <span className="anim-breathe">Solving the plate and checking it with a second solver…</span>
              </div>
            )}
            {!sim && !busy && !failure && (
              <div role="status">
                <h3 className="text-[14px] font-medium text-ink">No simulation yet</h3>
                <p className="mt-1 text-[13px] leading-snug text-ink-3">Choose a generator and press Simulate. You get the plate coloured by the solver&apos;s temperatures, the five rungs M1 to M5, and both baselines.</p>
              </div>
            )}
            {sim && !busy && (
              <>
                {solved ? (
                  <PlateViewer sim={sim} />
                ) : (
                  <p className="rounded-md bg-amber-dim px-3 py-2.5 text-[13px] leading-snug text-amber" role="status">
                    Nothing was solved: the geometry was rejected before the solve ({sim.ladder.find((r) => r.status === "fail")?.detail ?? "a rung failed"}). There is no plate temperature or peak to show. Change the parameters and simulate again.
                  </p>
                )}
                {solved && (
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line text-[13px] sm:grid-cols-4 [&>div]:bg-panel [&>div]:px-3 [&>div]:py-2">
                  <div>
                    <dt className="flex items-center justify-between gap-1 text-[12px] text-ink-3">Peak {chip("M4", "peak temperature")}</dt>
                    <dd className="num text-[16px] text-ink">{f1(sim.metrics.peak_temp_c!)} °C</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-ink-3">Rise over ambient</dt>
                    <dd className="num text-[16px] text-ink">{f1(sim.metrics.peak_rise_k!)} K</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-ink-3">Material</dt>
                    <dd className="num text-[16px] text-ink">{f1((sim.metrics.material_fraction ?? 0) * 100)}%</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-ink-3">Heat balance error</dt>
                    <dd className="num text-[16px] text-ink">{(sim.metrics.heat_balance_rel ?? 0).toExponential(1)}</dd>
                  </div>
                </dl>
                )}

                <section aria-label="Rungs">
                  <h3 className="mb-1.5 text-[13px] text-ink-2">Ladder</h3>
                  <ul className="flex flex-col gap-1.5">
                    {sim.ladder.map((r) => (
                      <li key={r.id} className="min-w-0 rounded-md border border-line px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <CellGlyph status={r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : "unknown"} />
                          <span className="num text-[13px] text-ink">{r.id}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3" title={r.check}>
                            {r.status === "pass" && r.label ? r.label : r.status === "fail" ? "Did not pass" : "Unknown (not counted as pass)"}
                          </span>
                          {chip(r.id, `rung ${r.id}`)}
                        </div>
                        {r.detail && <p className="mt-1 break-words text-[12.5px] leading-snug text-ink-2">{r.detail}</p>}
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-label="Baselines">
                  <h3 className="mb-1.5 text-[13px] text-ink-2">Baselines (plain rectangular fins)</h3>
                  <table className="w-full table-fixed border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-left text-[11.5px] text-ink-3">
                        <th scope="col" className="w-[44%] py-1 font-normal">Baseline</th>
                        <th scope="col" className="py-1 font-normal">Peak</th>
                        <th scope="col" className="py-1 font-normal">This plate is</th>
                      </tr>
                    </thead>
                    <tbody className="num text-ink">
                      {(
                        [
                          ["Equal material", sim.baselines.equal_material],
                          ["Full budget", sim.baselines.full_budget],
                        ] as const
                      ).map(([name, b]) => (
                        <tr key={name} className="border-t border-line">
                          <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink-2">{name} <span className="text-ink-3">({b ? b.cells : "—"} cells)</span></th>
                          <td>{b ? `${f1(b.peak_temp_c)} °C` : "—"}</td>
                          <td>{b && b.delta_k !== null ? (b.delta_k >= 0 ? `${f1(b.delta_k, 2)} K cooler` : `${f1(-b.delta_k, 2)} K hotter`) : "no comparison: nothing was solved"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sim.verdict ? (
                    <p className="mt-2 text-[13px] leading-snug text-ink">
                      {sim.verdict.label}. The lowest peak any geometry could reach is {f1(sim.verdict.lower_bound_peak_c)} °C (the isothermal floor).
                    </p>
                  ) : (
                    <p className="mt-2 text-[13px] leading-snug text-ink-2">No verdict: the verdict needs M2 (geometry valid) and M3 (printable) to pass, and {sim.first_failure ?? "a rung"} did not.</p>
                  )}
                  <p className="mt-1 text-[12px] leading-snug text-ink-3">{sim.verdict?.note ?? "2D steady-state model, stated h and k, no airflow CFD, not validated on a printed part."} Small margins are model estimates, not guarantees.</p>
                </section>

                {sim.stl && stlHref && (
                  <p className="text-[12.5px] text-ink-2">
                    <a href={stlHref} download="plate.stl" className="text-signal-ink underline-offset-2 hover:underline">
                      Download plate.stl
                    </a>{" "}
                    <span className="num text-ink-3">{sim.stl.bytes.toLocaleString("en-US")} bytes · mm · sha256 {sim.stl.sha256.slice(0, 16)}…</span>
                  </p>
                )}
                <details className="text-[12px] text-ink-3">
                  <summary className="cursor-pointer text-ink-2">Honest limits ({sim.limits.length})</summary>
                  <ul className="mt-1 list-disc pl-4 leading-snug">
                    {sim.limits.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
