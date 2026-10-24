// A project as a workflow: the steps from the visitor's request to the files they can take, each with what really happened.
// Pure functions over the real state of each workbench; nothing is drawn for a step that did not run.
import type { BoardCheck, MatterSimulation } from "./hosted";
import type { NodeState } from "./run-state";

export type StepStatus = "idle" | "running" | "done" | "fail" | "warn" | "skipped";
export type StepKind = "input" | "agent" | "tool" | "check" | "output";

export interface StepItem {
  label: string;
  status: StepStatus;
}
export interface WfNode {
  id: string;
  title: string;
  kind: StepKind;
  status: StepStatus;
  /** One line: what this step did or found. */
  summary: string;
  items?: StepItem[];
  /** The tab that shows this step in full. */
  open?: "preview" | "proof" | "files";
  col: number;
  row: number;
}
export interface Workflow {
  nodes: WfNode[];
  edges: Array<{ from: string; to: string }>;
}

const f1 = (n: number, d = 1) => n.toFixed(d);
const rungStatus = (s: string | undefined): StepStatus => (s === "pass" ? "done" : s === "fail" ? "fail" : s === "skipped" ? "skipped" : s ? "warn" : "idle");

/** Overall status of a step from its parts: any fail fails it, any running keeps it running, all done is done. */
export function combine(items: StepStatus[]): StepStatus {
  if (!items.length) return "idle";
  if (items.includes("fail")) return "fail";
  if (items.includes("running")) return "running";
  if (items.every((s) => s === "done")) return "done";
  if (items.some((s) => s === "done" || s === "warn")) return items.includes("warn") ? "warn" : "running";
  return "idle";
}

// ---------------------------------------------------------------------------------------------------------------- Matter

export function matterWorkflow(p: { prompt: string; sim: MatterSimulation | null; busy: boolean; stale: boolean; input: { generator: string; gen_params: Record<string, number>; spreader: Record<string, number> }; files: number }): Workflow {
  const sim = p.sim;
  const rung = (id: string) => sim?.ladder.find((r) => r.id === id);
  const solved = typeof sim?.metrics.peak_temp_c === "number";
  const run = p.busy ? ("running" as const) : null;
  const sp = p.input.spreader;
  const params = `${f1(sp.Q ?? 5, 0)} W chip · ${p.input.generator === "radial_spokes" ? "radial spokes" : "rectangular fins"}${p.input.gen_params.n_fins ? ` · ${p.input.gen_params.n_fins} fins` : ""}`;
  const eq = sim?.baselines.equal_material;
  const nodes: WfNode[] = [
    { id: "request", title: "Your request", kind: "input", status: "done", summary: p.prompt || "No request yet", col: 0, row: 0 },
    { id: "setup", title: "Set up the part", kind: "agent", status: sim ? "done" : (run ?? "idle"), summary: params, items: [{ label: `Plate ${f1(sp.n ?? 60, 0)} mm`, status: "done" }, { label: `Cooling h = ${f1(sp.h ?? 15, 0)} W/m²K`, status: "done" }], col: 1, row: 0 },
    {
      id: "shape",
      title: "Build the shape",
      kind: "tool",
      status: run ?? (sim ? combine([rungStatus(rung("M2")?.status), rungStatus(rung("M3")?.status)]) : "idle"),
      summary: sim ? (solved ? `${sim.metrics.material_cells} cells, ${f1((sim.metrics.material_fraction ?? 0) * 100, 0)}% material` : `Rejected: ${sim.first_failure ?? "a check"} failed before any solve`) : "Waiting for a simulation",
      items: [
        { label: "Valid geometry (M2)", status: rungStatus(rung("M2")?.status) },
        { label: "Printable (M3)", status: rungStatus(rung("M3")?.status) },
      ],
      open: "preview",
      col: 2,
      row: 0,
    },
    { id: "solve", title: "Solve the heat flow", kind: "tool", status: run ?? (solved ? "done" : sim ? "skipped" : "idle"), summary: solved ? `Hottest point ${f1(sim!.metrics.peak_temp_c!)} °C` : "No solution yet", items: [{ label: "Solver validated (M1)", status: rungStatus(rung("M1")?.status) }], open: "preview", col: 3, row: 0 },
    {
      id: "verify",
      title: "Verify and compare",
      kind: "check",
      status: run ?? (sim ? combine([rungStatus(rung("M4")?.status), rungStatus(rung("M5")?.status)]) : "idle"),
      summary: eq && sim?.verdict ? `${f1(Math.abs(eq.delta_k ?? 0), 2)} K ${(eq.delta_k ?? 0) >= 0 ? "cooler" : "hotter"} than plain fins, same material` : "Not compared yet",
      items: [
        { label: "Second solver agrees (M4)", status: rungStatus(rung("M4")?.status) },
        { label: "Beats plain fins (M5)", status: rungStatus(rung("M5")?.status) },
      ],
      open: "proof",
      col: 4,
      row: 0,
    },
    { id: "files", title: "Files", kind: "output", status: p.files > 0 ? "done" : "idle", summary: p.files > 0 ? "STL to print, and the settings" : "Appear after a simulation", open: "files", col: 5, row: 0 },
  ];
  if (p.stale && sim) nodes[1].summary += " (changed since the last run)";
  return { nodes, edges: chain(nodes) };
}

// ---------------------------------------------------------------------------------------------------------------- Board

export interface BoardLayoutInfo {
  status: "idle" | "loading" | "none" | "failed" | "ready";
  routed?: boolean;
  unrouted?: number;
  drcErrors?: number;
  drcWarnings?: number;
  boardMm?: [number, number];
  tracks?: number;
  parts?: number;
}

export function boardWorkflow(p: { prompt: string; design: { instances: unknown[]; nets: unknown[] } | null; check: BoardCheck | null; busy: boolean; stale: boolean; layout: BoardLayoutInfo; files: number }): Workflow {
  const run = p.busy ? ("running" as const) : null;
  const rungs = p.check?.rungs ?? [];
  const names: Record<string, string> = { B1: "Well formed", B2: "Electrical rules", B3: "Bus and connectors", B4: "Firmware pins match", B5: "Battery estimate" };
  const L = p.layout;
  const layoutStatus: StepStatus = L.status === "ready" ? (L.routed && (L.drcErrors ?? 0) === 0 ? "done" : "fail") : L.status === "loading" ? "running" : L.status === "none" || L.status === "failed" ? "skipped" : "idle";
  const nodes: WfNode[] = [
    { id: "request", title: "Your request", kind: "input", status: "done", summary: p.prompt || "No request yet", col: 0, row: 0 },
    { id: "design", title: "Design the board", kind: "agent", status: p.design ? "done" : (run ?? "idle"), summary: p.design ? `${p.design.instances.length} parts, ${p.design.nets.length} nets` : "No design yet", open: "preview", col: 1, row: 0 },
    {
      id: "layout",
      title: "Place and route",
      kind: "tool",
      status: layoutStatus,
      summary: L.status === "ready" ? `${L.boardMm?.[0]} × ${L.boardMm?.[1]} mm, 2 layers, ${L.tracks} tracks` : L.status === "none" ? "No routed board for this design yet" : L.status === "loading" ? "Loading the board" : "Not generated",
      items: [
        { label: "Placed by rules", status: L.status === "ready" ? "done" : "idle" },
        { label: L.status === "ready" ? (L.routed ? "All nets routed" : `${L.unrouted} not routed`) : "Routed", status: L.status === "ready" ? (L.routed ? "done" : "fail") : "idle" },
        { label: L.status === "ready" ? `KiCad rule check: ${L.drcErrors} errors` : "KiCad rule check", status: L.status === "ready" ? ((L.drcErrors ?? 0) === 0 ? "done" : "fail") : "idle" },
      ],
      open: "preview",
      col: 2,
      row: 0,
    },
    {
      id: "checks",
      title: "Check the design",
      kind: "check",
      status: run ?? (p.check ? combine(rungs.map((r) => rungStatus(r.status))) : "idle"),
      summary: p.check ? (p.check.passed ? "All five checks pass" : `${rungs.filter((r) => r.status === "pass").length} of ${rungs.length} pass`) : "Not checked yet",
      items: ["B1", "B2", "B3", "B4", "B5"].map((id) => ({ label: `${names[id]} (${id})`, status: rungStatus(rungs.find((r) => r.rung === id)?.status) })),
      open: "proof",
      col: 2,
      row: 1,
    },
    { id: "files", title: "Files", kind: "output", status: p.files > 0 ? "done" : "idle", summary: p.files > 0 ? `${p.files} files: Gerbers, KiCad board, BOM, pin header` : "Appear after the first check", open: "files", col: 3, row: 0 },
  ];
  const checks = nodes.find((n) => n.id === "checks");
  if (p.stale && p.check && checks) checks.summary += " (design changed since)";
  return {
    nodes,
    edges: [
      { from: "request", to: "design" },
      { from: "design", to: "layout" },
      { from: "design", to: "checks" },
      { from: "layout", to: "files" },
      { from: "checks", to: "files" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------- Silicon

const SILICON_STEPS: Array<[string, string]> = [
  ["lint", "Code is clean"],
  ["unit", "A million test inputs"],
  ["prove", "Proved for every input"],
  ["e2e", "Whole program output"],
  ["bench", "Cycles counted"],
  ["synth", "Chip area"],
];

export function siliconWorkflow(p: { prompt: string; phase: "idle" | "running" | "done" | "failed"; node: NodeState | null; files: number; workload: string }): Workflow {
  const n = p.node;
  const running = p.phase === "running";
  const stage = (id: string): StepStatus => {
    const s = n?.stages[id as keyof NonNullable<typeof n>["stages"]]?.status;
    return s === "pass" ? "done" : s === "fail" ? "fail" : s === "running" ? "running" : s === "skipped" ? "skipped" : running && n ? "idle" : "idle";
  };
  const impl = stage("implement");
  const items = SILICON_STEPS.map(([id, label]) => ({ label, status: stage(id) }));
  const score = n?.score;
  const nodes: WfNode[] = [
    { id: "request", title: "Your request", kind: "input", status: p.phase === "idle" ? "idle" : "done", summary: p.prompt || "Pick a kernel", col: 0, row: 0 },
    { id: "propose", title: "Propose an instruction", kind: "agent", status: n?.proposal ? "done" : running ? "running" : "idle", summary: n?.proposal ? `${n.proposal.mnemonic}: ${n.proposal.title ?? ""}`.trim() : "Nemotron Ultra reads the hot loop", col: 1, row: 0 },
    { id: "implement", title: "Write the hardware", kind: "agent", status: impl !== "idle" ? impl : n?.proposal && running ? "running" : "idle", summary: impl === "done" ? "Verilog, C reference and the kernel rewrite written" : impl === "fail" ? "The implementation could not be produced" : "Nemotron Super writes the RTL", open: "files", col: 2, row: 0 },
    { id: "verify", title: "Prove it", kind: "check", status: combine(items.map((i) => i.status)), summary: score ? (score.feasible ? "Every check passed" : "A check failed") : "Runs in a Token Factory Sandbox", items, open: "proof", col: 3, row: 0 },
    {
      id: "result",
      title: "Result",
      kind: "output",
      status: p.phase === "failed" ? "fail" : score?.feasible ? "done" : p.phase === "done" ? "warn" : "idle",
      summary: score?.feasible && Number.isFinite(score.speedup) && score.speedup > 0 ? `${f1(score.speedup, 2)}× fewer cycles, ${p.files} files` : p.phase === "done" ? "No verified speedup" : "Waiting",
      open: "files",
      col: 4,
      row: 0,
    },
  ];
  return { nodes, edges: chain(nodes) };
}

function chain(nodes: WfNode[]): Workflow["edges"] {
  return nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
}

export const STATUS_WORDS: Record<StepStatus, string> = { idle: "waiting", running: "running", done: "done", fail: "failed", warn: "needs a look", skipped: "skipped" };
