"use client";

import { useEffect, useMemo, useState } from "react";
import { agentsOf, customScenario, planCsv, scenarioCode, scenariosOf, type AgentCard, type RunLike, type Scenario } from "@/lib/silicon-plan";
import { hex32, type InstructionViews } from "@/lib/silicon-views";
import { usd } from "@/lib/format";
import { downloadFile } from "./files";
import { btnGhost, btnPrimary } from "./ui";
import { moduleName, parseOperand, runPairs } from "@/lib/silicon-pairs";

const TONE: Record<AgentCard["status"], string> = { waiting: "var(--ink-3)", working: "var(--hw-warn)", done: "var(--hw-ok)", "not needed": "var(--ink-3)" };

/** Who did what in this run: the three Nemotron roles and the Sandbox that proves, with the run's own calls, tokens and cost. */
export function AgentsPanel({ run, phase }: { run: RunLike; phase: "idle" | "running" | "done" | "failed" }) {
  const cards = useMemo(() => agentsOf(run, phase), [run, phase]);
  return (
    <section aria-label="Agents" className="min-w-0 rounded-xl border border-line bg-panel p-3" data-testid="agents-panel">
      <h3 className="hw-label mb-2 !text-[10.5px]">The agents</h3>
      <ul className="grid gap-2 @xl:grid-cols-2">
        {cards.map((a) => (
          <li key={a.id} data-agent={a.id} data-status={a.status} className="min-w-0 rounded-lg border border-line bg-sunken p-2.5">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${a.status === "working" ? "hw-marker" : ""}`} style={{ background: TONE[a.status] }} />
              <span className="text-[13px] font-medium text-ink">{a.name}</span>
              <span className="num ml-auto truncate text-[10.5px] text-ink-3">{a.model}</span>
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-ink-3">{a.job}</p>
            <p className="num mt-1.5 text-[11.5px] text-ink-2">
              {a.status === "not needed" ? "not needed this run" : a.status === "waiting" ? "waiting" : `${a.status} · ${a.calls} ${a.id === "prover" ? "runs" : "calls"}${a.id === "prover" ? "" : ` · ${a.tokens.toLocaleString("en-US")} tokens · ${usd(a.costUsd)}`}`}
            </p>
            {a.note && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{a.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

type SigId = string;
const SIGNALS: Array<{ id: SigId; label: string; width: string }> = [
  { id: "rs1", label: "rs1", width: "[31:0]" },
  { id: "rs2", label: "rs2", width: "[31:0]" },
  { id: "hw", label: "rd (hardware)", width: "[31:0]" },
  { id: "ref", label: "rd (C reference)", width: "[31:0]" },
  { id: "agree", label: "agree", width: "" },
];

const valueOf = (s: Scenario, id: SigId): string => (id.startsWith("i:") ? (s.internal?.[id.slice(2)] ?? "–") : id === "rs1" ? hex32(s.rs1) : id === "rs2" ? hex32(s.rs2) : id === "hw" ? hex32(s.hardware) : id === "ref" ? hex32(s.reference) : s.passed ? "1" : "0");

/** A waveform viewer for the scenarios: variables you can show or hide, a cursor you can step or play, zoom, and a readout of the values under it. */
export function WaveViewer({ list, selected, onSelect }: { list: Scenario[]; selected: number; onSelect: (i: number) => void }) {
  const [hidden, setHidden] = useState<Set<SigId>>(new Set());
  const all = useMemo(() => {
    const names = new Set<string>();
    for (const s of list) for (const k of Object.keys(s.internal ?? {})) names.add(k);
    return [...SIGNALS, ...[...names].map((n) => ({ id: `i:${n}`, label: n, width: "inside" }))];
  }, [list]);
  const shown = (id: SigId) => !hidden.has(id);
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => onSelect((selected + 1) % list.length), 800);
    return () => clearInterval(id);
  }, [playing, selected, list.length, onSelect]);
  const CW = Math.round(92 * zoom);
  const RH = 30;
  const rows = all.filter((s) => shown(s.id));
  const left = 8;
  const width = left + list.length * CW + 8;
  const height = 24 + rows.length * RH + 6;
  const cur = list[selected];
  return (
    <div className="min-w-0" data-testid="wave-viewer">
      <div className="mb-2 flex flex-wrap items-center gap-1" role="toolbar" aria-label="Waveform controls">
        <button type="button" onClick={() => onSelect((selected - 1 + list.length) % list.length)} className={`${btnGhost} !h-8 !px-2.5`} aria-label="Previous scenario">◀</button>
        <button type="button" onClick={() => setPlaying((p) => !p)} className={`${btnGhost} !h-8 !px-3`} aria-pressed={playing} data-testid="wave-play">{playing ? "Pause" : "Play"}</button>
        <button type="button" onClick={() => onSelect((selected + 1) % list.length)} className={`${btnGhost} !h-8 !px-2.5`} aria-label="Next scenario">▶</button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <button type="button" onClick={() => setZoom((z) => Math.min(1.8, z * 1.25))} className={`${btnGhost} !h-8 !px-2.5`} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.6, z / 1.25))} className={`${btnGhost} !h-8 !px-2.5`} aria-label="Zoom out">−</button>
        <span className="num ml-auto text-[11.5px] text-ink-3">t = {selected + 1} of {list.length}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-2 @2xl:flex-row">
        <div className="shrink-0 rounded-lg bg-sunken p-2 @2xl:w-[200px]">
          <p className="hw-label mb-1 !text-[10px]">Scope</p>
          <p className="num mb-2 text-[11.5px] text-ink-2">{views_name(list)}</p>
          <p className="hw-label mb-1 !text-[10px]">Variables</p>
          <ul className="flex flex-col">
            {all.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[12px] text-ink-2 hover:bg-raised">
                  <input type="checkbox" checked={shown(s.id)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="num text-[10.5px] text-ink-3">{s.width}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div role="region" aria-label="Waveform" tabIndex={0} className="scroll-quiet min-w-0 flex-1 overflow-x-auto rounded-lg bg-sunken p-1">
          <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-none" role="img" aria-label={`Waveform of ${list.length} scenarios; cursor on scenario ${selected + 1}`}>
            {list.map((s, i) => (
              <g key={s.id} onClick={() => onSelect(i)} style={{ cursor: "pointer" }}>
                <rect x={left + i * CW} y={0} width={CW} height={height} fill={i === selected ? "var(--raised)" : "transparent"} opacity={0.9} />
                <text x={left + i * CW + CW / 2} y={15} textAnchor="middle" fontSize="10" fill={i === selected ? "var(--ink)" : "var(--ink-3)"} fontFamily="var(--font-code), monospace">
                  t{i + 1}
                </text>
              </g>
            ))}
            {rows.map((sig, r) =>
              list.map((s, i) => {
                const x = left + i * CW;
                const y = 24 + r * RH + 3;
                const bad = (sig.id === "hw" || sig.id === "agree") && !s.passed;
                const col = bad ? "var(--hw-bad)" : sig.id.startsWith("i:") ? "var(--ink-2)" : sig.id === "hw" ? "var(--hw-ok)" : sig.id === "agree" ? "var(--hw-ok)" : sig.id === "ref" ? "var(--ink-3)" : "var(--hw-steel)";
                const h = RH - 8;
                const v = valueOf(s, sig.id);
                return sig.id === "agree" ? (
                  <g key={`${sig.id}${i}`}>
                    <line x1={x} y1={s.passed ? y + 3 : y + h - 3} x2={x + CW} y2={s.passed ? y + 3 : y + h - 3} stroke={col} strokeWidth={1.6} />
                  </g>
                ) : (
                  <g key={`${sig.id}${i}`}>
                    <path d={`M${x + 5} ${y} H${x + CW - 5} L${x + CW} ${y + h / 2} L${x + CW - 5} ${y + h} H${x + 5} L${x} ${y + h / 2} Z`} fill="none" stroke={col} strokeWidth={i === selected ? 1.8 : 1.1} />
                    <text x={x + CW / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={Math.max(8.5, 10.5 * zoom)} fontFamily="var(--font-code), monospace" fill="var(--ink)">
                      {v}
                    </text>
                  </g>
                );
              }),
            )}
            <line x1={left + selected * CW + CW / 2} y1={20} x2={left + selected * CW + CW / 2} y2={height} stroke="var(--hw-steel)" strokeWidth={1} strokeDasharray="3 3" />
          </svg>
        </div>
      </div>
      {cur && (
        <dl className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-lg bg-sunken px-3 py-2 text-[11.5px] text-ink-2 @xl:grid-cols-4" aria-label="Values at the cursor" data-testid="wave-readout">
          {all.map((s) => (
            <div key={s.id} className="flex gap-1.5">
              <dt className="text-ink-3">{s.label}</dt>
              <dd className="text-ink">{valueOf(cur, s.id)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
const views_name = (list: Scenario[]) => `instruction · ${list.length} scenarios`;

const MAX_OWN = 6;

/** Two operands typed by the visitor, run on the real hardware description in a Sandbox next to the C reference. */
function OwnPair({ name, rtl, cRef, count, onResult }: { name: string; rtl: string; cRef: string; count: number; onResult: (row: number[], vcd: string) => void }) {
  const [a, setA] = useState("0x01020304");
  const [b, setB] = useState("0x01010101");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pa = parseOperand(a);
  const pb = parseOperand(b);
  const module = moduleName(rtl);
  const ready = pa !== null && pb !== null && module === name && count < MAX_OWN && !busy;
  const go = async () => {
    if (pa === null || pb === null) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await runPairs({ name, rtl, cRef, pairs: [[pa, pb]] });
      if (!r.rows[0]) throw new Error("The simulation returned no result.");
      onResult(r.rows[0], r.vcd);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The simulation could not run.");
    } finally {
      setBusy(false);
    }
  };
  const field = (id: string, label: string, v: string, set: (s: string) => void, ok: boolean) => (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="text-[11.5px] text-ink-3">{label}</label>
      <input id={id} value={v} onChange={(e) => set(e.target.value)} spellCheck={false} aria-invalid={!ok} className="num mt-0.5 h-8 w-full rounded-lg border border-line bg-surface px-2 text-[12.5px] text-ink aria-[invalid=true]:border-[var(--hw-bad)]" />
    </div>
  );
  return (
    <div className="mt-3 rounded-lg border border-line bg-sunken p-3" data-testid="own-pair">
      <p className="text-[12.5px] font-medium text-ink">Try your own operands</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">Hex with 0x, or decimal (negative allowed). Runs this instruction in a Sandbox beside its C reference. Free; limited per visitor.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {field("own-rs1", "rs1", a, setA, pa !== null)}
        {field("own-rs2", "rs2", b, setB, pb !== null)}
        <button type="button" onClick={() => void go()} disabled={!ready} className={btnPrimary} data-testid="own-pair-run">
          {busy ? "Running…" : "Run it"}
        </button>
      </div>
      {count >= MAX_OWN && <p className="mt-1.5 text-[11.5px] text-ink-3">You have added {MAX_OWN} pairs, the most for one run.</p>}
      {err && <p className="mt-2 rounded-lg bg-amber-dim px-3 py-2 text-[12.5px] leading-snug text-ink" role="alert">{err}</p>}
    </div>
  );
}

type PlanTab = "description" | "code" | "results";

/** The test plan: scenarios with Description, Code and Results, a waveform viewer, and an export. Same shape as a verification tool's plan view. */
export function TestPlan({ views, mnemonic, rtl, vcd }: { views: InstructionViews; mnemonic: string; rtl?: string; vcd?: string }) {
  const base = useMemo(() => scenariosOf(views, vcd), [views, vcd]);
  const [extra, setExtra] = useState<Scenario[]>([]);
  const list = useMemo(() => [...base, ...extra], [base, extra]);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<PlanTab>("results");
  const s = list[sel];
  const passed = list.filter((x) => x.passed).length;
  if (!s) return null;
  return (
    <section aria-label="Test plan" className="min-w-0 rounded-xl border border-line bg-panel p-3" data-testid="test-plan">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="hw-label !text-[10.5px]">Test plan</h3>
        <span className="num text-[12px]" style={{ color: passed === list.length ? "var(--hw-ok)" : "var(--hw-bad)" }}>
          {passed} of {list.length} scenarios passed
        </span>
        {vcd && (
          <button type="button" onClick={() => downloadFile({ name: "waveform.vcd", mime: "text/plain", note: "Every signal of the instruction on the eight operand pairs; opens in GTKWave", text: vcd })} className={`${btnGhost} ml-auto !h-8`} data-testid="vcd-export">
            Download VCD
          </button>
        )}
        <button type="button" onClick={() => downloadFile({ name: "test-plan.csv", mime: "text/csv", note: "Scenarios and results", text: planCsv(list) })} className={`${btnGhost} ${vcd ? "" : "ml-auto"} !h-8`} data-testid="plan-export">
          Export
        </button>
      </div>
      <div className="flex min-w-0 flex-col gap-3 @2xl:flex-row">
        <ul className="flex shrink-0 flex-col gap-1 @2xl:w-[220px]" aria-label="Scenarios">
          {list.map((x, i) => (
            <li key={x.id}>
              <button type="button" onClick={() => setSel(i)} aria-current={i === sel ? "true" : undefined} data-scenario={x.id} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] ${i === sel ? "border-signal-line bg-raised text-ink" : "border-line text-ink-2 hover:text-ink"}`}>
                <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: x.passed ? "var(--hw-ok)" : "var(--hw-bad)" }} />
                <span className="min-w-0 flex-1 truncate">{x.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1">
          <div role="tablist" aria-label="Scenario views" className="flex gap-1 border-b border-line">
            {(["description", "code", "results"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-8 border-b-2 px-3 text-[12.5px] capitalize ${tab === t ? "border-[var(--wb)] text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="pt-2.5">
            {tab === "description" && <p className="text-[12.5px] leading-snug text-ink-2">{s.description}</p>}
            {tab === "code" && <pre tabIndex={0} aria-label="Scenario code" className="scroll-quiet num overflow-auto rounded-lg bg-sunken p-2.5 text-[11.5px] leading-relaxed text-ink">{scenarioCode(s, mnemonic)}</pre>}
            {tab === "results" && (
              <table className="w-full text-left text-[12.5px]" aria-label="Scenario result">
                <thead>
                  <tr className="text-[11px] text-ink-3">
                    <th className="py-1 pr-2 font-normal">Result</th>
                    <th className="py-1 pr-2 font-normal">Hardware</th>
                    <th className="py-1 pr-2 font-normal">C reference</th>
                    <th className="py-1 font-normal">Waves</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1.5 pr-2 font-medium" style={{ color: s.passed ? "var(--hw-ok)" : "var(--hw-bad)" }}>{s.passed ? "PASSED" : "FAILED"}</td>
                    <td className="num py-1.5 pr-2 text-ink">0x{hex32(s.hardware)}</td>
                    <td className="num py-1.5 pr-2 text-ink">0x{hex32(s.reference)}</td>
                    <td className="py-1.5 text-ink-3">below</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {rtl && views.cRef && (
        <OwnPair
          name={views.name}
          rtl={rtl}
          cRef={views.cRef}
          count={extra.length}
          onResult={(row, trace) => {
            const next = customScenario(extra.length + 1, row, trace);
            setExtra((x) => [...x, next]);
            setSel(base.length + extra.length);
          }}
        />
      )}
      <div className="mt-3">
        <WaveViewer list={list} selected={sel} onSelect={setSel} />
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">Each scenario is one operand pair simulated in Verilator inside the Sandbox, next to the plain C description. The formal proof covers every possible pair, not just these.</p>
    </section>
  );
}
