"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BRAND, WORKBENCHES, type WorkbenchId } from "@/lib/brand";
import type { UiAction, UiActionResult } from "@/lib/agent-actions";
import { fromSearch, toHref, type DeepLink } from "@/lib/deeplink";
import type { AgentState } from "@/lib/agent";
import { addProject, createProject, loadProjects, patchProject, removeProject, renameProject, sanitizeChat, saveProjects, type Project, type ProjectSnap } from "@/lib/projects";
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
import { mainNode, SiliconLivePreview } from "./SiliconLive";
import { StartScreen, type StartPick } from "./StartScreen";
import type { Chip } from "./route";
import { UI_ACTION_EVENT, type UiActionDetail } from "./ui-actions";
import { useBoardBench } from "./useBoardBench";
import { useBoardLayout } from "./useBoardLayout";
import { WorkflowView } from "./WorkflowView";
import { buildProjectZip, downloadBytes, zipName } from "./exportProject";
import { boardWorkflow, matterWorkflow, siliconWorkflow, type Workflow } from "@/lib/workflow";
import { useCredits } from "./useCredits";
import { solvedOf, useMatterBench } from "./useMatterBench";
import { useSiliconLive } from "./useSiliconLive";
import { boardVerdict, matterVerdict, siliconVerdict, type CheckCard } from "./verdict";
import type { ProductFile } from "./files";
import { bomCsv, kicadNetlist } from "./netlist";
import { resolveWorkbench } from "./route";
import { Sidebar } from "./Sidebar";
import { IconHelp, IconPanel } from "./ui";

const MODEL_KEY = "hw-app-model-v1";
const DEFAULT_RECORDED = "r_w1_contree3";
const SIDEBAR_KEY = "hw-sidebar-v1";

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [creating, setCreating] = useState<WorkbenchId | "any" | null>("any");
  const [initial, setInitial] = useState<StartPick | undefined>(undefined);
  const [link, setLink] = useState<DeepLink | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const credits = useCredits();
  const latestProjects = useRef(projects);
  latestProjects.current = projects;

  // Everything is read after mount (never during render), so the server and the first client render agree.
  useEffect(() => {
    const list = loadProjects();
    setCollapsed(readStore(SIDEBAR_KEY) === "0");
    const sl = fromSearch(new URLSearchParams(window.location.search));
    if (sl) {
      const wb = sl.wb;
      const p = createProject(wb, `Shared ${WORKBENCHES[wb].name} link`);
      setProjects(addProject(list, p));
      setLink(sl);
      setCurrentId(p.id);
      setCreating(null);
      window.history.replaceState(null, "", "/app");
    } else {
      setProjects(list);
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) saveProjects(projects);
  }, [projects, loaded]);

  const onPatch = useCallback((id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) => {
    setProjects((l) => {
      const cur = l.find((p) => p.id === id);
      if (!cur) return l;
      // a change that leaves the saved value as it was must not reorder the list or bump its time
      const same = Object.keys(patch).every((k) => JSON.stringify((patch as Record<string, unknown>)[k]) === JSON.stringify((cur as unknown as Record<string, unknown>)[k]));
      return same ? l : patchProject(l, id, patch);
    });
  }, []);
  const begin = (p: StartPick) => {
    const { wb } = resolveWorkbench(p.text, p.chip);
    const proj = createProject(wb, p.text);
    setProjects((l) => addProject(l, proj));
    setInitial(p);
    setLink(undefined);
    setCurrentId(proj.id);
    setCreating(null);
  };
  const select = (id: string) => {
    setInitial(undefined);
    setLink(undefined);
    setCurrentId(id);
    setCreating(null);
    setDrawer(false);
  };
  const newProject = (wb: WorkbenchId | "any") => {
    setCurrentId(null);
    setCreating(wb);
    setDrawer(false);
  };
  const toggle = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setCollapsed((c) => {
        writeStore(SIDEBAR_KEY, c ? "1" : "0");
        return !c;
      });
    } else setDrawer((d) => !d);
  };
  const leading = (
    <button type="button" onClick={toggle} aria-label="Show or hide your projects" title="Projects" data-testid="sidebar-toggle" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-raised hover:text-ink">
      <IconPanel size={18} />
    </button>
  );
  const current = projects.find((p) => p.id === currentId) ?? null;
  const sidebar = (close?: () => void) => (
    <Sidebar
      projects={projects}
      currentId={currentId}
      creating={creating === "any" ? null : creating}
      onSelect={select}
      onNew={(wb) => newProject(wb)}
      onRename={(id, title) => setProjects((l) => renameProject(l, id, title))}
      onDelete={(id) => {
        setProjects((l) => removeProject(l, id));
        if (id === currentId) newProject("any");
      }}
      onClose={close}
    />
  );
  return (
    <div className="flex h-dvh min-w-0 overflow-hidden bg-bg">
      <aside className={`hidden w-[264px] shrink-0 border-r border-line ${collapsed ? "" : "lg:block"}`} aria-label="Sidebar">
        {sidebar()}
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close the projects list" onClick={() => setDrawer(false)} className="absolute inset-0 bg-black/55" />
          <aside className="absolute inset-y-0 left-0 w-[min(300px,86vw)] border-r border-line shadow-[var(--hw-shadow)]">{sidebar(() => setDrawer(false))}</aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        {current && !creating ? (
          <Workspace key={current.id} recorded={recorded} project={current} onPatch={onPatch} initial={initial} link={link} leading={leading} onNew={(wb) => newProject(wb)} />
        ) : (
          <div className="h-dvh overflow-y-auto">
            <StartScreen key={creating ?? "any"} credits={credits} onStart={begin} initialChip={creating && creating !== "any" ? (creating as Chip) : "auto"} leading={leading} />
          </div>
        )}
      </div>
    </div>
  );
}

interface WorkspaceProps {
  recorded: string[];
  project: Project;
  /** Saves a change to this project (its workbench, chat or settings). */
  onPatch: (id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) => void;
  /** The first prompt from the start screen, sent once when the project opens. */
  initial?: StartPick;
  /** A shared link this project was opened from. */
  link?: DeepLink;
  leading: ReactNode;
  onNew: (wb: WorkbenchId) => void;
}

function Workspace({ recorded, project, onPatch, initial, link, leading, onNew }: WorkspaceProps) {
  const [wb, setWb] = useState<WorkbenchId>(project.wb);
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
  const boardLayout = useBoardLayout(board.designText);
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

  // --- opening the project: restore its saved settings, or start from the first prompt, or from a shared link
  const push = useCallback((text: string) => setPrompt((p) => ({ id: (p?.id ?? 0) + 1, text })), []);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const L = latest.current;
    const snap = project.snap;
    if (initial) {
      if (initial.example?.preset?.matter?.spreader) {
        L.autoDone.matter = true;
        L.matter.setParams({ spreader: initial.example.preset.matter.spreader });
        void L.matter.simulate().then((r) => log(`Matter simulate (example preset): ${r.summary}`, r.ok));
      }
      push(initial.text);
      return;
    }
    if (link) {
      void (async () => {
        if (link.wb === "board") {
          if (link.template || link.autorun) L.autoDone.board = true;
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
      return;
    }
    // a saved project: its settings are re-applied and the free solver or checker re-runs, so the preview is real, not a stored picture
    if (project.wb === "matter" && snap.matter && (snap.matter.spreader || snap.matter.gen_params)) {
      L.autoDone.matter = true;
      L.matter.setParams(snap.matter as Parameters<typeof L.matter.setParams>[0]);
      void L.matter.simulate().then((r) => log(`Matter simulate (restored project): ${r.summary}`, r.ok));
    } else if (project.wb === "board" && snap.board) {
      L.autoDone.board = true;
      void (async () => {
        if (snap.board?.templateId) {
          const r = await L.board.loadTemplate(snap.board.templateId);
          if (!r.ok) return log(`Restore · ${r.summary}`, false);
        }
        const parsed = snap.board?.designText ? parseDesign(snap.board.designText).design : null;
        if (parsed) L.board.setDesign(parsed);
        const c = await L.board.check();
        log(`Board check (restored project): ${c.summary}`, c.ok);
      })();
    }
  }, [project, initial, link, push, log, openWork]);

  // --- keep the project saved: workbench, settings (only when they changed) and the chat (debounced, flushed on leaving)
  useEffect(() => {
    if (wb !== project.wb) onPatch(project.id, { wb });
  }, [wb, project.wb, project.id, onPatch]);
  const snapNow = useMemo<ProjectSnap>(
    () => ({
      ...(wb === "matter" ? { matter: { generator: matter.input.generator, gen_params: matter.input.gen_params, spreader: matter.input.spreader } } : {}),
      ...(wb === "board" ? { board: { templateId: board.templateId, designText: board.designText } } : {}),
    }),
    [wb, matter.input, board.templateId, board.designText],
  );
  const lastSnap = useRef(JSON.stringify(project.snap));
  useEffect(() => {
    const s = JSON.stringify(snapNow);
    if (s === "{}" || s === lastSnap.current) return;
    if (wb === "board" && !board.result && !project.snap.board) return; // the default template is not the visitor's work yet
    lastSnap.current = s;
    onPatch(project.id, { snap: snapNow });
  }, [snapNow, wb, board.result, project.snap.board, project.id, onPatch]);
  const chatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatPending = useRef<AgentState | null>(null);
  const flushChat = useCallback(() => {
    if (chatTimer.current) clearTimeout(chatTimer.current);
    chatTimer.current = null;
    const s = chatPending.current;
    chatPending.current = null;
    if (s) onPatch(project.id, { chat: sanitizeChat(s) });
  }, [onPatch, project.id]);
  const onChat = useCallback(
    (s: AgentState) => {
      chatPending.current = s;
      if (!chatTimer.current) chatTimer.current = setTimeout(flushChat, 700);
    },
    [flushChat],
  );
  useEffect(() => flushChat, [flushChat]);

  // --- first open of Matter or Board shows one real default result (free), unless the visitor already acted
  const bd = board.result?.check ?? null;
  const boardReady = board.designText.trim() !== "" && board.templateId !== null && board.busy === "idle" && !board.tplLoading && !board.result;
  useEffect(() => {
    const L = latest.current;
    if (wb === "matter" && !L.autoDone.matter) {
      L.autoDone.matter = true;
      void L.matter.simulate().then((r) => log(`Matter simulate (default parameters, run on first open): ${r.summary}`, r.ok));
    }
    if (wb === "board" && !L.autoDone.board && boardReady) {
      L.autoDone.board = true;
      void L.board.check().then((r) => log(`Board check (default template, run on first open): ${r.summary}`, r.ok));
    }
  }, [wb, boardReady, log]);

  // --- coach marks: three, once, remembered; replay from the ? button
  useEffect(() => {
    if (readStore(COACH_KEY) === "1") return;
    const t = setTimeout(() => setCoach(true), 700);
    return () => clearTimeout(t);
  }, []);
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
      if (boardLayout.status === "ready") {
        const base = `/boards/${boardLayout.dir}`;
        const f = boardLayout.summary.files;
        const remote: Array<[string, string, string, string | undefined]> = [
          ["gerbers-and-drill.zip", "application/zip", "Gerber and drill files: what a board maker needs", f.gerber_zip],
          ["routed.kicad_pcb", "application/octet-stream", "The routed board, opens in KiCad 7", f.kicad_pcb],
          ["positions.csv", "text/csv", "Pick-and-place positions", f.positions],
          ["board-all-layers.svg", "image/svg+xml", "The whole board as a picture", f["svg_all-layers"]],
          ["board-bom.csv", "text/csv", "Parts list including the bypass capacitors the layout added", f.bom],
          ["drc.txt", "text/plain", "KiCad design-rule check report", f.drc_report],
        ];
        if (boardLayout.downloads) for (const d of boardLayout.downloads) out.push({ name: d.name === "bom.csv" ? "board-bom.csv" : d.name === "all-layers.svg" ? "board-all-layers.svg" : d.name, mime: d.mime, note: d.note, base64: d.base64 });
        else for (const [name, mime, note, src] of remote) if (src) out.push({ name, mime, note, href: `${base}/${src}` });
      }
      return out;
    }
    if (wb === "silicon") return live.files.map((f) => ({ name: f.path.split("/").pop() ?? f.path, mime: "text/plain", note: f.path, text: f.text, base64: f.base64 }));
    return [];
  }, [wb, matter.sim, bd, parsedDesign.design, board.result?.design, board.designText, live.files, boardLayout]);

  const agentContext = useMemo<AgentContext>(() => {
    if (wb === "matter") {
      return { matter: { generator: matter.input.generator, gen_params: matter.input.gen_params, spreader: matter.input.spreader, last: matter.sim && sol && !matter.stale ? { peak_temp_c: sol.peak, rungs: matter.sim.ladder.map((r) => ({ id: r.id, status: r.status })) } : undefined } };
    }
    if (wb === "board") {
      return { board: { template_id: board.templateId ?? undefined, design: parsedDesign.design ?? undefined, last_check: bd && !board.stale ? { passed: bd.passed, rungs: bd.rungs.map((r) => ({ rung: r.rung, status: r.status })) } : undefined } };
    }
    return { silicon: {} };
  }, [wb, matter.input, matter.sim, matter.stale, sol, board.templateId, board.stale, parsedDesign.design, bd]);

  const requestText = initial?.text ?? project.chat.messages.find((m) => m.role === "user")?.text ?? project.title;
  const workflow = useMemo<Workflow>(() => {
    if (wb === "matter") return matterWorkflow({ prompt: requestText, sim: matter.sim, busy: matter.busy, stale: matter.stale, input: matter.input as never, files: files.length });
    if (wb === "board") {
      const L = boardLayout;
      return boardWorkflow({
        prompt: requestText,
        design: parsedDesign.design,
        check: bd,
        busy: board.busy === "checking",
        stale: board.stale,
        layout: L.status === "ready" ? { status: "ready", routed: L.summary.stats.fully_routed, unrouted: L.summary.stats.unrouted_connections, drcErrors: L.summary.drc.errors, drcWarnings: L.summary.drc.warnings, boardMm: L.summary.stats.board_mm, tracks: L.summary.stats.tracks, parts: L.summary.stats.parts } : { status: L.status },
        files: files.length,
      });
    }
    return siliconWorkflow({ prompt: requestText, phase: live.phase, node: mainNode(live.run), files: live.files.length, workload: "" });
  }, [wb, requestText, matter.sim, matter.busy, matter.stale, matter.input, parsedDesign.design, bd, board.busy, board.stale, boardLayout, live.phase, live.run, live.files, files.length]);

  const exportAll = useCallback(async () => {
    const zip = await buildProjectZip({ project, request: requestText, verdict: [verdict.title, verdict.detail].filter(Boolean).join(". "), files });
    downloadBytes(zipName(project.title), zip);
  }, [project, requestText, verdict, files]);

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

  const body =
    tab === "workflow" ? (
      <WorkflowView wf={workflow} onOpen={(t) => setTab(t)} />
    ) : tab === "files" ? (
      <FilesTab files={files} empty={wb === "silicon" ? "Files appear when a live run finishes: the hardware (RTL), the C intrinsic, the patched kernel and the report." : wb === "board" ? "Files appear after the board has been checked: pin header, parts list, netlist and the design." : "Files appear after a simulation: the STL you can print and the settings."} />
    ) : wb === "matter" ? (
      <MatterPreview b={matter} tab={tab} />
    ) : wb === "board" ? (
      <BoardPreview b={board} tab={tab} onFix={fix} layout={boardLayout} />
    ) : (
      <SiliconLivePreview live={live} tab={tab} blocked={blocked} recordedHref={`/runs/${recordedRun}`} />
    );

  return (
    <div className="hw-app flex h-dvh min-w-0 flex-col overflow-hidden" data-wb={wb} data-testid="workspace">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 sm:gap-3 sm:px-4">
        {leading}
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
          <AgentSlot workbench={wb} context={agentContext} model={model} onModel={chooseModel} onAction={onAgentAction} prompt={prompt} suggestions={SUGGESTIONS[wb]} onBusyChange={setAgentBusy} initialState={project.chat} onStateChange={onChat} />
        </section>
        <div className={`min-h-0 min-w-0 lg:block ${pane === "preview" ? "block" : "hidden"}`} data-busy={agentBusy ? "1" : "0"}>
          <PreviewPane
            wb={wb}
            title={project.title}
            verdict={verdict}
            tab={tab}
            onTab={setTab}
            files={files}
            onShare={share}
            shareNote={shareNote}
            onStartOver={() => onNew(wb)}
            onAdvanced={() => setAdvanced(true)}
            onExportAll={files.length > 0 ? exportAll : undefined}
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
