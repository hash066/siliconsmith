"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayOptions } from "@/lib/controller";
import { allPass, rungsOf } from "@/lib/domain";
import { buildEvidence, buildRungEvidence, type EvidenceMetric } from "@/lib/evidence";
import { usd } from "@/lib/format";
import { useMediaQuery, useRunSource, useSnapshot } from "@/lib/hooks";
import { initialRunState } from "@/lib/run-state";
import { fetchAgentStatus, httpAgentTransport, type AgentStatus } from "@/lib/agent-client";
import { AgentPanel } from "../agent/AgentPanel";
import { EvidencePanel } from "../evidence/EvidencePanel";
import { BoardCanvas } from "../domain/BoardCanvas";
import { MatterCanvas } from "../domain/MatterCanvas";
import type { RungSelection } from "../domain/RungMatrix";
import { CostPanel } from "../run/CostPanel";
import { EventTicker } from "../run/EventTicker";
import { RunCanvas, useRunFocus } from "../run/RunConsole";
import { ThemeToggle, Wordmark } from "../site/Brand";
import { BoardCheckPanel, type DrawerRef } from "../domain/BoardCheckPanel";
import { MatterSimulatePanel } from "../domain/MatterSimulatePanel";
import type { Workbench } from "./NotBuilt";
import { ProjectRail, type RunIndexEntry } from "./ProjectRail";

const DEFAULT_RUN = "r_w1_contree3";
const WORKBENCHES: Array<{ id: Workbench; label: string }> = [
  { id: "silicon", label: "Silicon" },
  { id: "board", label: "Board" },
  { id: "matter", label: "Matter" },
];
type MobileTab = "canvas" | "agent" | "project" | "drawer";
type Sel = { kind: "metric"; metric: EvidenceMetric; nodeId: string } | { kind: "rung"; nodeId: string; rung: string } | { kind: "direct"; ref: DrawerRef };
type DrawerTab = "events" | "evidence" | "cost";

const EMPTY = initialRunState();

/** `?t=end` and `?speed=N` work like they do on the run page; the markup never depends on them. */
function replayOptions(): ReplayOptions {
  if (typeof window === "undefined") return { autoplay: true, speed: 8, start: 0 };
  const q = new URLSearchParams(window.location.search);
  const t = q.get("t");
  const speed = Number(q.get("speed"));
  return { autoplay: t !== "end", speed: [1, 2, 4, 8, 16].includes(speed) ? speed : 8, start: t === "end" ? "end" : t && Number.isFinite(Number(t)) ? Number(t) * 1000 : 0 };
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading the run">
      <div className="h-6 w-2/3 rounded bg-raised" />
      <div className="h-24 rounded-lg border border-line bg-panel" />
      <div className="h-[420px] rounded-lg border border-line bg-panel" />
    </div>
  );
}

export function Workstation({ runs }: { runs: RunIndexEntry[] }) {
  const [runId, setRunId] = useState(DEFAULT_RUN);
  const [wb, setWb] = useState<Workbench>("silicon");
  // Board and Matter each have a live tool (hosted, deterministic) and, when a replay of that domain is installed, a recorded run.
  const [view, setView] = useState<"tool" | "run">("tool");
  const [mobileTab, setMobileTab] = useState<MobileTab>("canvas");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("events");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [sel, setSel] = useState<Sel | null>(null);
  const [opts] = useState(replayOptions);
  const [agent, setAgent] = useState<AgentStatus>({ connected: false });
  useEffect(() => {
    const ctl = new AbortController();
    void fetchAgentStatus(ctl.signal).then(setAgent);
    return () => ctl.abort();
  }, []);

  const runRef = useRef(runId);
  runRef.current = runId;
  const transport = useMemo(() => (agent.connected ? httpAgentTransport(() => runRef.current) : null), [agent.connected]);
  const src = useRunSource(runId, opts);
  const controller = src.status === "ready" ? src.controller : null;
  const snap = useSnapshot(controller);
  const s = snap?.state ?? EMPTY;
  const lg = useMediaQuery("(min-width: 1024px)");
  const focus = useRunFocus(s, { wide: lg, initialNode: null, syncUrl: false });

  const evidence = useMemo(() => {
    if (!sel) return null;
    if (sel.kind === "direct") return sel.ref;
    const mode = snap?.mode ?? "replay";
    return sel.kind === "metric" ? buildEvidence(s, sel.nodeId, sel.metric, mode) : buildRungEvidence(s, sel.nodeId, sel.rung, mode);
  }, [s, sel, snap?.mode]);
  const reveal = () => {
    setDrawerTab("evidence");
    setDrawerOpen(true);
    setMobileTab("drawer");
  };
  const openEvidence = (metric: EvidenceMetric) => {
    if (!s.best) return;
    setSel({ kind: "metric", metric, nodeId: s.best });
    reveal();
  };
  const openDirect = (ref: DrawerRef) => {
    setSel({ kind: "direct", ref });
    reveal();
  };
  const openRung = (r: RungSelection) => {
    setSel({ kind: "rung", ...r });
    reveal();
  };
  const pickRunRef = useRef<(id: string) => void>(() => {});
  const chooseWbRef = useRef<(w: Workbench) => void>(() => {});
  const domainOf = (id: string) => runs.find((r) => r.id === id)?.domain ?? "silicon";
  const pickRun = (id: string) => {
    if (id === runId) return;
    setRunId(id);
    setSel(null);
    const d = domainOf(id);
    setWb(d === "board" || d === "matter" ? d : "silicon");
    setView("run");
    setMobileTab("canvas");
  };
  pickRunRef.current = pickRun;
  chooseWbRef.current = (w) => chooseWb(w);
  // A workbench tab opens that workbench's live tool; a recorded run of the domain is one click away when the replays hold one.
  const chooseWb = (w: Workbench) => {
    setWb(w);
    setView("tool");
    setSel(null);
    const first = runs.find((r) => r.domain === w);
    if (first && domainOf(runId) !== w) {
      setRunId(first.id);
      setSel(null);
    }
  };
  // `?run=<id>` opens that recorded run (used by the templates page); applied after mount so the markup matches the server's.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("run");
    const w = q.get("wb");
    if (id && runs.some((r) => r.id === id)) pickRunRef.current(id);
    else if (w === "board" || w === "matter") chooseWbRef.current(w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const wbHasRun = (w: Workbench) => runs.some((r) => r.domain === w);

  // Board and Matter tools call free hosted functions: no run, no replay and no model cost behind them.
  const toolView = wb !== "silicon" && view === "tool";
  const status = toolView ? "Hosted tool · no model" : !snap ? "Loading" : snap.mode === "live" ? "Live" : s.status === "completed" ? "Replay · completed" : s.status === "failed" ? "Replay · failed" : "Replay · playing";
  const projectName = toolView ? (wb === "board" ? "Board · live design check" : "Matter · live plate simulation") : s.workload?.title ?? (src.status === "not-found" ? "Run not available" : "Loading…");
  const rungList = rungsOf(s);
  const verified = Object.values(s.nodes).filter((n) => n.parentId !== null && (s.domain === "silicon" ? n.score?.feasible : allPass(n, rungList))).length;

  const show = (t: MobileTab) => (mobileTab === t ? "flex" : "hidden lg:flex");
  const drawerTabs: Array<[DrawerTab, string]> = [
    ["events", "Events"],
    ["evidence", "Evidence"],
    ["cost", "Cost"],
  ];

  return (
    <div className="flex min-h-dvh min-w-0 flex-col lg:h-dvh lg:overflow-hidden">
      <header className="z-30 shrink-0 border-b border-line bg-bg">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 lg:h-14 lg:flex-nowrap lg:py-0">
          <Wordmark href="/" />
          <div className="hidden min-w-0 flex-col leading-tight xl:flex">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Project</span>
            <span className="max-w-[260px] truncate text-[13px] text-ink">{projectName}</span>
          </div>
          <div role="tablist" aria-label="Workbench" className="order-last flex h-9 w-full min-w-0 rounded-lg border border-line bg-panel p-0.5 lg:order-none lg:ml-2 lg:w-auto">
            {WORKBENCHES.map((w) => (
              <button
                key={w.id}
                type="button"
                role="tab"
                aria-selected={wb === w.id}
                aria-label={w.label}
                onClick={() => chooseWb(w.id)}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] transition-colors duration-150 lg:flex-none ${wb === w.id ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="inline-flex h-6 min-w-0 items-center gap-1.5 truncate rounded-full bg-raised px-2.5 text-[12px] text-ink-2" role="status" aria-label="Run status">
              {status}
              {!toolView && snap && s.status === "completed" && <span className="num hidden text-ink-3 sm:inline">· {verified} verified</span>}
            </span>
            <div className="flex shrink-0 flex-col items-end leading-none" title={toolView ? "Board checks and Matter simulations call no model" : "LLM spend recorded in this run's events"}>
              <span className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Cost</span>
              <span className="num mt-0.5 text-[13px] text-ink" data-testid="cost-meter">{toolView ? "$0.00" : snap ? usd(s.usage.total.costUsd) : "—"}</span>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div role="tablist" aria-label="Workstation panels" className="grid h-11 shrink-0 grid-cols-4 border-b border-line bg-panel p-1 lg:hidden">
        {(
          [
            ["canvas", "Canvas"],
            ["agent", "Agent"],
            ["project", "Project"],
            ["drawer", "Evidence"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={mobileTab === k} onClick={() => setMobileTab(k)} className={`min-w-0 rounded-md text-[13px] transition-colors duration-150 ${mobileTab === k ? "bg-raised text-ink" : "text-ink-3"}`}>
            {label}
          </button>
        ))}
      </div>

      <div
        className={`min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[184px_minmax(0,1fr)_300px] xl:grid-cols-[208px_minmax(0,1fr)_340px] [&>*]:min-w-0 ${mobileTab === "drawer" ? "hidden lg:grid" : "grid"}`}
      >
        <aside className={`scroll-quiet min-h-0 flex-col border-line bg-panel lg:overflow-y-auto lg:border-r ${show("project")}`}>
          <ProjectRail runs={runs} runId={runId} onPickRun={pickRun} state={snap && !toolView ? s : null} toolView={toolView ? wb : null} />
        </aside>

        <main id="main" className={`scroll-quiet min-h-0 flex-col px-4 py-4 lg:overflow-y-auto lg:px-5 ${show("canvas")}`}>
          {wb !== "silicon" && (
            <div role="tablist" aria-label={`${wb} views`} className="mb-3 flex h-9 w-fit rounded-lg border border-line bg-panel p-0.5">
              {(
                [
                  ["tool", wb === "board" ? "Check your design" : "Simulate"],
                  ["run", "Recorded run"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={view === k}
                  onClick={() => {
                    setView(k);
                    setSel(null);
                    if (k === "run") {
                      const first = runs.find((r) => r.domain === wb);
                      if (first && domainOf(runId) !== wb) setRunId(first.id);
                    }
                  }}
                  className={`rounded-md px-3 text-[13px] transition-colors duration-150 ${view === k ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {wb === "board" && view === "tool" ? (
            <BoardCheckPanel onEvidence={openDirect} />
          ) : wb === "matter" && view === "tool" ? (
            <MatterSimulatePanel onEvidence={openDirect} />
          ) : wb !== "silicon" && !wbHasRun(wb) ? (
            <section className="max-w-md" role="status">
              <h2 className="text-[16px] font-semibold text-ink">No recorded {wb === "board" ? "Board" : "Matter"} run is installed</h2>
              <p className="mt-1.5 text-[13px] leading-snug text-ink-3">Recorded agent runs appear here when a replay of this workbench is added to the deployment. The live tool in the other tab works without one.</p>
            </section>
          ) : src.status === "loading" ? (
            <Skeleton />
          ) : src.status === "not-found" ? (
            <section className="max-w-md" role="alert">
              <h2 className="text-[18px] font-semibold text-ink">Run {runId} is not available</h2>
              <p className="mt-2 text-[14px] text-ink-2">{src.reason}</p>
              <button type="button" onClick={() => pickRun(DEFAULT_RUN)} className="mt-4 inline-flex h-10 items-center rounded-md bg-signal px-4 text-[14px] font-medium text-on-signal">
                Open the W1 replay
              </button>
            </section>
          ) : (
            snap &&
            controller &&
            (s.domain === "board" ? (
              <BoardCanvas c={controller} snap={snap} sel={sel?.kind === "rung" ? sel : null} onSelect={openRung} />
            ) : s.domain === "matter" ? (
              <MatterCanvas c={controller} snap={snap} sel={sel?.kind === "rung" ? sel : null} onSelect={openRung} />
            ) : (
              <RunCanvas embedded c={controller} snap={snap} focus={focus} reportHref={`/runs/${runId}/report`} onEvidence={openEvidence} />
            ))
          )}
        </main>

        <aside className={`min-h-[70dvh] flex-col border-line bg-panel lg:min-h-0 lg:border-l ${show("agent")}`}>
          <AgentPanel
            transport={transport}
            limitsNote={agent.limits ? `Read-only: it looks up recorded runs and the evidence library, and runs the free Board and Matter checks. Up to ${agent.limits.visitorTurnsPerDay} turns per visitor per day and ${agent.limits.maxInputChars} characters per message. Limits are counted in server memory (per instance), so they reset on restart.` : undefined}
            context={toolView ? `${wb} live tool (no recorded run)` : snap ? `${runId} · ${s.eventCount} events received` : undefined} />
        </aside>
      </div>

      <section
        aria-label="Timeline and evidence"
        className={`shrink-0 flex-col border-t border-line bg-panel ${mobileTab === "drawer" ? "flex" : "hidden lg:flex"}`}
      >
        <div className="flex h-10 items-center gap-1 border-b border-line px-3">
          <div role="tablist" aria-label="Drawer" className="flex gap-1">
            {drawerTabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={drawerTab === k}
                onClick={() => {
                  setDrawerTab(k);
                  setDrawerOpen(true);
                }}
                className={`h-8 rounded-md px-3 text-[13px] transition-colors duration-150 ${drawerTab === k ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
              >
                {label}
                {k === "evidence" && evidence && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle" aria-label="a number is selected" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-expanded={drawerOpen}
            className="ml-auto hidden h-8 rounded-md px-2 text-[12px] text-ink-3 hover:text-ink lg:block"
          >
            {drawerOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        <div className={`scroll-quiet overflow-y-auto ${drawerOpen ? (drawerTab === "evidence" ? "lg:h-[236px]" : "lg:h-[190px]") : "hidden lg:hidden"}`}>
          {drawerTab === "events" && <EventTicker state={s} onSelect={focus.select} rows={7} />}
          {drawerTab === "evidence" && <EvidencePanel evidence={evidence} artifacts={s.artifacts} onClear={() => setSel(null)} />}
          {drawerTab === "cost" && snap && <CostPanel state={s} t={snap.t} duration={snap.duration} />}
          {drawerTab === "cost" && !snap && <p className="px-4 py-3 text-[13px] text-ink-3">Cost appears when a run is loaded.</p>}
        </div>
      </section>

    </div>
  );
}
