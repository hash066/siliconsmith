"use client";

import { useEffect, useMemo, useState } from "react";
import type { NodeId } from "@/lib/events";
import { int, mhz, pct, times, tokens, usd } from "@/lib/format";
import type { CodeLang } from "@/lib/highlight";
import { lineage, wallOf, type NodeState, type RunState } from "@/lib/run-state";
import { Code } from "../ui/Code";
import { Ladder } from "./Ladder";
import { GlyphIcon } from "./NodeGlyph";
import { visualOf, VISUAL_LABEL } from "./status";
import { Waveform } from "./Waveform";

type Tab = "rtl" | "c_ref" | "intrinsic_h" | "patch_diff" | "log";
const TABS: Array<{ id: Tab; label: string; lang: CodeLang }> = [
  { id: "rtl", label: "Verilog", lang: "verilog" },
  { id: "c_ref", label: "C reference", lang: "c" },
  { id: "intrinsic_h", label: "Intrinsic", lang: "c" },
  { id: "patch_diff", label: "Patch diff", lang: "diff" },
  { id: "log", label: "Logs", lang: "text" },
];

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-4 first:border-t-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-medium text-ink-2">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "signal" | "amber" | "red" }) {
  const color = tone === "signal" ? "var(--signal-ink)" : tone === "amber" ? "var(--amber)" : tone === "red" ? "var(--red)" : "var(--ink)";
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="num mt-0.5 truncate text-[16px]" style={{ color }}>
        {value}
      </div>
      {sub && <div className="num truncate text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

function CodeTabs({ node }: { node: NodeState }) {
  const attempts = Object.keys(node.artifactsByAttempt).map(Number).sort((a, b) => a - b);
  const [attempt, setAttempt] = useState<number | null>(null);
  const shownAttempt = attempt ?? attempts.at(-1) ?? 0;
  const art = node.artifactsByAttempt[shownAttempt] ?? node.artifacts;
  const logs = node.evidence.filter((e) => e.log);
  const available = TABS.filter((t) => (t.id === "log" ? logs.length > 0 : !!art[t.id as Exclude<Tab, "log">]));
  const [tab, setTab] = useState<Tab>("rtl");
  const current = available.find((t) => t.id === tab) ?? available[0];
  useEffect(() => setAttempt(null), [node.id]);

  if (!available.length) return <p className="text-[13px] text-ink-3">No code yet. Super writes the RTL, C reference, intrinsic and patch in the implement stage.</p>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Generated artifacts" className="flex flex-wrap gap-1">
          {available.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={current?.id === t.id}
              onClick={() => setTab(t.id)}
              className={`h-8 rounded-md px-2.5 text-[12.5px] transition-colors duration-150 ${current?.id === t.id ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line-2)]" : "text-ink-3 hover:text-ink"}`}
            >
              {t.label}
              {t.id === "log" && <span className="num ml-1 text-red">{logs.length}</span>}
            </button>
          ))}
        </div>
        {attempts.length > 1 && current?.id !== "log" && (
          <label className="flex items-center gap-2 text-[12px] text-ink-3">
            Attempt
            <select
              value={shownAttempt}
              onChange={(e) => setAttempt(Number(e.target.value))}
              className="num h-8 rounded-md border border-line-2 bg-panel px-2 text-[12px] text-ink"
            >
              {attempts.map((a) => (
                <option key={a} value={a}>
                  {a === 0 ? "0 · first try" : `${a} · repair`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {current?.id === "log" ? (
        <div className="space-y-3">
          {logs.map((l, i) => (
            <div key={i}>
              <div className="num mb-1 text-[11.5px] text-ink-3">
                {l.stage} · attempt {l.attempt}
              </div>
              <Code code={l.log!} lang="text" maxHeight={260} label={`${l.stage} log, attempt ${l.attempt}`} />
            </div>
          ))}
        </div>
      ) : current ? (
        <Code code={art[current.id as Exclude<Tab, "log">]!} lang={current.lang} maxHeight={380} label={`${current.label}, attempt ${shownAttempt}`} />
      ) : null}
    </div>
  );
}

function Baseline({ state, node }: { state: RunState; node: NodeState }) {
  const b = state.baseline;
  return (
    <>
      <Section title="Baseline CPU">
        <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
          PicoRV32 (rv32im, fast multiplier) running {state.workload?.title ?? "the workload"} unmodified. Every candidate is a branch forked from this
          checkpoint.
        </p>
        {b ? (
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            <Figure label="Cycles" value={int(b.cycles)} />
            <Figure label="LUTs" value={int(b.luts)} />
            <Figure label="FFs" value={int(b.ffs)} />
            <Figure label="Cells" value={int(b.cells)} />
            <Figure label="Fmax" value={b.fmax_mhz === null ? "—" : `${mhz(b.fmax_mhz)} MHz`} sub={b.fmax_mhz === null ? "not measured" : undefined} />
            <Figure label="Output hash" value={b.output_hash} />
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">Building and profiling the baseline…</p>
        )}
      </Section>
      {b && b.hotspots.length > 0 && (
        <Section title="Where the cycles go">
          <ul className="space-y-2.5">
            {b.hotspots.slice(0, 5).map((h) => (
              <li key={`${h.symbol}${h.line_start}`}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="num min-w-0 truncate text-ink">
                    {h.symbol}
                    <span className="ml-2 text-ink-3">
                      {h.file}:{h.line_start}–{h.line_end}
                    </span>
                  </span>
                  <span className="num text-ink">{h.pct.toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-raised">
                  <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0.6, h.pct)}%`, background: h === b.hotspots[0] ? "var(--signal)" : "var(--ink-3)" }} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Notes node={node} />
    </>
  );
}

function Notes({ node }: { node: NodeState }) {
  if (!node.notes.length) return null;
  return (
    <Section title="Ultra's analysis">
      <div className="space-y-2">
        {node.notes.map((n, i) => (
          <p key={i} className={`text-[13px] leading-relaxed ${n.level === "warn" ? "text-amber" : "text-ink-2"}`}>
            {n.msg.replace(/^Ultra on [\w.]+:\s*/, "")}
          </p>
        ))}
      </div>
    </Section>
  );
}

export function Inspector({ state, nodeId, onSelect, reportHref }: { state: RunState; nodeId: NodeId | null; onSelect: (id: NodeId) => void; reportHref?: string }) {
  const node = nodeId ? state.nodes[nodeId] : null;
  const chain = useMemo(() => (node ? lineage(state, node.id) : []), [state, node]);
  if (!node) {
    return <div className="p-6 text-[13px] text-ink-3">Select a node in the tree to inspect it.</div>;
  }
  const visual = visualOf(node, state);
  const isRoot = node.parentId === null;
  const p = node.proposal;
  const sc = node.score;
  const cex = node.evidence.filter((e) => e.counterexample).at(-1);
  const budget = state.config?.area_budget_pct;
  const funct7 = p ? node.instructionSet.indexOf(p.mnemonic) : -1;
  const repairedCex = cex && node.stages.prove && node.stages.prove.attempt > cex.attempt && node.stages.prove.status === "pass";

  return (
    <div>
      <header className="px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
          <nav aria-label="Node lineage" className="num flex flex-wrap items-center gap-1">
            {chain.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">/</span>}
                {c.id === node.id ? (
                  <span className="text-ink">{c.id}</span>
                ) : (
                  <button type="button" onClick={() => onSelect(c.id)} className="underline-offset-2 hover:text-ink hover:underline">
                    {c.id}
                  </button>
                )}
              </span>
            ))}
          </nav>
          <span aria-hidden="true">·</span>
          <span>depth {node.depth}</span>
        </div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="num truncate text-[26px] font-medium leading-tight tracking-[-0.02em] text-ink">{isRoot ? "baseline" : p?.mnemonic}</h2>
            <p className="mt-0.5 text-[14px] text-ink-2">{isRoot ? "PicoRV32, no custom instructions" : p?.title}</p>
          </div>
          <span
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px]"
            style={{
              background: visual === "best" || visual === "running" ? "var(--signal-dim)" : visual === "failed" ? "var(--red-dim)" : visual === "budget" || visual === "unproven" || visual === "repairing" ? "var(--amber-dim)" : "var(--raised)",
              color: visual === "best" || visual === "running" ? "var(--signal-ink)" : visual === "failed" ? "var(--red)" : visual === "budget" || visual === "unproven" || visual === "repairing" ? "var(--amber)" : "var(--ink-2)",
            }}
          >
            <GlyphIcon visual={visual} size={8} />
            {VISUAL_LABEL[visual]}
          </span>
        </div>
        {node.pruned && (
          <p className={`mt-3 rounded-md px-3 py-2 text-[13px] leading-relaxed ${node.pruned.kind === "failed" ? "bg-red-dim text-red" : node.pruned.kind === "budget" ? "bg-amber-dim text-amber" : "bg-raised text-ink-2"}`}>
            <span className="font-medium">Pruned.</span> {node.pruned.reason}
          </p>
        )}
        {sc && !sc.feasible && (
          <p className="mt-3 rounded-md bg-amber-dim px-3 py-2 text-[13px] leading-relaxed text-amber">
            <span className="font-medium">Not eligible.</span>{" "}
            {sc.ladder.L3 !== "pass" ? "Its formal proof did not complete, so the evidence stays at L2. SiliconSmith does not ship it as proven." : "It does not pass every rung within the area budget."}
          </p>
        )}
      </header>

      {isRoot ? (
        <Baseline state={state} node={node} />
      ) : (
        <>
          {sc && (
            <Section title="Measured" aside={reportHref && state.best === node.id ? <a href={reportHref} className="text-[12px] text-signal-ink hover:underline">Open report</a> : undefined}>
              <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                <Figure label="Wall-clock" value={times(wallOf(sc))} tone={state.best === node.id ? "signal" : undefined} sub={sc.fmax_mhz === null ? "cycles only, Fmax —" : "cycles × Fmax"} />
                <Figure label="Cycles" value={int(sc.cycles)} sub={`${times(sc.speedup)} fewer`} />
                <Figure label="Area Δ" value={pct(sc.area_delta_pct)} sub={budget !== undefined ? `budget ${budget.toFixed(1)}%` : undefined} tone={budget !== undefined && sc.area_delta_pct > budget ? "amber" : undefined} />
                <Figure label="LUTs" value={int(sc.luts)} />
                <Figure label="FFs" value={int(sc.ffs)} />
                <Figure label="Fmax" value={sc.fmax_mhz === null ? "—" : `${mhz(sc.fmax_mhz)} MHz`} sub={sc.fmax_mhz === null ? "not measured" : node.timing ? `median of ${node.timing.seeds} seeds · base ${state.baseline?.fmax_mhz ? mhz(state.baseline.fmax_mhz) : "—"}` : state.baseline?.fmax_mhz ? `base ${mhz(state.baseline.fmax_mhz)}` : undefined} />
              </div>
            </Section>
          )}
          {!sc && node.measured.cycles && (
            <Section title={node.pruned ? "Measured before pruning" : "Measured so far"}>
              <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                <Figure label="Cycles" value={int(node.measured.cycles)} sub={state.baseline ? `${times(state.baseline.cycles / node.measured.cycles)} fewer` : undefined} />
                {node.measured.areaPct !== undefined && <Figure label="Area Δ" value={pct(node.measured.areaPct)} tone={budget !== undefined && node.measured.areaPct > budget ? "amber" : undefined} sub={budget !== undefined ? `budget ${budget.toFixed(1)}%` : undefined} />}
                {node.measured.luts !== undefined && <Figure label="LUTs" value={int(node.measured.luts)} />}
              </div>
            </Section>
          )}

          <Section title="Verification ladder">
            <Ladder node={node} />
          </Section>

          {cex?.counterexample && (
            <Section
              title="Counterexample"
              aside={<span className={`text-[12px] ${repairedCex ? "text-signal-ink" : "text-red"}`}>{repairedCex ? `found at attempt ${cex.attempt}, repaired` : `attempt ${cex.attempt}`}</span>}
            >
              {cex.detail && <p className="num mb-3 text-[12px] leading-relaxed text-ink-2">{cex.detail}</p>}
              <Waveform cex={cex.counterexample} />
            </Section>
          )}

          {p && (
            <Section title="Instruction">
              <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-[13px]">
                {(["rs1", "rs2", "rd"] as const).map((k) => (
                  <div key={k} className="min-w-0">
                    <dt className="num text-[12px] text-ink-3">{k}</dt>
                    <dd className="num truncate text-ink" title={p.operands[k]}>
                      {p.operands[k] || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="num mt-3 text-[12px] text-ink-3">
                custom-0 · .insn r 0x0B, 0, {funct7 >= 0 ? funct7 : "?"} · CPU carries {node.instructionSet.join(", ")}
              </p>
              <blockquote className="mt-3 border-l-2 border-line-2 pl-3 text-[13px] leading-relaxed text-ink-2">
                {p.rationale}
                <footer className="mt-1 text-[12px] text-ink-3">{p.kind === "area" || p.kind === "software" ? "Nemotron Super, polish" : "Nemotron Ultra, architect"}</footer>
              </blockquote>
              {(p.est_speedup !== undefined || p.est_area_pct !== undefined) && (
                <p className="num mt-3 text-[12px] text-ink-3">
                  Estimated {times(p.est_speedup ?? null, 1)} at {pct(p.est_area_pct ?? null, 1)}
                  {sc ? ` · measured ${times(sc.speedup)} at ${pct(sc.area_delta_pct)}` : node.measured.cycles && state.baseline ? ` · measured ${times(state.baseline.cycles / node.measured.cycles)}` : ""}
                </p>
              )}
            </Section>
          )}

          <Section title="Generated code">
            <CodeTabs key={node.id} node={node} />
          </Section>

          <Notes node={node} />

          <Section title="Resources">
            <p className="num text-[12.5px] leading-relaxed text-ink-2">
              {node.usage.calls} Nemotron calls · {tokens(node.usage.tokensIn + node.usage.tokensOut)} tokens · {usd(node.usage.costUsd)}
              <br />
              {node.sandbox.total} sandbox ops{node.sandbox.failed ? ` · ${node.sandbox.failed} failed` : ""}
              {node.sandbox.active ? ` · ${node.sandbox.active} running` : ""} · {node.attempt + 1} attempt{node.attempt ? "s" : ""}
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
