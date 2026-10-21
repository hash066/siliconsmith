"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isDemoRun } from "@/lib/controller";
import type { NodeId } from "@/lib/events";
import { duration, int, mhz, pct, times, tokens, usd } from "@/lib/format";
import { useRunSource, useSnapshot } from "@/lib/hooks";
import { counts, frontier, lineage, wallOf, type NodeState, type RunState } from "@/lib/run-state";
import { BeforeAfter, type Pair } from "../charts/BeforeAfter";
import { Pareto, ParetoLegend } from "../charts/Pareto";
import { DemoBadge, ThemeToggle, Wordmark } from "../site/Brand";
import { Code } from "../ui/Code";
import { Ladder } from "../run/Ladder";
import { GlyphIcon } from "../run/NodeGlyph";
import { finding } from "../run/RunConsole";
import { rowValue, TONE_VAR, visualOf, VISUAL_LABEL } from "../run/status";
import { Waveform } from "../run/Waveform";

function H2({ id, children, sub }: { id: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-5 max-w-[720px]">
      <h2 id={id} className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
        {children}
      </h2>
      {sub && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{sub}</p>}
    </div>
  );
}

function useBlobUrl(text: string | undefined, type: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return setUrl(null);
    const u = URL.createObjectURL(new Blob([text], { type }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [text, type]);
  return url;
}

function Download({ name, text, type = "text/plain" }: { name: string; text?: string; type?: string }) {
  const url = useBlobUrl(text, type);
  if (!text || !url) return null;
  return (
    <li className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
      <span className="num min-w-0 truncate text-[13px] text-ink">{name}</span>
      <span className="num shrink-0 text-[12px] text-ink-3">{(new Blob([text]).size / 1024).toFixed(1)} KB</span>
      <a href={url} download={name} className="inline-flex h-9 shrink-0 items-center rounded-md border border-line-2 px-3 text-[13px] text-ink transition-colors hover:bg-raised">
        Download
      </a>
    </li>
  );
}

function InstructionCard({ n }: { n: NodeState }) {
  const p = n.proposal!;
  const funct7 = n.instructionSet.indexOf(p.mnemonic);
  return (
    <article className="rounded-lg border border-line bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h3 className="num text-[24px] font-medium tracking-[-0.02em] text-ink">{p.mnemonic}</h3>
          <p className="text-[14px] text-ink-2">{p.title}</p>
        </div>
        <p className="num text-[12px] text-ink-3">.insn r 0x0B, 0, {funct7}, rd, rs1, rs2 · custom-0</p>
      </header>
      <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <dl className="grid grid-cols-3 gap-3 text-[13px]">
            {(["rs1", "rs2", "rd"] as const).map((k) => (
              <div key={k}>
                <dt className="num text-[12px] text-ink-3">{k}</dt>
                <dd className="num text-ink">{p.operands[k] || "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13.5px] leading-relaxed text-ink-2">{p.rationale}</p>
          <p className="mt-2 text-[12px] text-ink-3">Proposed by Nemotron Ultra as architect; implemented and repaired by Nemotron Super.</p>
        </div>
        <div>
          <p className="mb-2 text-[12px] text-ink-3">Semantics: the C reference every rung checks against</p>
          <Code code={n.artifacts.c_ref ?? p.semantics_c} lang="c" maxHeight={240} />
        </div>
      </div>
      {n.artifacts.rtl && (
        <details className="group border-t border-line px-5 py-3">
          <summary className="flex h-8 cursor-pointer list-none items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
            <span className="transition-transform duration-150 group-open:rotate-90" aria-hidden="true">
              ›
            </span>
            Verilog ({n.artifacts.rtl.split("\n").length} lines)
          </summary>
          <div className="mt-2">
            <Code code={n.artifacts.rtl} lang="verilog" maxHeight={420} />
          </div>
        </details>
      )}
    </article>
  );
}

function CandidateTable({ s, onSelectHref }: { s: RunState; onSelectHref: (id: NodeId) => string }) {
  const rows = s.order.filter((id) => s.nodes[id].parentId !== null);
  return (
    <div className="scroll-quiet overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="w-full min-w-[760px] text-[13px]">
        <caption className="sr-only">Every candidate CPU in the search, with its outcome</caption>
        <thead>
          <tr className="text-left text-[12px] text-ink-3">
            <th scope="col" className="px-4 py-2.5 font-normal">Candidate</th>
            <th scope="col" className="px-4 py-2.5 font-normal">Outcome</th>
            <th scope="col" className="px-4 py-2.5 text-right font-normal">Wall-clock</th>
            <th scope="col" className="px-4 py-2.5 text-right font-normal">Cycles</th>
            <th scope="col" className="px-4 py-2.5 text-right font-normal">Area Δ</th>
            <th scope="col" className="px-4 py-2.5 font-normal">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((id) => {
            const n = s.nodes[id];
            const v = visualOf(n, s);
            const val = rowValue(n, s);
            const cycles = n.score?.cycles ?? n.measured.cycles;
            const area = n.score?.area_delta_pct ?? n.measured.areaPct;
            return (
              <tr key={id} className="border-t border-line align-top">
                <td className="px-4 py-2.5">
                  <Link href={onSelectHref(id)} className="num text-ink hover:underline">
                    {n.proposal?.mnemonic}
                  </Link>
                  <span className="num ml-2 text-[12px] text-ink-3">{id}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap" style={{ color: TONE_VAR[val.tone] === "var(--ink)" ? "var(--ink-2)" : TONE_VAR[val.tone] }}>
                    <GlyphIcon visual={v} size={8} />
                    {VISUAL_LABEL[v]}
                  </span>
                </td>
                <td className="num px-4 py-2.5 text-right text-ink">{n.score ? times(wallOf(n.score)) : "—"}</td>
                <td className="num px-4 py-2.5 text-right text-ink-2">{cycles ? int(cycles) : "—"}</td>
                <td className="num px-4 py-2.5 text-right text-ink-2">{area !== undefined ? pct(area) : "—"}</td>
                <td className="max-w-[340px] px-4 py-2.5 text-[12.5px] text-ink-3">{n.pruned?.reason ?? (n.score && !n.score.feasible ? "Formal proof incomplete: evidence stays at L2" : s.best === id ? "Best verified CPU" : n.score ? "Verified; dominated by a faster or cheaper CPU" : "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportBody({ s, runId }: { s: RunState; runId: string }) {
  const best = s.best ? s.nodes[s.best] : null;
  const chain = best ? lineage(s, best.id).filter((n) => n.parentId !== null) : [];
  const points = useMemo(() => frontier(s), [s]);
  const mnemonics = useMemo(() => Object.fromEntries(s.order.map((id) => [id, s.nodes[id].proposal?.mnemonic ?? id])), [s]);
  const c = counts(s);
  const b = s.baseline;
  const sc = best?.score;
  const budget = s.config?.area_budget_pct;
  const done = s.completed;
  const nodeHref = (id: NodeId) => `/runs/${runId}?t=end&node=${encodeURIComponent(id)}`;
  const overBest = points.filter((p) => p.kind === "budget").sort((x, y) => y.wall - x.wall)[0];
  const unproven = points.filter((p) => p.kind === "unproven").sort((x, y) => y.wall - x.wall)[0];
  const cex = best?.evidence.filter((e) => e.counterexample) ?? [];

  const pairs: Pair[] = [];
  if (b && sc) {
    pairs.push({ label: "Cycles for one inference", before: b.cycles, after: sc.cycles, format: int, better: "lower" });
    pairs.push({ label: "LUTs", before: b.luts, after: sc.luts, format: int, better: "lower", note: `Area Δ in LUT-equivalents (LUT4 + ALU cells): ${pct(sc.area_delta_pct)}.` });
    if (b.fmax_mhz && sc.fmax_mhz)
      pairs.push({
        label: "Time per inference at Fmax",
        before: b.cycles / b.fmax_mhz / 1000,
        after: sc.cycles / sc.fmax_mhz / 1000,
        format: (n) => `${n.toFixed(2)} ms`,
        better: "lower",
        note: "Fmax is an estimate until nextpnr timing is wired into L5.",
      });
  }

  const summary = JSON.stringify(
    {
      run_id: runId,
      workload: s.workload,
      baseline: b && { cycles: b.cycles, luts: b.luts, ffs: b.ffs, fmax_mhz: b.fmax_mhz, output_hash: b.output_hash },
      best: best && sc ? { node_id: best.id, instruction_set: best.instructionSet, cycles: sc.cycles, speedup: sc.speedup, wall_speedup: sc.wall_speedup, area_delta_pct: sc.area_delta_pct, fmax_mhz: sc.fmax_mhz, ladder: sc.ladder } : null,
      pareto: s.pareto,
      totals: done?.totals,
      demo_data: isDemoRun(runId),
    },
    null,
    2,
  );

  return (
    <main id="main" className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
        <span>Design report</span>
        {isDemoRun(runId) && <DemoBadge />}
      </div>
      <h1 className="mt-2 max-w-[880px] text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[38px]">
        {s.workload?.title ?? runId}
      </h1>
      <p className="mt-3 max-w-[760px] text-[16px] leading-relaxed text-ink-2">{finding(s)}</p>

      <section aria-label="Result" className="mt-8 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-panel sm:grid-cols-3 lg:grid-cols-6">
        {[
          { k: "Wall-clock speedup", v: sc ? times(wallOf(sc)) : "—", lead: true },
          { k: "Cycles", v: sc ? int(sc.cycles) : b ? int(b.cycles) : "—", sub: b ? `from ${int(b.cycles)}` : undefined },
          { k: "Area Δ", v: sc ? pct(sc.area_delta_pct) : "—", sub: budget !== undefined ? `budget ${budget.toFixed(1)}%` : undefined },
          { k: "Proof", v: sc ? (sc.ladder.L3 === "pass" ? "SAT, all inputs" : "Incomplete") : "—", sub: sc ? `L1–L5 ${["L1", "L2", "L3", "L4", "L5"].every((r) => sc.ladder[r as "L1"] === "pass") ? "pass" : "partial"}` : undefined },
          { k: "Search", v: `${c.candidates} CPUs`, sub: done ? `${duration(done.totals.wall_s)} · ${int(done.totals.sandboxes)} sandbox ops` : undefined },
          { k: "Nemotron cost", v: usd(s.usage.total.costUsd, 3), sub: `${tokens(s.usage.total.tokensIn + s.usage.total.tokensOut)} tokens` },
        ].map((x, i) => (
          <div key={x.k} className={`border-line px-4 py-4 ${i > 0 ? "max-lg:border-t lg:border-l" : ""} ${i === 1 ? "max-sm:border-t-0" : ""} sm:max-lg:[&:nth-child(4)]:border-l-0`}>
            <div className="text-[12px] text-ink-3">{x.k}</div>
            <div className={`num mt-1 leading-none tracking-[-0.02em] ${x.lead ? "text-[30px] text-signal-ink" : "text-[22px] text-ink"}`}>{x.v}</div>
            {x.sub && <div className="num mt-1.5 text-[11.5px] text-ink-3">{x.sub}</div>}
          </div>
        ))}
      </section>

      <section aria-labelledby="frontier" className="mt-16">
        <H2 id="frontier" sub="Every candidate that reached synthesis, by the area it costs and the wall-clock speedup it buys. Wall-clock is cycles × Fmax, so a faster cycle count that slows the clock does not win.">
          Speedup against area
        </H2>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-line bg-panel p-4">
            <ParetoLegend />
            <div className="mt-3">
              <Pareto points={points} budget={budget} mnemonics={mnemonics} />
            </div>
          </div>
          <div className="space-y-4 text-[14px] leading-relaxed text-ink-2">
            {best && sc ? (
              <p>
                <span className="num text-signal-ink">{best.proposal?.mnemonic}</span> is the fastest CPU that passes every rung inside the {budget?.toFixed(1)}% budget:{" "}
                <span className="num text-ink">{times(wallOf(sc))}</span> at <span className="num text-ink">{pct(sc.area_delta_pct)}</span>.
              </p>
            ) : (
              <p>No candidate in this run passed every rung with a speedup over its parent.</p>
            )}
            {overBest && (
              <p>
                Past the budget line, <span className="num text-amber">{mnemonics[overBest.id]}</span> reaches <span className="num text-ink">{times(overBest.wall)}</span> at{" "}
                <span className="num text-ink">{pct(overBest.areaPct)}</span>. A budget of {Math.ceil(overBest.areaPct * 2) / 2}% would let the search keep it.
              </p>
            )}
            {unproven && (
              <p>
                <span className="num text-amber">{mnemonics[unproven.id]}</span> is faster inside the budget ({times(unproven.wall)}) but its SAT proof timed out. It is shown, not shipped: the
                evidence stops at L2.
              </p>
            )}
            <p className="text-[13px] text-ink-3">
              Over-budget points come from the cycle and area figures in their bench and synth stage details; the contract does not score pruned nodes.
            </p>
          </div>
        </div>
      </section>

      {pairs.length > 0 && best && (
        <section aria-labelledby="ba" className="mt-16 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <H2 id="ba" sub={`Baseline PicoRV32 against the CPU with ${best.instructionSet.join(" + ")}, on the same workload and inputs.`}>
              Before and after
            </H2>
            <BeforeAfter rows={pairs} beforeLabel="baseline" afterLabel={best.proposal?.mnemonic ?? best.id} />
          </div>
          <div>
            <H2 id="proofs" sub="Each claim is shown only if the rung passed. Labels follow PLAN §3.5.">
              Verification
            </H2>
            <div className="rounded-lg border border-line bg-panel px-4 py-2">
              <Ladder node={best} />
            </div>
          </div>
        </section>
      )}

      {cex.length > 0 && best && (
        <section aria-labelledby="cex" className="mt-16">
          <H2 id="cex" sub={`The first implementation passed ${b ? "every random vector" : "the unit test"}; the SAT miter found the one input it gets wrong. Super repaired it and the proof passed on the next attempt.`}>
            The bug random testing missed
          </H2>
          {cex.map((e) => (
            <div key={e.t} className="rounded-lg border border-line bg-panel p-4">
              <p className="num mb-3 text-[12.5px] text-ink-2">
                {e.stage} · attempt {e.attempt} · {e.detail}
              </p>
              <Waveform cex={e.counterexample!} />
            </div>
          ))}
        </section>
      )}

      {chain.length > 0 && (
        <section aria-labelledby="isa" className="mt-16">
          <H2 id="isa" sub="The custom instructions this CPU adds, each with the C reference it was proven against.">
            Instruction set
          </H2>
          <div className="space-y-4">
            {chain.map((n) => (
              <InstructionCard key={n.id} n={n} />
            ))}
          </div>
        </section>
      )}

      {best?.artifacts.patch_diff && (
        <section aria-labelledby="patch" className="mt-16">
          <H2 id="patch" sub="The only file the agent may rewrite. Same signature, bit-identical result.">
            Kernel patch
          </H2>
          <Code code={best.artifacts.patch_diff} lang="diff" maxHeight={520} />
        </section>
      )}

      <section aria-labelledby="deliver" className="mt-16 grid gap-8 lg:grid-cols-2">
        <div>
          <H2 id="deliver" sub="Everything the pull request carries, taken from the run's own events.">
            Deliverables
          </H2>
          <ul className="rounded-lg border border-line bg-panel px-4">
            {chain.map((n) => (
              <Download key={n.id} name={`ss_insn_${(n.proposal?.mnemonic ?? n.id).replace(/\./g, "_")}.v`} text={n.artifacts.rtl} />
            ))}
            <Download name="ss_intrinsics.h" text={best?.artifacts.intrinsic_h} />
            <Download name="tm_dot.h.patch" text={best?.artifacts.patch_diff} />
            <Download name={`${runId}.summary.json`} text={summary} type="application/json" />
          </ul>
        </div>
        <div>
          <H2 id="pr">Pull request and hardware</H2>
          <dl className="divide-y divide-line rounded-lg border border-line bg-panel px-4 text-[14px]">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-ink-2">Pull request</dt>
              <dd>
                {done?.report.pr_url ? (
                  <a href={done.report.pr_url} className="text-signal-ink hover:underline">
                    Open on GitHub
                  </a>
                ) : (
                  <span className="text-ink-3">Opened by the GitHub bot on real runs</span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-ink-2">Bundle</dt>
              <dd>
                {done?.report.bundle_url ? (
                  <a href={done.report.bundle_url} className="text-signal-ink hover:underline">
                    Download bundle
                  </a>
                ) : (
                  <span className="text-ink-3">Not uploaded for this run</span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-ink-2">FPGA (L6)</dt>
              <dd className="text-ink-3">{sc?.ladder.L6 === "pass" ? "Verified on a Tang Nano 9K" : "Not run yet"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-ink-2">Fmax</dt>
              <dd className="num text-ink-3">{sc?.fmax_mhz ? `${mhz(sc.fmax_mhz)} MHz, estimate` : "—"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="all" className="mt-16">
        <H2 id="all" sub={`${c.candidates} candidates: ${c.feasible} verified in budget, ${c.unproven} with an incomplete proof, ${c.budget} over budget, ${c.nogain} with no speedup, ${c.failed} that failed verification.`}>
          Every candidate
        </H2>
        <CandidateTable s={s} onSelectHref={nodeHref} />
      </section>
    </main>
  );
}

export function Report({ runId }: { runId: string }) {
  const src = useRunSource(runId, { start: "end", autoplay: false });
  const controller = src.status === "ready" ? src.controller : null;
  const snap = useSnapshot(controller);
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Wordmark />
          <nav aria-label="Breadcrumb" className="hidden items-center gap-2 text-[13px] text-ink-3 sm:flex">
            <span aria-hidden="true">/</span>
            <Link href={`/runs/${runId}`} className="num hover:text-ink">
              {runId}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink-2" aria-current="page">
              Report
            </span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href={`/runs/${runId}`} className="inline-flex h-9 items-center rounded-md border border-line-2 px-3 text-[13px] text-ink transition-colors hover:bg-raised">
              Run console
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      {snap ? (
        <ReportBody s={snap.state} runId={runId} />
      ) : src.status === "not-found" ? (
        <main id="main" className="mx-auto max-w-[720px] px-4 py-24 text-center">
          <h1 className="text-[22px] font-semibold text-ink">No report for {runId}</h1>
          <p className="mt-2 text-ink-2">{src.reason}</p>
          <Link href="/runs/r_mock_demo/report" className="mt-5 inline-flex h-10 items-center rounded-md bg-signal px-4 text-[14px] font-medium text-on-signal">
            Open the demo report
          </Link>
        </main>
      ) : (
        <main id="main" className="px-4 py-24 text-center text-[13px] text-ink-3" role="status">
          Loading report…
        </main>
      )}
    </div>
  );
}
