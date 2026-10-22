"use client";

import type { RunController, Snapshot } from "@/lib/controller";
import { allPass, candidates, matterFigures, passCount, rungCell, rungsOf, replayFileUrl } from "@/lib/domain";
import type { NodeState, RunState } from "@/lib/run-state";
import { ArtifactList, DomainHeader, Panel } from "./DomainShell";
import { CellGlyph, MatrixLegend, RungMatrix, type RungSelection } from "./RungMatrix";
import { StlViewer } from "./StlViewer";

const fix = (n: number | null, d = 1, unit = "") => (n === null ? "—" : `${n.toFixed(d)}${unit}`);

export function matterFinding(s: RunState): string {
  const rungs = rungsOf(s);
  const best = s.best ? s.nodes[s.best] : null;
  if (s.status === "failed") return `The run failed: ${s.error}`;
  if (best && allPass(best, rungs)) {
    const f = matterFigures(best);
    return `${best.id} (${best.proposal?.mnemonic ?? "generator"}) passes M1 to M5: peak ${fix(f.peakC, 1, " °C")}${f.deltaK !== null ? `, ${fix(f.deltaK, 2, " K")} below the equal-material baseline` : ""}.`;
  }
  if (s.status === "completed") return "No candidate passed every rung, so there is no winner.";
  const c = candidates(s);
  return c.length ? `Searching · ${c.length} candidates · ${c.filter((n) => n.domainScore).length} judged` : "Validating the solver and waiting for the first candidate…";
}

/** Peak temperature against material used, one dot per judged candidate. Lower and to the left is better. */
function ParetoPlot({ s, selected, onSelect }: { s: RunState; selected: string | null; onSelect: (id: string) => void }) {
  const rungs = rungsOf(s);
  const pts = candidates(s)
    .map((n) => ({ n, f: matterFigures(n) }))
    .filter((p) => p.f.peakC !== null && p.f.materialFraction !== null);
  if (pts.length < 1) return <p className="px-4 py-6 text-[13px] text-ink-3">No candidate has been judged yet.</p>;
  const W = 460;
  const H = 240;
  const L = 46;
  const B = 34;
  const xs = pts.map((p) => p.f.materialFraction! * 100);
  const ys = pts.map((p) => p.f.peakC!);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - 2));
  const x1 = Math.ceil(Math.max(...xs) + 2);
  const y0 = Math.floor(Math.min(...ys) - 5);
  const y1 = Math.ceil(Math.max(...ys) + 5);
  const X = (v: number) => L + ((v - x0) / Math.max(x1 - x0, 1)) * (W - L - 12);
  const Y = (v: number) => 12 + (1 - (v - y0) / Math.max(y1 - y0, 1)) * (H - B - 12);
  return (
    <div className="p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label="Peak temperature against material fraction, one point per candidate">
        <line x1={L} y1={H - B} x2={W - 8} y2={H - B} stroke="var(--line-2)" />
        <line x1={L} y1={10} x2={L} y2={H - B} stroke="var(--line-2)" />
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <text x={L - 6} y={Y(y0 + t * (y1 - y0)) + 3} textAnchor="end" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
              {Math.round(y0 + t * (y1 - y0))}
            </text>
            <text x={X(x0 + t * (x1 - x0))} y={H - B + 14} textAnchor="middle" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
              {Math.round(x0 + t * (x1 - x0))}
            </text>
          </g>
        ))}
        <text x={(L + W) / 2} y={H - 4} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
          material used, % of the plate
        </text>
        <text x={12} y={(H - B) / 2} fontSize="10.5" fill="var(--ink-3)" transform={`rotate(-90 12 ${(H - B) / 2})`} textAnchor="middle">
          peak °C
        </text>
        {pts.map(({ n, f }) => {
          const ok = allPass(n, rungs);
          const best = s.best === n.id;
          const on = selected === n.id;
          return (
            <g key={n.id} onClick={() => onSelect(n.id)} style={{ cursor: "pointer" }}>
              <circle cx={X(f.materialFraction! * 100)} cy={Y(f.peakC!)} r={best ? 7 : 5} fill={ok ? "var(--signal)" : "none"} stroke={ok ? "var(--signal)" : "var(--ink-3)"} strokeWidth={on ? 3 : 1.6}>
                <title>{`${n.id}: ${fix(f.peakC, 1, " °C")} at ${fix(f.materialFraction! * 100, 1, "%")} material${ok ? ", passes M1 to M5" : ", did not pass every rung"}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[12px] text-ink-3">Filled = passed M1 to M5. Open = judged but did not pass every rung (its peak is still the solver&apos;s number).</p>
    </div>
  );
}

function CandidateCard({ n, s, rungs, selected, onSelect }: { n: NodeState; s: RunState; rungs: ReturnType<typeof rungsOf>; selected: boolean; onSelect: () => void }) {
  const f = matterFigures(n);
  const pc = passCount(n, rungs);
  const best = s.best === n.id;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-w-0 flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors duration-150 ${selected ? "border-signal-line bg-raised" : "border-line bg-panel hover:bg-raised/60"}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="num text-[12.5px] text-ink">{n.id}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{n.proposal?.mnemonic ?? "generator"}</span>
        {best && <span className="shrink-0 rounded-full bg-signal-dim px-2 text-[11px] text-signal-ink">Best</span>}
      </span>
      <span className="flex gap-1" aria-label={`Rungs: ${pc.pass} of ${pc.total} pass`}>
        {rungs.map((r) => (
          <span key={r.id} className="flex flex-col items-center gap-0.5" title={`${r.id}: ${rungCell(n, r).status}`}>
            <CellGlyph status={rungCell(n, r).status} />
            <span className="num text-[9.5px] text-ink-3">{r.id}</span>
          </span>
        ))}
      </span>
      <span className="num text-[12px] text-ink-2">
        {fix(f.peakC, 1, " °C")} · {fix(f.materialFraction === null ? null : f.materialFraction * 100, 1, "%")} material
      </span>
      {n.pruned && <span className="line-clamp-2 break-words text-[11.5px] text-ink-3">{n.pruned.reason}</span>}
    </button>
  );
}

export function MatterCanvas({ c, snap, sel, onSelect }: { c: RunController; snap: Snapshot; sel: RungSelection | null; onSelect: (s: RungSelection) => void }) {
  const s = snap.state;
  const rungs = rungsOf(s);
  const nodes = candidates(s);
  const shownId = sel?.nodeId ?? s.best ?? nodes.at(-1)?.id ?? null;
  const shown = shownId ? s.nodes[shownId] : null;
  const f = shown ? matterFigures(shown) : null;
  const pick = (id: string) => onSelect({ nodeId: id, rung: sel?.rung ?? rungs.at(-1)?.id ?? "M5" });
  const stl = s.artifacts.find((a) => a.kind === "stl" && a.nodeId === shownId);

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <DomainHeader
        title={s.workload?.title ?? s.runId ?? "Matter run"}
        sub={`Matter · ${s.workload?.id ?? ""} · ${nodes.length} candidate${nodes.length === 1 ? "" : "s"} · ${snap.mode === "live" ? "live" : "replay"}`}
        finding={matterFinding(s)}
        notice="2D steady-state model with stated convection and conductivity. The solver is checked against analytic cases (M1) and a second solver (M4). Not validated on a printed part, and no airflow CFD."
        c={c}
        snap={snap}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title={shown ? `Plate · ${shown.id}` : "Plate"} aside={shown && <span className="num text-[12px] text-ink-3">{shown.proposal?.mnemonic}</span>}>
          <div className="p-3">
            <StlViewer url={shown && s.runId && stl ? replayFileUrl(s.runId, shown.id, "plate.stl") : null} label={`Extruded plate geometry of candidate ${shown?.id ?? ""}, drag to rotate`} />
            <p className="mt-2 text-[12px] leading-snug text-ink-3">Geometry is drawn from the run&apos;s STL file, shaded for form only. The event log carries no temperature field, so no heat map is shown; the peak temperature below is the solver&apos;s number.</p>
          </div>
          {f && (
            <dl className="grid grid-cols-2 gap-px border-t border-line bg-line text-[13px] [&>div]:bg-panel [&>div]:px-4 [&>div]:py-2.5 sm:grid-cols-4 @3xl:grid-cols-2 @5xl:grid-cols-4">
              {[
                ["Peak", fix(f.peakC, 1, " °C")],
                ["Rise over ambient", fix(f.riseK, 1, " K")],
                ["Material", fix(f.materialFraction === null ? null : f.materialFraction * 100, 1, "%")],
                ["Baseline peak", fix(f.baselinePeakC, 1, " °C")],
                ["Δ vs baseline", fix(f.deltaK, 2, " K")],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[12px] text-ink-3">{k}</dt>
                  <dd className="num truncate text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
        <Panel title="Pareto of candidates">
          <ParetoPlot s={s} selected={shownId} onSelect={pick} />
        </Panel>
      </div>

      <Panel title="Check matrix" aside={<span className="num text-[12px] text-ink-3">{rungs.length} rungs · {nodes.length} candidates</span>}>
        <RungMatrix state={s} selected={sel} onSelect={onSelect} nodeLabel={(id) => s.nodes[id]?.proposal?.mnemonic} />
        <div className="border-t border-line px-4 py-2.5">
          <MatrixLegend />
        </div>
      </Panel>

      <Panel title="Candidate gallery" aside={<span className="num text-[12px] text-ink-3">{nodes.length}</span>}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-2 p-3">
          {nodes.length === 0 && <p className="text-[13px] text-ink-3">No candidates yet.</p>}
          {nodes.map((n) => (
            <CandidateCard key={n.id} n={n} s={s} rungs={rungs} selected={shownId === n.id} onSelect={() => pick(n.id)} />
          ))}
        </div>
      </Panel>

      <Panel title="Artifacts" aside={<span className="num text-[12px] text-ink-3">{s.artifacts.length}</span>}>
        <ArtifactList artifacts={s.artifacts} />
      </Panel>
    </div>
  );
}
