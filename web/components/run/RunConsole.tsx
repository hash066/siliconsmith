"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isDemoRun, type RunController } from "@/lib/controller";
import type { NodeId } from "@/lib/events";
import { pct, times } from "@/lib/format";
import { useMediaQuery, useRunSource, useSnapshot } from "@/lib/hooks";
import { counts, wallOf, type RunState } from "@/lib/run-state";
import { DemoBadge, ThemeToggle, Wordmark } from "../site/Brand";
import { BranchTree } from "./BranchTree";
import { CostPanel } from "./CostPanel";
import { EventTicker } from "./EventTicker";
import { Inspector } from "./Inspector";
import { MetricsStrip } from "./MetricsStrip";
import { GlyphIcon } from "./NodeGlyph";
import { OutlineTree } from "./OutlineTree";
import { PlayerControls, Scrubber } from "./Player";
import type { Visual } from "./status";
import { VISUAL_LABEL } from "./status";

function Panel({ title, aside, children, className = "", bodyClass = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel ${className}`} aria-label={title}>
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <h2 className="text-[13px] font-medium text-ink">{title}</h2>
        {aside}
      </div>
      <div className={`scroll-quiet min-h-0 flex-1 overflow-auto ${bodyClass}`}>{children}</div>
    </section>
  );
}

const LEGEND: Visual[] = ["best", "feasible", "unproven", "budget", "nogain", "failed", "running"];

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[12px] text-ink-3" aria-label="Legend">
      {LEGEND.map((v) => (
        <li key={v} className="flex items-center gap-1">
          <GlyphIcon visual={v} size={8} />
          {VISUAL_LABEL[v]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="flex gap-[2px]" aria-hidden="true">
          {["var(--ink-2)", "var(--ink-2)", "var(--signal)", "var(--line)"].map((c, i) => (
            <span key={i} className="block h-2 w-1 rounded-[1px]" style={{ background: c }} />
          ))}
        </span>
        Stages: implement · lint · unit · e2e · bench · prove · synth
      </li>
    </ul>
  );
}

export function finding(s: RunState): string {
  const c = counts(s);
  const best = s.best ? s.nodes[s.best] : null;
  if (s.status === "failed") return `The run failed: ${s.error}`;
  if (s.status === "completed") {
    if (best?.score) {
      const extra = c.unproven ? ` ${c.unproven} faster candidate${c.unproven > 1 ? "s were" : " was"} not eligible: proof incomplete.` : "";
      return `${best.proposal?.mnemonic} is the best verified CPU: ${times(wallOf(best.score))} wall-clock at ${pct(best.score.area_delta_pct)} area.${extra}`;
    }
    return `No candidate beat the baseline. ${c.budget + c.nogain + c.failed} pruned; each node shows its reason.`;
  }
  if (!s.baseline) return "Building and profiling the baseline in a sandbox…";
  const depth = Math.max(0, ...s.order.map((id) => (s.nodes[id].activeStage ? s.nodes[id].depth : 0)));
  return `Searching${depth ? ` depth ${depth}${s.config ? ` of ${s.config.max_depth}` : ""}` : ""} · ${c.candidates} candidates · ${c.running} running${best?.score ? ` · best so far ${best.proposal?.mnemonic} ${times(wallOf(best.score))}` : ""}`;
}

function ConsoleBody({ c, runId, initialNode }: { c: RunController; runId: string; initialNode: string | null }) {
  const snap = useSnapshot(c)!;
  const s = snap.state;
  const wide = useMediaQuery("(min-width: 1024px)");
  const tablet = useMediaQuery("(min-width: 768px)");
  const [selected, setSelected] = useState<NodeId | null>(initialNode);
  const [follow, setFollow] = useState(!initialNode);
  const [tab, setTab] = useState<"tree" | "node" | "cost" | "log">("tree");

  // Follow mode: the inspector moves to the moments worth seeing (a counterexample, a new best).
  const followTarget = useMemo(() => {
    if (s.status === "completed" && s.best) return s.best;
    for (let i = s.markers.length - 1; i >= 0; i--) {
      const m = s.markers[i];
      if (m.nodeId && (m.kind === "best" || (m.kind === "fail" && m.label.includes("counterexample")))) return m.nodeId;
    }
    return s.rootId;
  }, [s.markers, s.rootId, s.status, s.best]);
  const shown = follow ? followTarget : selected && s.nodes[selected] ? selected : followTarget;

  const select = useCallback(
    (id: NodeId) => {
      setSelected(id);
      setFollow(false);
      if (!wide) setTab("node");
      const url = new URL(window.location.href);
      url.searchParams.set("node", id);
      window.history.replaceState(null, "", url);
    },
    [wide],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [role=slider], [contenteditable=true]")) return;
      if (e.key === " " && !el.closest("button, a")) {
        e.preventDefault();
        c.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c]);

  const demo = isDemoRun(runId);
  const reportHref = `/runs/${runId}/report`;
  const statusText = snap.mode === "live" ? "Live" : s.status === "completed" ? "Replay · completed" : s.status === "failed" ? "Replay · failed" : "Replay";
  const w = s.workload;
  const repo = w?.source_repo?.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  const hot = s.baseline?.hotspots[0]?.symbol;

  const tree = (
    <div className="graticule min-h-full px-2 py-2">
      {tablet ? <BranchTree state={s} selected={shown} onSelect={select} /> : <OutlineTree state={s} selected={shown} onSelect={select} />}
    </div>
  );
  const followBtn = (
    <button
      type="button"
      onClick={() => setFollow((f) => !f)}
      aria-pressed={follow}
      className={`h-7 rounded-md px-2 text-[12px] transition-colors duration-150 ${follow ? "bg-signal-dim text-signal-ink" : "text-ink-3 hover:text-ink"}`}
      title="Follow the notable moments (counterexamples, new bests)"
    >
      {follow ? "Following" : "Follow"}
    </button>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-0">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-5">
          <Wordmark />
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] text-ink-3 md:flex">
            <span aria-hidden="true">/</span>
            <Link href="/runs/r_mock_demo" className="hover:text-ink">
              Runs
            </Link>
            <span aria-hidden="true">/</span>
            <span className="num truncate text-ink-2" aria-current="page">
              {runId}
            </span>
          </nav>
          {demo && <DemoBadge />}
          <span className="hidden h-6 items-center rounded-full bg-raised px-2.5 text-[12px] text-ink-2 sm:inline-flex">{statusText}</span>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <div className="hidden lg:block">
              <PlayerControls c={c} snap={snap} />
            </div>
            <Link href={reportHref} className="hidden h-9 items-center rounded-md px-3 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink sm:flex">
              Report
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main" className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-4 lg:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[24px]">{w?.title ?? runId}</h1>
            <p className="mt-1 text-[13px] text-ink-3">
              {[hot && <span key="h" className="num">{hot}</span>, repo, s.backend && `${s.backend} backend`, s.config && `budget ${s.config.area_budget_pct.toFixed(1)}%`, s.config && `beam ${s.config.beam}`, s.config && `depth ≤ ${s.config.max_depth}`]
                .filter(Boolean)
                .map((x, i) => (
                  <span key={i}>
                    {i > 0 && <span aria-hidden="true"> · </span>}
                    {x}
                  </span>
                ))}
            </p>
          </div>
          <p className="max-w-[560px] text-[14px] leading-snug text-ink lg:text-right" aria-live="polite">
            {finding(s)}
          </p>
        </div>

        <div className="flex flex-col gap-2 lg:block">
          <div className="flex items-center justify-between gap-2 lg:hidden">
            <PlayerControls c={c} snap={snap} />
            <Link href={reportHref} className="inline-flex h-9 items-center rounded-md border border-line-2 px-3 text-[13px] text-ink sm:hidden">
              Report
            </Link>
          </div>
          <Scrubber c={c} snap={snap} />
        </div>

        <MetricsStrip state={s} />

        {s.warnings.length > 0 && (
          <p className="rounded-md bg-amber-dim px-3 py-2 text-[12.5px] text-amber">
            The stream deviates from the event contract in {s.warnings.length} place{s.warnings.length > 1 ? "s" : ""}: {s.warnings.slice(0, 2).join("; ")}
          </p>
        )}

        {wide ? (
          <>
            <div className="grid min-h-[560px] grid-cols-[minmax(0,1fr)_minmax(360px,400px)_280px] gap-3" style={{ height: "max(560px, calc(100dvh - 372px))" }}>
              <Panel title="Search tree" aside={<span className="num text-[12px] text-ink-3">{counts(s).candidates} candidates</span>} bodyClass="bg-sunken">
                <div className="flex min-h-full flex-col">
                  <div className="flex-1">{tree}</div>
                  <Legend />
                </div>
              </Panel>
              <Panel title="Inspector" aside={followBtn}>
                <Inspector state={s} nodeId={shown} onSelect={select} reportHref={reportHref} />
              </Panel>
              <Panel title="Cost and compute">
                <CostPanel state={s} t={snap.t} duration={snap.duration} />
              </Panel>
            </div>
            <Panel title="Events" aside={<span className="num text-[12px] text-ink-3">{s.eventCount} received</span>}>
              <EventTicker state={s} onSelect={select} rows={5} />
            </Panel>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div role="tablist" aria-label="Run views" className="grid h-11 grid-cols-4 rounded-lg border border-line bg-panel p-1">
              {(["tree", "node", "cost", "log"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`rounded-md text-[13px] transition-colors duration-150 ${tab === k ? "bg-raised text-ink" : "text-ink-3"}`}
                >
                  {k === "tree" ? "Tree" : k === "node" ? "Node" : k === "cost" ? "Cost" : "Events"}
                </button>
              ))}
            </div>
            {tab === "tree" && (
              <Panel title="Search tree" bodyClass="bg-sunken" aside={<span className="num text-[12px] text-ink-3">{counts(s).candidates} candidates</span>}>
                {tree}
                <Legend />
              </Panel>
            )}
            {tab === "node" && (
              <Panel title="Inspector" aside={followBtn}>
                <Inspector state={s} nodeId={shown} onSelect={select} reportHref={reportHref} />
              </Panel>
            )}
            {tab === "cost" && (
              <Panel title="Cost and compute">
                <CostPanel state={s} t={snap.t} duration={snap.duration} />
              </Panel>
            )}
            {tab === "log" && (
              <Panel title="Events">
                <EventTicker state={s} onSelect={select} rows={14} />
              </Panel>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export function RunConsole({ runId, initialNode, start, speed }: { runId: string; initialNode: string | null; start?: number | "end"; speed?: number }) {
  const src = useRunSource(runId, { autoplay: start !== "end", speed: speed ?? 8, start: start ?? 0 });
  if (src.status === "ready") return <ConsoleBody c={src.controller} runId={runId} initialNode={initialNode} />;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-line px-4 lg:px-5">
        <Wordmark />
        <span className="num text-[13px] text-ink-3">/ runs / {runId}</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="grid flex-1 place-items-center px-4">
        {src.status === "loading" ? (
          <p className="text-[13px] text-ink-3" role="status">
            Loading run {runId}…
          </p>
        ) : (
          <div className="max-w-md text-center">
            <h1 className="text-[22px] font-semibold text-ink">Run {runId} is not available</h1>
            <p className="mt-2 text-[14px] text-ink-2">{src.reason}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Link href="/runs/r_mock_demo" className="inline-flex h-10 items-center rounded-md bg-signal px-4 text-[14px] font-medium text-on-signal">
                Watch the demo run
              </Link>
              <Link href="/runs/r_m4_first" className="inline-flex h-10 items-center rounded-md border border-line-2 px-4 text-[14px] text-ink">
                First real engine run
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
