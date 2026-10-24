"use client";
import { useEffect, useRef, useState } from "react";
import { toHref } from "@/lib/deeplink";
import { postJson } from "../api";
import { clampParams, gradeMatter, MATTER_DEFAULT, MATTER_RANGES, matterDeepParams, peakBars, plateRgba, simulateBody, tempColor, type MatterParams, type SimResponse, type Viewer } from "../data/matter";
import { Btn, Chip, ErrorNote, LinkBtn, PlayLabel, TONE_VAR, Verdict, Waiting, useAction, type Tone } from "../ui";

function Plate({ v }: { v: Viewer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const { data, n } = plateRgba(v);
    c.width = n;
    c.height = n;
    ctx.putImageData(new ImageData(data, n, n), 0, 0);
    // chip footprint: [i0, i1, j0, j1) in model cells, y up
    const [i0, i1, j0, j1] = v.chip;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 0.7;
    ctx.strokeRect(i0, n - j1, i1 - i0, j1 - j0);
  }, [v]);
  const [a, b, c2] = [v.field.T_inf, v.field.peak, tempColor];
  const ramp = [0, 0.25, 0.5, 0.75, 1].map((f) => `rgb(${c2(a + (b - a) * f, a, b).join(",")})`).join(",");
  return (
    <figure className="min-w-0">
      <canvas
        ref={ref}
        role="img"
        aria-label={`Temperature map of the plate, ${v.field.T_inf.toFixed(0)} to ${v.field.peak.toFixed(1)} degrees C. The white square is the chip.`}
        className="aspect-square w-full max-w-[240px] rounded-md border border-[var(--hw-border)] bg-[var(--hw-bg)] [image-rendering:pixelated]"
      />
      <div className="mt-2 h-2 max-w-[240px] rounded-full" style={{ background: `linear-gradient(90deg, ${ramp})` }} aria-hidden />
      <figcaption className="hw-mono mt-1 flex max-w-[240px] justify-between text-[10px] text-[var(--hw-ink-3)]">
        <span>{a.toFixed(0)} °C</span>
        <span>{b.toFixed(1)} °C</span>
      </figcaption>
    </figure>
  );
}

function Slider({ k, value, onChange, fmt }: { k: keyof typeof MATTER_RANGES; value: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  const r = MATTER_RANGES[k];
  const id = `matter-${k}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-sm text-[var(--hw-ink-2)]">
        <span>{r.label}</span>
        <output htmlFor={id} className="hw-mono text-[var(--hw-ink)]">
          {fmt ? fmt(value) : value}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={r.min}
        max={r.max}
        step={r.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-11 w-full cursor-pointer accent-[var(--hw-ember)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hw-steel)]"
      />
      <div className="hw-mono flex justify-between text-[10px] text-[var(--hw-ink-3)]">
        <span>{fmt ? fmt(r.min) : r.min}</span>
        <span>{fmt ? fmt(r.max) : r.max}</span>
      </div>
    </div>
  );
}

export function ShapeSpreader() {
  const [p, setP] = useState<MatterParams>(MATTER_DEFAULT);
  const [asked, setAsked] = useState<MatterParams | null>(null);
  const sim = useAction((q: MatterParams, signal) => postJson<SimResponse>("/api/matter/simulate", simulateBody(q), signal));
  const set = (patch: Partial<MatterParams>) => setP((cur) => clampParams({ ...cur, ...patch }));
  const run = () => {
    setAsked(p);
    sim.start(p);
  };
  const reset = () => {
    setP(MATTER_DEFAULT);
    setAsked(null);
    sim.reset();
  };
  const r = sim.state.state === "ready" ? sim.state.data : null;
  const grade = r ? gradeMatter(r) : null;
  const bars = r ? peakBars(r) : [];
  const hi = Math.max(...bars.map((b) => b.peak), 1);
  const lo = Math.min(...bars.map((b) => b.peak), hi);
  const tone: Tone = grade === "beats-both" || grade === "beats-equal" ? "ok" : grade === "no-solve" ? "warn" : "info";
  const failed = r?.ladder.find((l) => l.status === "fail");

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 space-y-4">
        <div>
          <PlayLabel>Shape a rectangular-fin heat spreader</PlayLabel>
          <p className="text-sm leading-relaxed text-[var(--hw-ink-2)]">A 2 W chip heats a 60 x 60 mm plate. Choose the fins, then run the validated solver and see if you beat plain fins that use the same material.</p>
        </div>
        <Slider k="n_fins" value={p.n_fins} onChange={(v) => set({ n_fins: v })} />
        <Slider k="fin_len" value={p.fin_len} onChange={(v) => set({ fin_len: v })} />
        <Slider k="budget_fraction" value={p.budget_fraction} onChange={(v) => set({ budget_fraction: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        <p className="text-xs text-[var(--hw-ink-3)]">Ranges are the hosted solver&apos;s limits. More or longer fins use more material; a plate over budget is rejected at rung M2.</p>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="hw-card p-4">
          <p className="hw-label">What happens next</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--hw-ink-2)]">Run sends these numbers to the real solver (deterministic, no model involved, one to three seconds).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={sim.state.state === "loading"} onClick={run}>
              Run solver
            </Btn>
            <Btn variant="ghost" onClick={reset}>
              Reset preview
            </Btn>
          </div>
        </div>

        {sim.state.state === "idle" && (
          <div className="flex min-h-40 items-center justify-center rounded-[var(--hw-radius-sm)] border border-dashed border-[var(--hw-border)] p-4 text-center text-sm text-[var(--hw-ink-3)]">No result yet. Run the solver to see the plate.</div>
        )}
        {sim.state.state === "loading" && <Waiting>Solving the plate on the hosted engine</Waiting>}
        {sim.state.state === "error" && <ErrorNote error={sim.state.error} onRetry={run} />}

        {r && grade && (
          <>
            <Verdict
              tone={tone}
              title={
                grade === "no-solve"
                  ? "Rejected before solving: no temperature for this plate."
                  : r.verdict!.label + "."
              }
            >
              {grade === "no-solve" && failed && (
                <p>
                  Rung {failed.id} failed: {failed.detail}. Lower the fins or the length, or raise the budget.
                </p>
              )}
              {grade !== "no-solve" && (
                <p>
                  Peak {r.metrics.peak_temp_c!.toFixed(1)} °C.{" "}
                  {r.verdict!.delta_equal_material_k !== null && `${r.verdict!.delta_equal_material_k > 0 ? "Better" : "Worse"} than equal-material fins by ${Math.abs(r.verdict!.delta_equal_material_k).toFixed(2)} K`}
                  {r.verdict!.delta_full_budget_k !== null && `; ${r.verdict!.delta_full_budget_k > 0 ? "better" : "worse"} than the full-budget fins by ${Math.abs(r.verdict!.delta_full_budget_k).toFixed(2)} K`}.{" "}
                  {grade === "no-beat" && "Most plates do not beat these baselines; that is the honest result."}
                </p>
              )}
              {r.verdict?.note && <p className="text-xs text-[var(--hw-ink-3)]">{r.verdict.note}</p>}
            </Verdict>

            <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-[minmax(0,1fr)_200px]">
              <div className="min-w-0">
                <PlayLabel>Peak temperature (lower is better)</PlayLabel>
                <ul className="space-y-2">
                  {bars.map((b) => (
                    <li key={b.key} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="min-w-0 break-words text-[var(--hw-ink-2)]">{b.label}</span>
                        <span className="hw-mono shrink-0 text-[var(--hw-ink)]">{b.peak.toFixed(1)} °C</span>
                      </div>
                      <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-[var(--hw-elevated)]" aria-hidden>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(8, ((b.peak - (lo - 5)) / (hi - lo + 5)) * 100)}%`, background: b.key === "you" ? TONE_VAR.info : "var(--hw-ink-3)" }} />
                      </div>
                    </li>
                  ))}
                </ul>
                {r.verdict?.lower_bound_peak_c != null && <p className="mt-2 text-xs text-[var(--hw-ink-3)]">No geometry can go below {r.verdict.lower_bound_peak_c.toFixed(1)} °C (isothermal floor).</p>}
              </div>
              {r.viewer && r.metrics.peak_temp_c !== undefined && <Plate v={r.viewer} />}
            </div>

            <div>
              <PlayLabel>Verification rungs</PlayLabel>
              <ul className="space-y-1">
                {r.ladder.map((l) => (
                  <li key={l.id} className="flex min-w-0 gap-2 text-xs leading-snug">
                    <Chip tone={l.status === "pass" ? "ok" : l.status === "fail" ? "bad" : undefined}>
                      {l.id} {l.status}
                    </Chip>
                    <span className="min-w-0 break-words text-[var(--hw-ink-3)]">{l.status === "pass" && l.label ? l.label : l.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <LinkBtn href={toHref({ wb: "matter", params: matterDeepParams(asked ?? p), autorun: true })}>Open in the app</LinkBtn>
          <Chip>live solver</Chip>
        </div>
      </div>
    </div>
  );
}
