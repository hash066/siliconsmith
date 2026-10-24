"use client";

import { useEffect, useMemo, useState } from "react";
import { MATTER_GENERATORS, MATTER_SPREADER, type MatterSimulation } from "@/lib/hosted";
import { buildPlate, heatColor, heatGradientCss } from "@/lib/plate";
import { ApiErrorView } from "../domain/ApiErrorView";
import { MeshCanvas } from "../domain/StlViewer";
import { CheckCards } from "./CheckCards";
import { matterChecks } from "./verdict";
import { solvedOf, type MatterBench } from "./useMatterBench";
import { btnPrimary } from "./ui";

const f1 = (n: number, d = 1) => n.toFixed(d);

function PlateViewer({ sim, hi }: { sim: MatterSimulation; hi: number }) {
  const plate = useMemo(() => buildPlate(sim.viewer), [sim]);
  const lo = plate.tMin;
  const byTri = useMemo(() => {
    const span = Math.max(hi - lo, 1e-9);
    return (tri: number) => heatColor((plate.temps[Math.floor(tri / 2)] - lo) / span);
  }, [plate, lo, hi]);
  // The canvas sizes itself from a width it measures after mounting; stay invisible for those two frames so nothing visibly jumps.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className={settled ? "" : "invisible"}>
      <MeshCanvas
        mesh={plate.mesh}
        colorOf={byTri}
        zScale={6}
        label={`Heat sink drawn from the simulation, coloured by temperature from ${f1(lo)} to ${f1(hi)} degrees C. Drag to rotate.`}
        footer={<span className="num ml-auto">{plate.cells.toLocaleString("en-US")} cells · height exaggerated</span>}
      />
      <div className="mt-2" aria-label="Temperature scale">
        <div className="h-2 rounded-full" style={{ background: heatGradientCss() }} />
        <div className="num mt-1 flex justify-between text-[11px] text-ink-3">
          <span>{f1(lo)} °C cooler</span>
          <span>{f1(hi)} °C hottest</span>
        </div>
      </div>
    </div>
  );
}

/** The three simple controls of the Matter preview. Moving one re-runs the free solver after a short pause. */
function SimpleControls({ b }: { b: MatterBench }) {
  const { input, setInput, errors } = b;
  const gen = MATTER_GENERATORS[input.generator];
  const finKey = input.generator === "rect_fins" ? "n_fins" : "n_spokes";
  const fin = gen.params.find((p) => p.key === finKey);
  const power = MATTER_SPREADER.find((p) => p.key === "Q")!;
  const mat = MATTER_SPREADER.find((p) => p.key === "budget_fraction")!;
  const rows: Array<{ id: string; label: string; unit: string; min: number; max: number; step: number; value: number; show: (v: number) => string; set: (v: number) => void; err?: string }> = [
    { id: "ctl-power", label: "Chip power", unit: "W", min: 0.5, max: 30, step: 0.5, value: input.spreader.Q, show: (v) => `${v} W`, set: (v) => setInput((i) => ({ ...i, spreader: { ...i.spreader, Q: v } })), err: errors["spreader.Q"] },
    { id: "ctl-material", label: "Material", unit: "%", min: mat.min, max: mat.max, step: 0.05, value: input.spreader.budget_fraction, show: (v) => `${Math.round(v * 100)}%`, set: (v) => setInput((i) => ({ ...i, spreader: { ...i.spreader, budget_fraction: v } })), err: errors["spreader.budget_fraction"] },
  ];
  // "Size" exists once the hosted solver exposes the plate size (spreader.n, in mm); until then the control is simply absent.
  const size = (MATTER_SPREADER as ReadonlyArray<{ key: string; min: number; max: number; step: number }>).find((p) => p.key === "n");
  if (size) rows.push({ id: "ctl-size", label: "Plate size", unit: "mm", min: size.min, max: size.max, step: size.step, value: input.spreader.n, show: (v) => `${v} mm`, set: (v) => setInput((i) => ({ ...i, spreader: { ...i.spreader, n: v } })), err: errors["spreader.n"] });
  if (fin) rows.push({ id: "ctl-fins", label: input.generator === "rect_fins" ? "Fins" : "Spokes", unit: "", min: fin.min, max: fin.max, step: 1, value: input.gen_params[finKey], show: (v) => `${v}`, set: (v) => setInput((i) => ({ ...i, gen_params: { ...i.gen_params, [finKey]: v } })), err: errors[`gen_params.${finKey}`] });
  return (
    <fieldset className="rounded-xl border border-line bg-panel p-3">
      <legend className="hw-label px-1 !text-[10.5px]">Try it</legend>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @lg:grid-cols-2 @3xl:grid-cols-4">
        {rows.map((r) => (
          <div key={r.id} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={r.id} className="text-[12.5px] text-ink-2">
                {r.label}
              </label>
              <output htmlFor={r.id} className="num text-[12.5px] text-ink">
                {Number.isFinite(r.value) ? r.show(r.value) : "?"}
              </output>
            </div>
            <input id={r.id} type="range" min={r.min} max={r.max} step={r.step} value={Number.isFinite(r.value) ? Math.min(r.max, Math.max(r.min, r.value)) : r.min} onChange={(e) => r.set(Number(e.target.value))} aria-invalid={!!r.err} className="mt-1 h-6 w-full accent-[var(--wb)]" />
            {r.err && <p className="text-[11.5px] text-red">{r.err}</p>}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Free. The solver re-runs by itself when you stop moving a slider.</p>
    </fieldset>
  );
}

export function MatterPreview({ b, tab }: { b: MatterBench; tab: "preview" | "proof" }) {
  const { sim, busy, failure, stale, valid } = b;
  // Re-run after the visitor stops moving a control. Never while a run is in flight, never with invalid values.
  useEffect(() => {
    if (!sim || !stale || busy || !valid) return;
    const t = setTimeout(() => void b.simulate(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, stale, busy, valid, b.input]);

  if (tab === "proof") {
    if (!sim) return <Empty busy={busy} onRun={() => void b.simulate()} what="checks" />;
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[12.5px] leading-snug text-ink-2">Five checks stand behind this result. Green means it passed, red means it failed, amber means it could not be decided.</p>
        <CheckCards cards={matterChecks(sim)} detail={Object.fromEntries(sim.ladder.map((r) => [r.id, r.check]))} />
      </div>
    );
  }
  if (failure && failure.kind !== "field" && !sim) return <div className="p-4"><ApiErrorView failure={failure} onRetry={() => void b.simulate()} /></div>;
  if (!sim) return <Empty busy={busy} onRun={() => void b.simulate()} what="simulation" />;
  const solved = solvedOf(sim);
  return (
    <div className="@container flex min-w-0 flex-col gap-4 p-4" aria-busy={busy}>
      {failure && <ApiErrorView failure={failure} />}
      {solved ? (
        <>
          <div className={`transition-opacity duration-200 ${busy ? "opacity-60" : ""}`}>
            <PlateViewer sim={sim} hi={solved.fieldPeak} />
          </div>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px] [&>div]:bg-panel [&>div]:px-3 [&>div]:py-2.5">
            <div>
              <dt className="min-h-[2lh] text-[11.5px] text-ink-3">Hottest point</dt>
              <dd className="num text-[20px] leading-tight text-ink">{f1(solved.peak)} °C</dd>
            </div>
            <div>
              <dt className="min-h-[2lh] text-[11.5px] text-ink-3">Material used</dt>
              <dd className="num text-[20px] leading-tight text-ink">{solved.fraction === null ? "n/a" : `${f1(solved.fraction * 100, 0)}%`}</dd>
            </div>
            <div>
              <dt className="min-h-[2lh] text-[11.5px] text-ink-3">Plain fins, same material</dt>
              <dd className="num text-[20px] leading-tight text-ink">{solved.equal.delta_k === null ? "n/a" : solved.equal.delta_k >= 0 ? `${f1(solved.equal.delta_k, 1)} K cooler` : `${f1(-solved.equal.delta_k, 1)} K hotter`}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-[13.5px] leading-snug text-ink-2" role="status">
          Nothing was solved: this shape was rejected before the simulation, so there is no heat picture. See the Proof tab for why.
        </p>
      )}
      <SimpleControls b={b} />
    </div>
  );
}

function Empty({ busy, onRun, what }: { busy: boolean; onRun: () => void; what: string }) {
  return (
    <div className="grid min-h-[500px] place-items-center p-6" role="status">
      {busy ? (
        <div className="w-full text-center">
          <div className="mx-auto h-[380px] w-full animate-pulse rounded-2xl bg-raised" />
          <p className="mt-3 text-[13px] text-ink-3">Simulating the heat flow and checking it with a second solver…</p>
        </div>
      ) : (
        <div className="max-w-sm text-center">
          <h3 className="text-[16px] font-semibold text-ink">No {what} yet</h3>
          <p className="mt-1.5 text-[13px] leading-snug text-ink-3">Describe your part in the chat, or run the default one now. It is free and takes about a second.</p>
          <button type="button" onClick={onRun} className={`${btnPrimary} mt-4`}>
            Run the default now
          </button>
        </div>
      )}
    </div>
  );
}
