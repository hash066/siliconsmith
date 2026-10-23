"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRAND, WORKBENCHES, type WorkbenchId } from "@/lib/brand";
import type { UiAction, UiActionResult } from "@/lib/agent-actions";
import { fromSearch, toHref } from "@/lib/deeplink";
import type { AgentContext } from "../agent";
import { ThemeToggle } from "../site/Brand";
import { AdvancedDrawer, type HistoryItem } from "./Advanced";
import { AgentSlot, type PushedPrompt } from "./AgentSlot";
import { BoardPreview, parseDesign } from "./BoardPreview";
import { COACH_KEY, type CoachStep } from "./coach";
import { CoachMarks } from "./CoachMarks";
import { CreditsPill, Mark, type ModelChoice } from "./CreditsPill";
import { FilesTab, PreviewPane, type PreviewTab } from "./PreviewPane";
import { MatterPreview } from "./MatterPreview";
import { SiliconLivePreview } from "./SiliconLive";
import { StartScreen, type StartPick } from "./StartScreen";
import { UI_ACTION_EVENT, type UiActionDetail } from "./ui-actions";
import { useBoardBench } from "./useBoardBench";
import { useCredits } from "./useCredits";
import { solvedOf, useMatterBench } from "./useMatterBench";
import { useSiliconLive } from "./useSiliconLive";
import { boardVerdict, matterVerdict, siliconVerdict, type CheckCard } from "./verdict";
import type { ProductFile } from "./files";
import { bomCsv, kicadNetlist } from "./netlist";
import { resolveWorkbench } from "./route";
import { IconHelp } from "./ui";

const MODEL_KEY = "hw-app-model-v1";
const DEFAULT_RECORDED = "r_w1_contree3";

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

const SUGGESTIONS: Record<WorkbenchId, string[]> = {
  matter: ["Make it cooler", "Use radial spokes", "Try 10 fins and show me"],
  board: ["Fix the failing check", "Why did it fail?", "Move the wake button to GPIO13 and re-check"],
  silicon: ["Run the TinyMaix kernel live", "Run the ChaCha20 kernel live", "What does a custom instruction change?"],
};

/** `recorded` = ids of the real recorded runs installed here (the full search is only a link under Proof). */
export function AppShell({ recorded }: { recorded: string[] }) {
  const [epoch, setEpoch] = useState(0);
  return (
    <App
      key={epoch}
      recorded={recorded}
      onRestart={() => {
        // a deep link must not pull the visitor straight back in
        window.history.replaceState(null, "", "/app");
        setEpoch((e) => e + 1);
      }}
    />
  );
}

function App({ recorded, onRestart }: { recorded: string[]; onRestart: () => void }) {
  const [stage, setStage] = useState<"start" | "work">("start");
  const [wb, setWb] = useState<WorkbenchId>("matter");
  const [tab, setTab] = useState<PreviewTab>("preview");
  const [pane, setPane] = useState<"chat" | "preview">("chat");
  const [dirty, setDirty] = useState(false);
  const [prompt, setPrompt] = useState<PushedPrompt | null>(null);
  const [model, setModel] = useState<ModelChoice>("auto");
  const [advanced, setAdvanced] = useState(false);
  const [coach, setCoach] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [recordedRun, setRecordedRun] = useState(recorded.includes(DEFAULT_RECORDED) ? DEFAULT_RECORDED : (recorded[0] ?? DEFAULT_RECORDED));
  const [agentBusy, setAgentBusy] = useState(false);

  const matter = useMatterBench();
  const board = useBoardBench();
  const live = useSiliconLive();
  const credits = useCredits();

  // Handlers registered once read the latest state through this ref.
  const latest = useRef({ matter, board, live, wb, recorded, autoDone: { matter: false, board: false }, pane });
  latest.current = { matter, board, live, wb, recorded, autoDone: latest.current.autoDone, pane };
  const log = useCallback((text: string, ok: boolean) => setHistory((h) => [...h.slice(-49), { at: Date.now(), text, ok }]), []);

  useEffect(() => {
    const m = readStore(MODEL_KEY);
    if (m === "auto" || m === "ultra" || m === "super" || m === "nano") setModel(m);
  }, []);
  const chooseModel = (m: ModelChoice) => {
    setModel(m);
    writeStore(MODEL_KEY, m);
  };

  const openWork = useCallback((w: WorkbenchId, t: PreviewTab = "preview") => {
    setWb(w);
    setTab(t);
    setStage("work");
  }, []);
  const touch = useCallback(() => {
    if (latest.current.pane !== "preview") setDirty(true);
  }, []);

  // --- agent and button actions; each returns the REAL outcome
  const apply = useCallback(
    async (a: UiAction): Promise<UiActionResult> => {
      const L = latest.current;
      touch();
      switch (a.name) {
        case "workbench.open":
          openWork(a.args.workbench);
          return { ok: true, summary: `Opened the ${WORKBENCHES[a.args.workbench].name} preview.` };
        case "board.load_template":
          L.autoDone.board = true;
          openWork("board");
          return L.board.loadTemplate(a.args.template_id);
        case "board.set_design":
          L.autoDone.board = true;
          openWork("board");
          return L.board.setDesign(a.args.design);
        case "board.check":
          L.autoDone.board = true;
          openWork("board");
          return L.board.check();
        case "board.design":
          L.autoDone.board = true;
          openWork("board");
          return { ok: true, summary: "Opened the Board preview. The agent's designs and checks appear here as it makes them." };
        case "matter.set_params":
          L.autoDone.matter = true;
          openWork("matter");
          return L.matter.setParams(a.args);
        case "matter.simulate":
          L.autoDone.matter = true;
          openWork("matter");
          return L.matter.simulate();
        case "silicon.run_live":
          openWork("silicon");
          return L.live.start(a.args.workload);
        case "silicon.open_run": {
          if (!L.recorded.includes(a.args.run_id)) return { ok: false, summary: `No recorded run "${a.args.run_id}". Available: ${L.recorded.join(", ") || "none"}.` };
          setRecordedRun(a.args.run_id);
          openWork("silicon", "proof");
          return { ok: true, summary: `Recorded runs open on their own page: the link "See a full recorded search" under Proof now points at ${a.args.run_id}.` };
        }
        case "preview.tab":
          setTab(a.args.tab);
          return { ok: true, summary: `Showing the ${a.args.tab} tab.` };
        case "workflow.focus": {
          const t: PreviewTab = a.args.step === "export" ? "files" : a.args.step === "verify" || a.args.step === "evidence" ? "proof" : "preview";
          setTab(t);
          return { ok: true, summary: `Showing the ${t} tab.` };
        }
      }
    },
    [openWork, touch],
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
  const onAgentAction = useCallback(
    async (a: UiAction) => {
      const r = await apply(a);
      log(`Agent · ${a.name}: ${r.summary}`, r.ok);
      return r;
    },
    [apply, log],
  );

  // --- start screen and deep links
  const push = useCallback((text: string) => setPrompt((p) => ({ id: (p?.id ?? 0) + 1, text })), []);
  const onStart = useCallback(
    (p: StartPick) => {
      const { wb: w } = resolveWorkbench(p.text, p.chip);
      const L = latest.current;
      if (p.example?.preset?.matter?.spreader) {
        L.autoDone.matter = true;
        L.matter.setParams({ spreader: p.example.preset.matter.spreader });
        void L.matter.simulate().then((r) => log(`Matter simulate (example preset): ${r.summary}`, r.ok));
      }
      openWork(w);
      push(p.text);
    },
    [openWork, push, log],
  );
  const didLink = useRef(false);
  useEffect(() => {
    if (didLink.current) return;
    didLink.current = true;
    const link = fromSearch(new URLSearchParams(window.location.search));
    if (!link) return;
    void (async () => {
      const L = latest.current;
      if (link.wb === "board") {
        if (link.template || link.autorun) L.autoDone.board = true;
        openWork("board");
        if (link.template) {
          const r = await L.board.loadTemplate(link.template);
          log(`Deep link · ${r.summary}`, r.ok);
          if (r.ok && link.autorun) {
            const c = await L.board.check();
            log(`Board check: ${c.summary}`, c.ok);
          }
        }
      } else if (link.wb === "matter") {
        if (link.params || link.autorun) L.autoDone.matter = true;
        openWork("matter");
        if (link.params) {
          const r = L.matter.setParams(link.params);
          log(`Deep link · ${r.summary}`, r.ok);
          if (r.ok && link.autorun) {
            const s = await L.matter.simulate();
            log(`Matter simulate: ${s.summary}`, s.ok);
          }
        } else if (link.autorun) {
          const s = await L.matter.simulate();
          log(`Matter simulate: ${s.summary}`, s.ok);
        }
      } else {
        openWork("silicon", link.run ? "proof" : "preview");
        if (link.run && L.recorded.includes(link.run)) setRecordedRun(link.run);
      }
    })();
  }, [openWork, log]);

  // --- first open of Matter or Board shows one real default result (free), unless the visitor already acted
  const bd = board.result?.check ?? null;
  const boardReady = board.designText.trim() !== "" && board.templateId !== null && board.busy === "idle" && !board.tplLoading && !board.result;
  useEffect(() => {
    if (stage !== "work") return;
    const L = latest.current;
    if (wb === "matter" && !L.autoDone.matter) {
      L.autoDone.matter = true;
      void L.matter.simulate().then((r) => log(`Matter simulate (default parameters, run on first open): ${r.summary}`, r.ok));
    }
    if (wb === "board" && !L.autoDone.board && boardReady) {
      L.autoDone.board = true;
      void L.board.check().then((r) => log(`Board check (default template, run on first open): ${r.summary}`, r.ok));
    }
  }, [stage, wb, boardReady, log]);

  // --- coach marks: three, once, remembered; replay from the ? button
  useEffect(() => {
    if (stage !== "work" || readStore(COACH_KEY) === "1") return;
    const t = setTimeout(() => setCoach(true), 700);
    return () => clearTimeout(t);
  }, [stage]);
  const closeCoach = useCallback(() => {
    writeStore(COACH_KEY, "1");
    setCoach(false);
  }, []);
  const onCoachStep = useCallback((s: CoachStep) => setPane(s.pane), []);
  useEffect(() => {
    if (pane === "preview") setDirty(false);
  }, [pane]);

  // --- derived: verdict, files, context
  const sol = matter.sim ? solvedOf(matter.sim) : null;
  const verdict =
    wb === "matter"
      ? matterVerdict({ sim: matter.sim, busy: matter.busy, stale: matter.stale, failed: matter.failure?.message ?? null })
      : wb === "board"
        ? boardVerdict({ check: bd, busy: board.busy === "checking", stale: board.stale, failed: board.failure?.message ?? null })
        : siliconVerdict({ phase: live.phase, state: live.run, error: live.error });
  const parsedDesign = useMemo(() => parseDesign(board.designText), [board.designText]);
  const files = useMemo<ProductFile[]>(() => {
    if (wb === "matter" && matter.sim) {
      const out: ProductFile[] = [];
      if (matter.sim.stl) out.push({ name: "heat-sink.stl", mime: "model/stl", note: "3D-printable part, millimetres", base64: matter.sim.stl.base64 });
      out.push({ name: "parameters.json", mime: "application/json", note: "The settings that made this result", text: JSON.stringify({ generator: matter.sim.generator, gen_params: matter.sim.gen_params, spreader: matter.sim.spreader }, null, 2) });
      return out;
    }
    if (wb === "board" && bd) {
      const out: ProductFile[] = [{ name: "pin_header.h", mime: "text/plain", note: "C pin map for the firmware", text: bd.header }];
      if (parsedDesign.design) {
        out.push({ name: "bom.csv", mime: "text/csv", note: "Parts list", text: bomCsv(parsedDesign.design) });
        out.push({ name: "netlist.net", mime: "text/plain", note: "KiCad-format netlist, no footprints", text: kicadNetlist(parsedDesign.design) });
      }
      out.push({ name: "design.json", mime: "application/json", note: "The design that was checked", text: board.result?.design ?? board.designText });
      return out;
    }
    if (wb === "silicon") return live.files.map((f) => ({ name: f.path.split("/").pop() ?? f.path, mime: "text/plain", note: f.path, text: f.text, base64: f.base64 }));
    return [];
  }, [wb, matter.sim, bd, parsedDesign.design, board.result?.design, board.designText, live.files]);

  const agentContext = useMemo<AgentContext>(() => {
    if (wb === "matter") {
      return { matter: { generator: matter.input.generator, gen_params: matter.input.gen_params, spreader: matter.input.spreader, last: matter.sim && sol && !matter.stale ? { peak_temp_c: sol.peak, rungs: matter.sim.ladder.map((r) => ({ id: r.id, status: r.status })) } : undefined } };
    }
    if (wb === "board") {
      return { board: { template_id: board.templateId ?? undefined, design: parsedDesign.design ?? undefined, last_check: bd && !board.stale ? { passed: bd.passed, rungs: bd.rungs.map((r) => ({ rung: r.rung, status: r.status })) } : undefined } };
    }
    return { silicon: {} };
  }, [wb, matter.input, matter.sim, matter.stale, sol, board.templateId, board.stale, parsedDesign.design, bd]);

  const share = async () => {
    const origin = window.location.origin;
    const L = latest.current;
    const href =
      L.wb === "matter"
        ? origin + toHref({ wb: "matter", params: { generator: L.matter.input.generator, gen_params: L.matter.input.gen_params, spreader: L.matter.input.spreader } })
        : L.wb === "board"
          ? origin + toHref({ wb: "board", template: L.board.templateId ?? undefined })
          : origin + toHref({ wb: "silicon" });
    try {
      await navigator.clipboard.writeText(href);
      setShareNote("Link copied");
    } catch {
      setShareNote("Copy failed");
    }
    setTimeout(() => setShareNote(null), 1800);
  };
  const fix = (c: CheckCard) => push(`Fix the failing check "${c.title}" (${c.id}): change the current design so it passes, then re-check it and tell me what you changed.`);
  const lowCredits = credits.mode === "ready" && credits.remainingUsd !== null && credits.remainingUsd < 0.001;
  const blocked = lowCredits ? "Your demo credits are used up. Board checks and Matter simulations still work for free." : credits.poolExhausted ? "The shared demo pool is used up. Free checks still work." : null;

  if (stage === "start") return <StartScreen credits={credits} onStart={onStart} />;

  const body =
    tab === "files" ? (
      <FilesTab files={files} empty={wb === "silicon" ? "Files appear when a live run finishes: the hardware (RTL), the C intrinsic, the patched kernel and the report." : wb === "board" ? "Files appear after the board has been checked: pin header, parts list, netlist and the design." : "Files appear after a simulation: the STL you can print and the settings."} />
    ) : wb === "matter" ? (
      <MatterPreview b={matter} tab={tab} />
    ) : wb === "board" ? (
      <BoardPreview b={board} tab={tab} onFix={fix} />
    ) : (
      <SiliconLivePreview live={live} tab={tab} blocked={blocked} recordedHref={`/runs/${recordedRun}`} />
    );

  return (
    <div className="hw-app flex h-dvh min-w-0 flex-col overflow-hidden" data-wb={wb} data-testid="workspace">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 sm:gap-3 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-ink" aria-label={`${BRAND.name} home`}>
          <Mark />
          <span className="hw-display hidden text-[15px] sm:inline">{BRAND.name}</span>
        </Link>
        <span className="ml-auto" />
        <button type="button" onClick={() => setCoach(true)} aria-label="Show the quick tips" title="Quick tips" data-testid="coach-open" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-raised hover:text-ink">
          <IconHelp size={18} />
        </button>
        <CreditsPill credits={credits} />
        <ThemeToggle />
      </header>
      <div role="tablist" aria-label="Chat or preview" className="grid h-11 shrink-0 grid-cols-2 border-b border-line bg-panel p-1 lg:hidden">
        {(["chat", "preview"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} data-testid={`pane-${p}`} className={`relative min-w-0 rounded-md text-[13px] capitalize transition-colors ${pane === p ? "bg-raised text-ink" : "text-ink-3"}`}>
            {p}
            {p === "preview" && dirty && <span className="absolute right-4 top-2.5 h-2 w-2 rounded-full bg-signal" role="img" aria-label="the preview changed" />}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(340px,38%)_minmax(0,1fr)]">
        <section aria-label="Chat" data-coach="chat" className={`min-h-0 min-w-0 flex-col border-line bg-panel lg:flex lg:border-r ${pane === "chat" ? "flex" : "hidden"}`}>
          <AgentSlot workbench={wb} context={agentContext} model={model} onModel={chooseModel} onAction={onAgentAction} prompt={prompt} suggestions={SUGGESTIONS[wb]} onBusyChange={setAgentBusy} />
        </section>
        <div className={`min-h-0 min-w-0 lg:block ${pane === "preview" ? "block" : "hidden"}`} data-busy={agentBusy ? "1" : "0"}>
          <PreviewPane
            wb={wb}
            onWorkbench={(w) => {
              setWb(w);
              setTab("preview");
            }}
            verdict={verdict}
            tab={tab}
            onTab={setTab}
            files={files}
            onShare={share}
            shareNote={shareNote}
            onStartOver={onRestart}
            onAdvanced={() => setAdvanced(true)}
          >
            {body}
          </PreviewPane>
        </div>
      </div>
      {advanced && <AdvancedDrawer wb={wb} model={model} onModel={chooseModel} matter={matter} board={board} history={history} onClose={() => setAdvanced(false)} />}
      {coach && <CoachMarks onClose={closeCoach} onStep={onCoachStep} />}
    </div>
  );
}
