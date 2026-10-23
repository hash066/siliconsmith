"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WORKBENCHES, type WorkbenchId } from "@/lib/brand";
import type { UiAction, UiActionResult } from "@/lib/agent-actions";
import { fromSearch, toHref } from "@/lib/deeplink";
import { MATTER_GENERATORS, type MatterGenerator } from "@/lib/hosted";
import type { AgentContext } from "../agent";
import { AgentSlot } from "./AgentSlot";
import { BoardCanvasView, BoardInputs } from "./BoardBench";
import { EvidenceDock, type AnyEvidence } from "./EvidenceDock";
import { MatterCanvasView, MatterInputs } from "./MatterBench";
import { RunsOverlay, SettingsOverlay, type HistoryItem } from "./Overlays";
import { Pane, Splitter, usePaneLayout } from "./Panes";
import { Sidebar, type Overlay } from "./Sidebar";
import { DEFAULT_RUN, SILICON_RUNS, SiliconCanvasView, SiliconInputs, useSiliconBench, type RunIndexEntry } from "./SiliconBench";
import { TopBar, type ModelChoice } from "./TopBar";
import { Tour } from "./Tour";
import { UI_ACTION_EVENT, type UiActionDetail } from "./ui-actions";
import { useBoardBench } from "./useBoardBench";
import { useCredits } from "./useCredits";
import { solvedOf, useMatterBench } from "./useMatterBench";
import { WorkflowBar } from "./WorkflowBar";
import { LIMITS, DEFAULT_LAYOUT, gridTemplate } from "./layout-state";
import { TOUR_KEY, type TourStep } from "./tour-steps";
import { boardSteps, matterSteps, siliconSteps, STEP_LABELS, type StepId } from "./workflow";
import { useMediaQuery } from "@/lib/hooks";

type PaneId = "inputs" | "canvas" | "agent";
const SIDEBAR_KEY = "hw-app-sidebar-v1";
const MODEL_KEY = "hw-app-model-v1";
const PANE_LABEL: Record<PaneId, string> = { inputs: "Inputs", canvas: "Canvas", agent: "Agent" };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll until `cond` holds or `ms` pass. The app's state changes between renders, so handlers read it through refs. */
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(40);
  }
  return cond();
}

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not persisted; the app still works for this visit
  }
}

export function AppShell({ runs }: { runs: RunIndexEntry[] }) {
  const siliconRuns = useMemo(() => {
    const known = runs.filter((r) => r.domain === "silicon");
    const order = (id: string) => (SILICON_RUNS as readonly string[]).indexOf(id);
    return [...known].sort((a, b) => (order(a.id) < 0 ? 99 : order(a.id)) - (order(b.id) < 0 ? 99 : order(b.id)));
  }, [runs]);

  const [wb, setWb] = useState<WorkbenchId>("silicon");
  const [pane, setPane] = useState<PaneId>("canvas");
  const [runId, setRunId] = useState<string>(DEFAULT_RUN);
  const [pendingNode, setPendingNode] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<AnyEvidence | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [focusedStep, setFocusedStep] = useState<StepId | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [model, setModel] = useState<ModelChoice>("auto");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1024px)");

  const matter = useMatterBench();
  const board = useBoardBench();
  const silicon = useSiliconBench(runId);
  const credits = useCredits();

  const panesRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { layout, raw, setLayout, reset: resetLayout } = usePaneLayout(panesRef);

  // Handlers registered once read the latest state through this ref.
  const live = useRef({ matter, board, silicon, wb, runId, pane, raw, wide, runs: siliconRuns });
  live.current = { matter, board, silicon, wb, runId, pane, raw, wide, runs: siliconRuns };

  const log = useCallback((text: string, ok: boolean) => setHistory((h) => [...h.slice(-49), { at: Date.now(), text, ok }]), []);

  // --- persisted preferences, read after mount so the markup matches the server's
  useEffect(() => {
    setSidebarExpanded(readStore(SIDEBAR_KEY) === "1");
    const m = readStore(MODEL_KEY);
    if (m === "auto" || m === "ultra" || m === "super" || m === "nano") setModel(m);
    if (readStore(TOUR_KEY) !== "1") setTourOpen(true);
  }, []);
  const toggleSidebar = () => {
    setSidebarExpanded((e) => {
      writeStore(SIDEBAR_KEY, e ? "0" : "1");
      return !e;
    });
  };
  const chooseModel = (m: ModelChoice) => {
    setModel(m);
    writeStore(MODEL_KEY, m);
  };
  const closeTour = useCallback(() => {
    writeStore(TOUR_KEY, "1");
    setTourOpen(false);
  }, []);
  const onTourStep = useCallback(
    (s: TourStep) => {
      if (s.pane) setPane(s.pane);
      if (s.pane === "agent") setLayout((l) => ({ ...l, rightCollapsed: false }));
      if (s.pane === "inputs") setLayout((l) => ({ ...l, leftCollapsed: false }));
    },
    [setLayout],
  );

  // --- navigation
  const goWb = useCallback((w: WorkbenchId) => {
    setWb(w);
    setPane("canvas");
    setOverlay(null);
    setEvidence(null);
    setFocusedStep(null);
  }, []);

  const selectRun = useCallback(
    (id: string, node?: string | null) => {
      setRunId(id);
      setPendingNode(node ?? null);
      setEvidence(null);
      goWb("silicon");
    },
    [goWb],
  );
  // A new run starts in follow mode; a requested node jumps the replay to its end and selects the node.
  useEffect(() => {
    live.current.silicon.focus.setFollow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
  const seeked = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingNode || silicon.runId !== runId || !silicon.snap || !silicon.controller) return;
    const key = `${runId}/${pendingNode}`;
    if (seeked.current !== key) {
      seeked.current = key;
      silicon.controller.seek(silicon.snap.duration);
      return;
    }
    if (silicon.s.nodes[pendingNode]) {
      silicon.focus.select(pendingNode);
      setPendingNode(null);
    }
  }, [pendingNode, runId, silicon]);

  // --- workflow focus
  const focusStep = useCallback(
    async (step: StepId): Promise<UiActionResult> => {
      const { wb: w } = live.current;
      setFocusedStep(step);
      if (step === "evidence") setDockOpen(true);
      const find = () => {
        const root = rootRef.current;
        if (!root) return null;
        const bySel = w === "silicon" && step === "propose" ? 'section[aria-label="Search tree"]' : w === "silicon" && step === "verify" ? 'section[aria-label="Inspector"]' : null;
        return (bySel && root.querySelector<HTMLElement>(bySel)) || root.querySelector<HTMLElement>(`[data-step="${step}"]`);
      };
      let el = find();
      const owner = el?.closest("[data-pane]")?.getAttribute("data-pane") as PaneId | null | undefined;
      if (owner) {
        setPane(owner);
        if (owner === "inputs") setLayout((l) => ({ ...l, leftCollapsed: false }));
      }
      await sleep(70);
      el = find() ?? el;
      if (!el) return { ok: false, summary: `The ${STEP_LABELS[step]} step has nothing to show on this workbench yet.` };
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      el.focus({ preventScroll: true });
      el.setAttribute("data-flash", "1");
      setTimeout(() => el?.removeAttribute("data-flash"), 1300);
      return { ok: true, summary: `Focused the ${STEP_LABELS[step]} step of the ${WORKBENCHES[w].name} workbench.` };
    },
    [setLayout],
  );

  // --- agent actions: one handler per UiAction, each returning the real outcome
  const apply = useCallback(
    async (a: UiAction): Promise<UiActionResult> => {
      const L = live.current;
      switch (a.name) {
        case "workbench.open":
          goWb(a.args.workbench);
          return { ok: true, summary: `Opened the ${WORKBENCHES[a.args.workbench].name} workbench.` };
        case "board.load_template":
          goWb("board");
          return L.board.loadTemplate(a.args.template_id);
        case "board.set_design":
          goWb("board");
          return L.board.setDesign(a.args.design);
        case "board.check":
          goWb("board");
          return L.board.check();
        case "matter.set_params":
          goWb("matter");
          return L.matter.setParams(a.args);
        case "matter.simulate":
          goWb("matter");
          return L.matter.simulate();
        case "silicon.open_run": {
          const { run_id, node_id } = a.args;
          if (!L.runs.some((r) => r.id === run_id)) return { ok: false, summary: `No recorded run "${run_id}". Available: ${L.runs.map((r) => r.id).join(", ")}.` };
          selectRun(run_id, node_id);
          const ready = await waitFor(() => {
            const sb = live.current.silicon;
            if (sb.runId !== run_id || !sb.snap) return false;
            return node_id ? sb.focus.shown === node_id && !!sb.s.nodes[node_id] : true;
          }, 6000);
          const sb = live.current.silicon;
          if (!ready) return { ok: false, summary: node_id && sb.snap && !sb.s.nodes[node_id] ? `Opened ${run_id}, but it has no node ${node_id}.` : `Opened ${run_id}, but it did not finish loading in time.` };
          const title = sb.s.workload?.title ?? run_id;
          const n = node_id ? sb.s.nodes[node_id] : null;
          return { ok: true, summary: `Opened ${run_id} (${title}), ${sb.s.status}${n ? `. Selected node ${node_id}${n.proposal?.mnemonic ? ` (${n.proposal.mnemonic})` : ""}.` : "."}` };
        }
        case "workflow.focus":
          return focusStep(a.args.step);
        default:
          return { ok: false, summary: "This action is not available in the app yet." };
      }
    },
    [goWb, selectRun, focusStep],
  );
  useEffect(() => {
    const onAction = (e: Event) => {
      const d = (e as CustomEvent<UiActionDetail>).detail;
      d.respond(
        apply(d.action).then((r) => {
          log(`Agent · ${d.action.name}: ${r.summary}`, r.ok);
          return r;
        }),
      );
    };
    window.addEventListener(UI_ACTION_EVENT, onAction);
    return () => window.removeEventListener(UI_ACTION_EVENT, onAction);
  }, [apply, log]);

  // --- user-initiated runs are logged with their real outcome
  const userCheck = useCallback(async () => {
    const r = await live.current.board.check();
    log(`Board check: ${r.summary}`, r.ok);
  }, [log]);
  const userSimulate = useCallback(async () => {
    const r = await live.current.matter.simulate();
    log(`Matter simulate: ${r.summary}`, r.ok);
  }, [log]);
  const boardWithLog = useMemo(() => ({ ...board, check: async () => { await userCheck(); return { ok: true, summary: "" }; } }), [board, userCheck]);
  const matterWithLog = useMemo(() => ({ ...matter, simulate: async () => { await userSimulate(); return { ok: true, summary: "" }; } }), [matter, userSimulate]);

  // --- deep links from the landing page: /app?wb=...
  const didLink = useRef(false);
  useEffect(() => {
    if (didLink.current) return;
    didLink.current = true;
    const link = fromSearch(new URLSearchParams(window.location.search));
    if (!link) return;
    void (async () => {
      const L = live.current;
      if (link.wb === "board") {
        goWb("board");
        if (link.template) {
          const r = await L.board.loadTemplate(link.template);
          log(`Deep link · ${r.summary}`, r.ok);
          if (r.ok && link.autorun) await userCheck();
        }
      } else if (link.wb === "matter") {
        goWb("matter");
        if (link.params) {
          const r = L.matter.setParams(link.params);
          log(`Deep link · ${r.summary}`, r.ok);
          if (r.ok && link.autorun) await userSimulate();
        } else if (link.autorun) await userSimulate();
      } else {
        const id = link.run && L.runs.some((r) => r.id === link.run) ? link.run : DEFAULT_RUN;
        selectRun(id, link.node);
      }
    })();
  }, [goWb, selectRun, log, userCheck, userSimulate]);

  // --- evidence
  const openEvidence = useCallback((e: AnyEvidence) => {
    setEvidence(e);
    setDockOpen(true);
    setFocusedStep("evidence");
  }, []);

  // --- share
  const shareHref = () => {
    const L = live.current;
    const origin = window.location.origin;
    if (L.wb === "matter") {
      const i = L.matter.input;
      return origin + toHref({ wb: "matter", params: { generator: i.generator, gen_params: i.gen_params, spreader: i.spreader } });
    }
    if (L.wb === "board") return origin + toHref({ wb: "board", template: L.board.templateId ?? undefined });
    return origin + toHref({ wb: "silicon", run: L.runId, node: L.silicon.focus.follow ? undefined : (L.silicon.focus.shown ?? undefined) });
  };
  const share = async () => {
    const href = shareHref();
    try {
      await navigator.clipboard.writeText(href);
      setShareNote("Link copied");
    } catch {
      setShareNote("Copy failed");
    }
    setTimeout(() => setShareNote(null), 1800);
  };

  // --- derived display state
  const bd = board.result?.check;
  const flows = {
    board: boardSteps({ hasDesign: !!board.designText.trim(), busy: board.busy === "checking", checked: !!bd, stale: board.stale, passN: bd ? bd.rungs.filter((r) => r.status === "pass").length : 0, total: bd?.rungs.length ?? 5, failure: !!board.failure, evidenceOpen: !!evidence && dockOpen }),
    matter: matterSteps({ valid: matter.valid, busy: matter.busy, simulated: !!matter.sim, stale: matter.stale, passN: matter.sim ? matter.sim.ladder.filter((r) => r.status === "pass").length : 0, total: matter.sim?.ladder.length ?? 5, failure: !!matter.failure, evidenceOpen: !!evidence && dockOpen, hasStl: !!matter.sim?.stl }),
    silicon: siliconSteps({ loaded: !!silicon.snap, status: silicon.s.status, verified: silicon.verified, evidenceOpen: !!evidence && dockOpen }),
  };
  const steps = flows[wb];
  const genLabel = MATTER_GENERATORS[matter.input.generator as MatterGenerator].label;
  const boardTitle = board.templates.state === "ready" ? board.templates.value.find((t) => t.id === board.templateId)?.title : undefined;
  const project = wb === "silicon" ? (silicon.s.workload?.title ?? "Recorded run") : wb === "board" ? (boardTitle ?? "Custom board design") : `${genLabel} plate`;
  const runLabel = wb === "silicon" ? runId : wb === "board" ? (board.templateId ?? undefined) : undefined;
  const agentContext = useMemo<AgentContext>(() => {
    if (wb === "matter") {
      const sol = matter.sim ? solvedOf(matter.sim) : null;
      return {
        matter: {
          generator: matter.input.generator,
          gen_params: matter.input.gen_params,
          spreader: matter.input.spreader,
          last: matter.sim && sol && !matter.stale ? { peak_temp_c: sol.peak, rungs: matter.sim.ladder.map((r) => ({ id: r.id, status: r.status })) } : undefined,
        },
      };
    }
    if (wb === "board") {
      let design: unknown;
      try {
        design = board.designText.trim() ? JSON.parse(board.designText) : undefined;
      } catch {
        design = undefined; // half-typed JSON is not sent
      }
      return { board: { template_id: board.templateId ?? undefined, design, last_check: bd && !board.stale ? { passed: bd.passed, rungs: bd.rungs.map((r) => ({ rung: r.rung, status: r.status })) } : undefined } };
    }
    return { silicon: { run_id: runId, node_id: silicon.focus.follow ? undefined : (silicon.focus.shown ?? undefined) } };
  }, [wb, matter.input, matter.sim, matter.stale, board.designText, board.templateId, board.stale, bd, runId, silicon.focus.follow, silicon.focus.shown]);
  // The server already ran the free tool; the app mirrors it (same deterministic call) and logs the real outcome.
  const onAgentAction = useCallback(
    async (a: UiAction) => {
      const r = await apply(a);
      log(`Agent · ${a.name}: ${r.summary}`, r.ok);
      return r;
    },
    [apply, log],
  );

  const paneClass = (p: PaneId) => (pane === p ? "flex" : "hidden lg:flex");
  const layoutVars = { "--cols": gridTemplate(layout) } as React.CSSProperties;
  const nudge = (side: "left" | "right", dx: number) =>
    setLayout((l) => (side === "left" ? { ...l, leftCollapsed: false, left: layout.left + dx } : { ...l, rightCollapsed: false, right: layout.right - dx }));

  return (
    <div ref={rootRef} className="hw-app flex h-dvh min-w-0 flex-col overflow-hidden" data-wb={wb} data-testid="app-root">
      <TopBar project={project} wb={wb} runLabel={runLabel} model={model} onModel={chooseModel} credits={credits} onShare={share} shareNote={shareNote} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <Sidebar wb={wb} onWorkbench={goWb} expanded={sidebarExpanded} onToggleExpanded={toggleSidebar} overlay={overlay} onOverlay={setOverlay} onTour={() => { setOverlay(null); setTourOpen(true); }} />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {overlay === "runs" && <RunsOverlay runs={siliconRuns} runId={runId} history={history} onPick={(id) => selectRun(id)} onClose={() => setOverlay(null)} />}
          {overlay === "settings" && <SettingsOverlay onClose={() => setOverlay(null)} onResetLayout={resetLayout} onReplayTour={() => { setOverlay(null); setTourOpen(true); }} onShare={share} shareNote={shareNote} />}

          <div role="tablist" aria-label="Panels" className="grid h-11 shrink-0 grid-cols-3 border-b border-line bg-panel p-1 lg:hidden">
            {(["inputs", "canvas", "agent"] as const).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} data-testid={`tab-${p}`} className={`min-w-0 rounded-md text-[13px] transition-colors duration-150 ${pane === p ? "bg-raised text-ink" : "text-ink-3"}`}>
                {PANE_LABEL[p]}
              </button>
            ))}
          </div>

          <div ref={panesRef} style={layoutVars} className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:[grid-template-columns:var(--cols)]" data-testid="panes">
            <Pane id="inputs" title="Inputs" side="left" collapsed={wide && layout.leftCollapsed} onToggle={() => setLayout((l) => ({ ...l, leftCollapsed: !l.leftCollapsed }))} className={paneClass("inputs")} bodyClass="scroll-quiet overflow-y-auto">
              {wb === "matter" && <MatterInputs b={matterWithLog} />}
              {wb === "board" && <BoardInputs b={boardWithLog} />}
              {wb === "silicon" && <SiliconInputs runs={siliconRuns} b={silicon} onPick={(id) => selectRun(id)} />}
            </Pane>
            <Splitter className="hidden lg:block" label="Resize the inputs pane" value={layout.left} min={LIMITS.leftMin} max={LIMITS.leftMax} onDelta={(dx) => nudge("left", dx)} onReset={() => setLayout((l) => ({ ...l, left: DEFAULT_LAYOUT.left, leftCollapsed: false }))} onToggle={() => setLayout((l) => ({ ...l, leftCollapsed: !l.leftCollapsed }))} />

            <section aria-label="Canvas" data-pane="canvas" className={`min-h-0 min-w-0 flex-col overflow-hidden bg-bg ${paneClass("canvas")}`}>
              <WorkflowBar steps={steps} focused={focusedStep} onStep={(s) => void focusStep(s)} />
              <div id="main" tabIndex={-1} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
                {wb === "matter" && <MatterCanvasView b={matterWithLog} onEvidence={openEvidence} />}
                {wb === "board" && <BoardCanvasView b={boardWithLog} onEvidence={openEvidence} />}
                {wb === "silicon" && <SiliconCanvasView b={silicon} onEvidence={openEvidence} />}
              </div>
              <EvidenceDock evidence={evidence} onClear={() => setEvidence(null)} open={dockOpen} onToggle={() => setDockOpen((o) => !o)} silicon={wb === "silicon" ? silicon : null} wide={wide} />
            </section>

            <Splitter className="hidden lg:block" label="Resize the agent pane" value={layout.right} min={LIMITS.rightMin} max={LIMITS.rightMax} onDelta={(dx) => nudge("right", dx)} onReset={() => setLayout((l) => ({ ...l, right: DEFAULT_LAYOUT.right, rightCollapsed: false }))} onToggle={() => setLayout((l) => ({ ...l, rightCollapsed: !l.rightCollapsed }))} />
            <Pane id="agent" title="Agent" side="right" tour="agent" collapsed={wide && layout.rightCollapsed} onToggle={() => setLayout((l) => ({ ...l, rightCollapsed: !l.rightCollapsed }))} className={paneClass("agent")}>
              <AgentSlot workbench={wb} context={agentContext} model={model} onModel={chooseModel} onAction={onAgentAction} />
            </Pane>
          </div>
        </div>
      </div>
      {tourOpen && <Tour onClose={closeTour} onStep={onTourStep} />}
    </div>
  );
}
