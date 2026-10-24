// Read-only tools for the agent endpoint. They read the recorded replays (the same files the UI plays) through the same reducer,
// so the agent can only quote what the event streams say. Pure apart from the replay loader, which is injected.
// Every result carries `evidence` ids ("run:<run>/<node>" or "run:<run>/<node>#<metric>") the answer must cite.

import type { PendingAction } from "./agent";
import type { UiAction } from "./agent-actions";
import type { WorkbenchId } from "./brand";
import { buildEvidence, type EvidenceMetric } from "./evidence";
import { defaultSimulateInput, MATTER_GENERATORS, validateLocally, type MatterGenerator, type SimulateInput } from "./hosted";
import { isEntryId, reproduceMatches, type ManifestStore } from "./manifest";
import { parseNdjson } from "./events";
import { reduceAll, wallOf, type RunState } from "./run-state";

/** Calls the hosted Board/Matter functions of this same deployment (path like "/api/board/check"). Injected so tests need no network. */
export type HostedCaller = (path: string, init?: RequestInit) => Promise<Response>;

export interface ToolContext {
  manifests?: ManifestStore;
  hosted?: HostedCaller;
  /** The design currently on the Board canvas, from the app state (absent when the app sent none). */
  boardDesign?: unknown;
}

export type ReplayLoader = {
  list(): Promise<string[]>;
  load(runId: string): Promise<RunState | null>;
};

const RUN_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const NODE_ID = /^[A-Za-z0-9_.]{1,32}$/;
const METRICS: EvidenceMetric[] = ["wall_speedup", "cycles", "area", "fmax"];

/** The two live Silicon workloads. */
export const SILICON_WORKLOADS = { w1: { title: "the TinyMaix int8 fully-connected layer" }, w2: { title: "the Monocypher ChaCha20 stream cipher" } } as const;
export const SILICON_RUN_CAP_USD = 0.15;

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** OpenAI-style function definitions. Read-only: no tool starts a run or changes anything. */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: "run_nodes_search",
    description:
      "Find scored candidate nodes in the RECORDED RUNS by mnemonic or title (these are run nodes, not library entries, and they have no reproduce command). Use library_search for the evidence library.",
    parameters: { type: "object", properties: { query: { type: "string", maxLength: 80 } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "evidence_get",
    description:
      "Get stored evidence. With entry_id: the library entry's manifest (ladder, claims and what is NOT claimed, tool versions, artifact hashes) and the exact reproduce command, which is shown and never run. With run_id, node_id and metric: the evidence behind one number of a scored node in a recorded run.",
    parameters: {
      type: "object",
      properties: { entry_id: { type: "string" }, run_id: { type: "string" }, node_id: { type: "string" }, metric: { type: "string", enum: METRICS } },
      additionalProperties: false,
    },
  },
  {
    name: "library_search",
    description:
      "Search the EVIDENCE LIBRARY (stored manifests of proven instructions) by id, title or mnemonic; an empty query lists every entry. Returns each entry's id, mnemonic, workload, metrics, ladder, claims, not_claimed, tool versions and the exact `reproduce` string. Quote `reproduce` verbatim; commands exist only for these entries.",
    parameters: { type: "object", properties: { query: { type: "string", maxLength: 80 } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "board_check",
    description:
      "Run the deterministic Board checker (rungs B1 to B5) on a real template (clean_sensor, fault_gpio12_vs_gpio14, fault_strapping_pin) or on a design JSON text. Returns per-rung pass, fail or unknown with the cited fact ids. Netlist-level only; facts are author-curated.",
    parameters: { type: "object", properties: { template_id: { type: "string", maxLength: 64 }, design_json: { type: "string", maxLength: 12000 } }, additionalProperties: false },
  },
  {
    name: "matter_simulate",
    description:
      "Simulate a heat-spreader plate with one of the built-in generators (rect_fins or radial_spokes) through the validated solver and the ladder M1 to M5. Returns peak temperature, both rectangular-fin baselines and the honest verdict. Numbers only; defaults are used for anything omitted. Q is the chip power in watts, plate_mm the plate's side in millimetres (30 to 80, one cell is 1 mm; default 60), h the convection coefficient (15 is still air).",
    parameters: {
      type: "object",
      properties: {
        generator: { type: "string", enum: ["rect_fins", "radial_spokes"] },
        gen_params: { type: "object", additionalProperties: { type: "number" } },
        Q: { type: "number" },
        budget_fraction: { type: "number" },
        h: { type: "number" },
        k: { type: "number" },
        plate_mm: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "board_set_design",
    description:
      "Put a full design JSON on the Board canvas and check it (rungs B1 to B5). Use it to apply an edit to the user's current design (change a pin or a value): copy the current design from the app context, change only what was asked, send the whole object.",
    parameters: { type: "object", properties: { design_json: { type: "string", maxLength: 12000 } }, required: ["design_json"], additionalProperties: false },
  },
  {
    name: "board_fix_pin",
    description:
      "Fix a pin mix-up with a tiny edit instead of resending the design: set the firmware pin for one function (for example wake_btn) to a different GPIO, then re-check. Edits the design on the canvas, or a built-in example when template_id is given. Use it for 'fix it' when a check says the firmware pin and the netlist pin disagree or a pin is unsafe.",
    parameters: {
      type: "object",
      properties: { function: { type: "string", maxLength: 40 }, pin: { type: "string", pattern: "^[A-Za-z0-9_]{1,16}$" }, template_id: { type: "string", maxLength: 64 } },
      required: ["function", "pin"],
      additionalProperties: false,
    },
  },
  {
    name: "workbench_open",
    description: "Switch the app to a workbench.",
    parameters: { type: "object", properties: { workbench: { type: "string", enum: ["silicon", "board", "matter"] } }, required: ["workbench"], additionalProperties: false },
  },
  {
    name: "silicon_open_run",
    description: "Open a recorded Silicon run (and optionally a node) in the app. The run must exist; use run_nodes_search or the context to find ids.",
    parameters: { type: "object", properties: { run_id: { type: "string" }, node_id: { type: "string" } }, required: ["run_id"], additionalProperties: false },
  },
  {
    name: "workflow_focus",
    description: "Move the app's workflow bar to a step.",
    parameters: { type: "object", properties: { step: { type: "string", enum: ["brief", "propose", "verify", "evidence", "export"] } }, required: ["step"], additionalProperties: false },
  },
  {
    name: "propose_board_design",
    description:
      "Propose a bounded live loop that SPENDS CREDITS: Nemotron drafts a Board design for the brief, the free checker judges it, up to 2 repairs, hard cap about $0.05 and 90 s. This only proposes: the user must click Run. Say that, and do not claim it ran.",
    parameters: { type: "object", properties: { brief: { type: "string", maxLength: 500 } }, required: ["brief"], additionalProperties: false },
  },
  {
    name: "propose_matter_optimize",
    description:
      "Propose a bounded live loop that SPENDS CREDITS: up to 6 simulations adjusting the generator's parameters toward a lower peak temperature, hard cap about $0.05 and 90 s. This only proposes: the user must click Run. Say that, and do not claim it ran.",
    parameters: { type: "object", properties: { generator: { type: "string", enum: ["rect_fins", "radial_spokes"] } }, additionalProperties: false },
  },
  {
    name: "propose_silicon_run",
    description:
      "Propose a LIVE Silicon run that SPENDS CREDITS: the agent invents ONE custom RISC-V instruction for a workload (w1 = the TinyMaix int8 fully-connected layer (a dot product), w2 = the Monocypher ChaCha20 stream cipher), writes the hardware and the C rewrite, and the verifiers run in a sandbox (lint, a million random vectors, formal proof, whole-program output check, cycle count). Hard cap about $0.15 and 4 minutes. This only proposes: the user must click Run. Say that, and do not claim it ran.",
    parameters: { type: "object", properties: { workload: { type: "string", enum: ["w1", "w2"] } }, required: ["workload"], additionalProperties: false },
  },
  {
    name: "run_explain_failure",
    description: "Explain why a node was pruned or failed a rung: the failing stage per attempt, its detail, and the prune reason, from the run's events.",
    parameters: { type: "object", properties: { run_id: { type: "string" }, node_id: { type: "string" } }, required: ["run_id", "node_id"], additionalProperties: false },
  },
];

/**
 * A tool's outcome. `ui` are actions the app should mirror (load a template, set parameters, run the check...): the server already executed
 * the free tool itself, the app only shows it. `proposal` is a credit-spending loop the user must confirm with a click.
 */
export type ToolResult = { ok: true; summary: string; data: unknown; evidence: string[]; ui?: UiAction[]; proposal?: Omit<PendingAction, "id"> } | { ok: false; error: string };

type Args = Record<string, unknown>;

/** Hand-rolled validation of the model's arguments (no extra dependency): unknown keys, wrong types and bad ids are rejected. */
export function validateArgs(name: string, raw: unknown): { ok: true; args: Args } | { ok: false; error: string } {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return { ok: false, error: `unknown tool ${name}` };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "arguments must be an object" };
  const a = raw as Args;
  const props = (def.parameters.properties ?? {}) as Record<string, { type: string; enum?: string[]; maxLength?: number }>;
  const required = (def.parameters.required ?? []) as string[];
  for (const k of Object.keys(a)) if (!(k in props)) return { ok: false, error: `unexpected argument ${k}` };
  for (const k of required) if (!(k in a)) return { ok: false, error: `missing argument ${k}` };
  for (const [k, spec] of Object.entries(props)) {
    if (!(k in a)) continue;
    const v = a[k];
    if (spec.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `${k} must be a number` };
      continue;
    }
    if (spec.type === "object") {
      if (typeof v !== "object" || v === null || Array.isArray(v) || Object.keys(v).length > 8 || !Object.values(v).every((x) => typeof x === "number" && Number.isFinite(x))) return { ok: false, error: `${k} must be an object of at most 8 numbers` };
      continue;
    }
    if (typeof v !== "string") return { ok: false, error: `${k} must be a string` };
    if (spec.maxLength && v.length > spec.maxLength) return { ok: false, error: `${k} is too long` };
    if (spec.enum && !spec.enum.includes(v)) return { ok: false, error: `${k} must be one of ${spec.enum.join(", ")}` };
    if (k === "run_id" && !RUN_ID.test(v)) return { ok: false, error: "run_id is not valid" };
    if (k === "node_id" && !NODE_ID.test(v)) return { ok: false, error: "node_id is not valid" };
  }
  return { ok: true, args: a };
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The tools a workbench's agent is offered: its own, plus the shared lookups. Fewer tools means fewer tokens and fewer wrong calls. */
export function toolsFor(workbench?: WorkbenchId): ToolDef[] {
  const shared = ["library_search", "evidence_get", "workbench_open", "workflow_focus"];
  const own: Record<WorkbenchId, string[]> = {
    board: ["board_check", "board_set_design", "board_fix_pin", "propose_board_design"],
    matter: ["matter_simulate", "propose_matter_optimize"],
    silicon: ["run_nodes_search", "run_explain_failure", "silicon_open_run", "propose_silicon_run"],
  };
  const names = workbench ? [...shared, ...own[workbench]] : TOOL_DEFS.map((t) => t.name);
  return TOOL_DEFS.filter((t) => names.includes(t.name));
}

const clip = (s: string | undefined, n: number) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function runTool(name: string, raw: unknown, loader: ReplayLoader, ctx: ToolContext = {}): Promise<ToolResult> {
  const v = validateArgs(name, raw);
  if (!v.ok) return { ok: false, error: v.error };
  const a = v.args;
  switch (name) {
    case "run_nodes_search": {
      const q = String(a.query).trim().toLowerCase();
      const hits: Array<{ run_id: string; node_id: string; mnemonic: string; title: string; wall_speedup: number; area_delta_pct: number }> = [];
      for (const id of await loader.list()) {
        const s = await loader.load(id);
        if (!s || s.domain !== "silicon") continue;
        for (const nid of s.order) {
          const n = s.nodes[nid];
          if (!n.score?.feasible || !n.proposal) continue;
          const text = `${n.proposal.mnemonic} ${n.proposal.title}`.toLowerCase();
          if (q && !text.includes(q)) continue;
          hits.push({ run_id: id, node_id: nid, mnemonic: n.proposal.mnemonic, title: n.proposal.title, wall_speedup: wallOf(n.score), area_delta_pct: n.score.area_delta_pct });
        }
      }
      hits.sort((x, y) => y.wall_speedup - x.wall_speedup);
      const top = hits.slice(0, 8);
      return {
        ok: true,
        summary: `${hits.length} verified node${hits.length === 1 ? "" : "s"} match${top.length < hits.length ? ` (top ${top.length} shown)` : ""}`,
        data: top.map((h) => ({ ...h, evidence_id: `run:${h.run_id}/${h.node_id}` })),
        evidence: top.map((h) => `run:${h.run_id}/${h.node_id}`),
      };
    }
    case "evidence_get": {
      if (a.entry_id !== undefined) {
        const m = isEntryId(a.entry_id) ? await ctx.manifests?.get(a.entry_id) : null;
        if (!m) return { ok: false, error: `library entry ${String(a.entry_id)} does not exist` };
        return libraryResult(m);
      }
      if (a.run_id === undefined || a.node_id === undefined || a.metric === undefined) return { ok: false, error: "give entry_id, or run_id with node_id and metric" };
      const s = await loader.load(String(a.run_id));
      if (!s) return { ok: false, error: `run ${String(a.run_id)} is not recorded` };
      const ev = buildEvidence(s, String(a.node_id), a.metric as EvidenceMetric, "replay");
      if (!ev) return { ok: false, error: `no ${String(a.metric)} evidence for ${String(a.node_id)}: the node is not scored or the figure was not measured` };
      const id = `run:${ev.runId}/${ev.nodeId}#${ev.metric}`;
      return {
        ok: true,
        summary: `${ev.label} ${ev.value}`,
        data: { evidence_id: id, label: ev.label, value: ev.value, tool: ev.tool, version: ev.version ?? "not recorded", event_seq: ev.seqs, basis: ev.basis, reproduce: ev.command },
        evidence: [id],
      };
    }
    case "library_search": {
      const store = ctx.manifests;
      if (!store) return { ok: false, error: "the evidence library is not installed on this deployment" };
      const q = String(a.query).trim().toLowerCase();
      const out: LibraryManifest[] = [];
      for (const id of await store.ids()) {
        const m = await store.get(id);
        if (!m || !reproduceMatches(m)) continue;
        const text = `${m.id} ${m.title} ${m.instruction.mnemonic} ${m.instruction.cpu_carries.join(" ")}`.toLowerCase();
        if (!q || text.includes(q)) out.push(m);
      }
      if (out.length === 0) return { ok: true, summary: "no library entry matches; there is no reproduce command for anything else", data: [], evidence: [] };
      return { ok: true, summary: `${out.length} library entr${out.length === 1 ? "y" : "ies"}`, data: out.map(manifestSummary), evidence: out.map((m) => `library:${m.id}`) };
    }
    case "board_check": {
      if (!ctx.hosted) return { ok: false, error: "the Board checker is not available here" };
      if ((a.template_id === undefined) === (a.design_json === undefined)) return { ok: false, error: "give exactly one of template_id or design_json" };
      let design: string;
      let label: string;
      const ui: UiAction[] = [];
      if (a.template_id !== undefined) {
        const id = String(a.template_id);
        if (!/^[a-z0-9_]{1,64}$/.test(id)) return { ok: false, error: "template_id is not valid" };
        const t = await ctx.hosted(`/api/board/templates/${id}`);
        if (!t.ok) return { ok: false, error: `unknown template ${id}` };
        design = JSON.stringify(((await t.json()) as { design: unknown }).design);
        label = id;
        ui.push({ name: "board.load_template", args: { template_id: id } });
      } else {
        design = String(a.design_json);
        label = "custom";
        const parsed = parseObject(design);
        if (parsed) ui.push({ name: "board.set_design", args: { design: parsed } });
      }
      const res = await ctx.hosted("/api/board/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ design }) });
      const j = (await res.json()) as { ok?: boolean; error?: { message?: string }; passed?: boolean; rungs?: Array<{ rung: string; status: string; label: string | null; detail: string; evidence: string[] }>; notice?: string };
      if (!res.ok || !j.rungs) return { ok: false, error: j.error?.message ?? `the checker answered ${res.status}` };
      const evidence = new Set<string>();
      const rungs = j.rungs.map((r) => {
        evidence.add(`board:${label}#${r.rung}`);
        if (r.status !== "pass") for (const f of r.evidence.slice(0, 6)) evidence.add(f);
        return { rung: r.rung, status: r.status, claim: r.status === "pass" ? r.label : null, detail: clip(r.detail, 320), facts: r.status === "pass" ? undefined : r.evidence.slice(0, 6), evidence_id: `board:${label}#${r.rung}` };
      });
      const passN = rungs.filter((r) => r.status === "pass").length;
      ui.push({ name: "board.check", args: {} });
      return { ok: true, ui, summary: `${label}: ${passN} of ${rungs.length} rungs pass${j.passed ? "" : "; unknown or failing rungs do not count"}`, data: { template: label, passed: !!j.passed, rungs, notice: j.notice, note: `Netlist-level check with author-curated facts; not a claim the board works.${a.template_id !== undefined ? " This is a built-in example design, NOT the user's own board: say so." : ""}` }, evidence: [...evidence] };
    }
    case "board_fix_pin": {
      if (!ctx.hosted) return { ok: false, error: "the Board checker is not available here" };
      let design: unknown = ctx.boardDesign;
      if (typeof design === "string") design = parseObject(design);
      if (a.template_id !== undefined) {
        const id = String(a.template_id);
        if (!/^[a-z0-9_]{1,64}$/.test(id)) return { ok: false, error: "template_id is not valid" };
        const tr = await ctx.hosted(`/api/board/templates/${id}`);
        if (!tr.ok) return { ok: false, error: `unknown template ${id}` };
        design = ((await tr.json()) as { design: unknown }).design;
      }
      const d = design as { firmware_pins?: Array<{ function?: string; pin?: string }> } | null;
      if (!d || !Array.isArray(d.firmware_pins)) return { ok: false, error: "no design with a firmware pin table to edit; check a design first" };
      const row = d.firmware_pins.find((p) => p.function === String(a.function));
      if (!row) return { ok: false, error: `the firmware pin table has no function ${String(a.function)}; it has: ${d.firmware_pins.map((p) => p.function).join(", ")}` };
      const before = row.pin;
      row.pin = String(a.pin);
      const r = await runTool("board_check", { design_json: JSON.stringify(d) }, loader, ctx);
      if (!r.ok) return r;
      return { ...r, summary: `moved firmware ${String(a.function)} from ${before} to ${row.pin}; ${r.summary}` };
    }
    case "board_set_design": {
      const r = await runTool("board_check", { design_json: a.design_json }, loader, ctx);
      return r;
    }
    case "workbench_open":
      return { ok: true, summary: `opened ${String(a.workbench)}`, data: { workbench: a.workbench }, evidence: [], ui: [{ name: "workbench.open", args: { workbench: a.workbench as WorkbenchId } }] };
    case "workflow_focus":
      return { ok: true, summary: `focused ${String(a.step)}`, data: { step: a.step }, evidence: [], ui: [{ name: "workflow.focus", args: { step: a.step as "brief" } }] };
    case "silicon_open_run": {
      const runId = String(a.run_id);
      const s = await loader.load(runId);
      if (!s) return { ok: false, error: `run ${runId} is not recorded` };
      const node = a.node_id === undefined ? undefined : String(a.node_id);
      if (node !== undefined && !s.nodes[node]) return { ok: false, error: `node ${node} does not exist in ${runId}` };
      return { ok: true, summary: `opened ${runId}${node ? ` at ${node}` : ""}`, data: { run_id: runId, node_id: node ?? null, title: s.workload?.title }, evidence: [`run:${runId}${node ? `/${node}` : ""}`].filter((e) => e.includes("/")), ui: [{ name: "silicon.open_run", args: node ? { run_id: runId, node_id: node } : { run_id: runId } }] };
    }
    case "propose_board_design": {
      const brief = String(a.brief).trim();
      if (!brief) return { ok: false, error: "give a short brief" };
      return { ok: true, summary: "proposed a Board design loop (needs the user's click)", data: { status: "waiting for the user to click Run; nothing has been run or spent", cap_usd: 0.05 }, evidence: [], proposal: { tool: "board_design", summary: `Draft a Board design for: ${brief.slice(0, 120)}. The free checker judges it; up to 2 repairs.`, costEstimateUsd: 0.05, args: { brief } } };
    }
    case "propose_silicon_run": {
      const workload = String(a.workload) as "w1" | "w2";
      const what = SILICON_WORKLOADS[workload];
      return {
        ok: true,
        summary: "proposed a live Silicon run (needs the user's click)",
        data: { status: "waiting for the user to click Run; nothing has been run or spent", cap_usd: SILICON_RUN_CAP_USD, workload: what.title },
        evidence: [],
        ui: [{ name: "workbench.open", args: { workbench: "silicon" } }],
        proposal: { tool: "silicon_run", summary: `Invent and prove one custom instruction for ${what.title} (about 4 minutes at most).`, costEstimateUsd: SILICON_RUN_CAP_USD, args: { workload } },
      };
    }
    case "propose_matter_optimize": {
      const generator = (a.generator ?? "rect_fins") as MatterGenerator;
      return { ok: true, summary: "proposed a Matter optimisation loop (needs the user's click)", data: { status: "waiting for the user to click Run; nothing has been run or spent", cap_usd: 0.05 }, evidence: [], proposal: { tool: "matter_optimize", summary: `Search ${MATTER_GENERATORS[generator].label.toLowerCase()} parameters for a lower peak temperature: up to 6 simulations.`, costEstimateUsd: 0.05, args: { generator } } };
    }
    case "matter_simulate": {
      if (!ctx.hosted) return { ok: false, error: "the Matter simulator is not available here" };
      const generator = (a.generator ?? "rect_fins") as MatterGenerator;
      const gp = (a.gen_params ?? {}) as Record<string, number>;
      const allowed = new Set<string>(MATTER_GENERATORS[generator].params.map((p) => p.key));
      for (const k of Object.keys(gp)) if (!allowed.has(k)) return { ok: false, error: `gen_params.${k} is not a parameter of ${generator}; use ${[...allowed].join(", ")}` };
      const input: SimulateInput = defaultSimulateInput(generator);
      Object.assign(input.gen_params, gp);
      for (const k of ["Q", "budget_fraction", "h", "k"] as const) if (a[k] !== undefined) input.spreader[k] = a[k] as number;
      if (a.plate_mm !== undefined) {
        const n = Math.round(a.plate_mm as number);
        if (n < 30 || n > 80) return { ok: false, error: "plate_mm must be between 30 and 80 (the solver's grid is 1 mm per cell)" };
        input.spreader.n = n;
      }
      const bad = validateLocally(input);
      if (bad.length) return { ok: false, error: bad.map((b) => `${b.path} ${b.message}`).join("; ") };
      const res = await ctx.hosted("/api/matter/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const j = (await res.json()) as { error?: { message?: string; field?: string }; ladder?: Array<{ id: string; status: string; label: string | null; detail: string }>; metrics?: { peak_temp_c?: number; material_fraction?: number }; baselines?: Record<string, { peak_temp_c: number; delta_k: number | null } | null>; verdict?: { label: string; lower_bound_peak_c: number; note: string } | null };
      if (!res.ok || !j.ladder) return { ok: false, error: j.error ? `${j.error.field ?? ""} ${j.error.message ?? ""}`.trim() : `the simulator answered ${res.status}` };
      const id = `matter:${generator}`;
      const passN = j.ladder.filter((r) => r.status === "pass").length;
      return {
        ok: true,
        ui: [
          { name: "matter.set_params", args: { generator, gen_params: input.gen_params, spreader: input.spreader } },
          { name: "matter.simulate", args: {} },
        ],
        summary: j.metrics?.peak_temp_c === undefined ? `${generator}: no solve (${j.ladder.find((r) => r.status === "fail")?.detail ?? "geometry rejected"}), ${passN} of ${j.ladder.length} rungs pass` : `${generator}: peak ${j.metrics.peak_temp_c.toFixed(1)} C, ${passN} of ${j.ladder.length} rungs pass`,
        data: {
          generator,
          inputs: input,
          peak_temp_c: j.metrics?.peak_temp_c,
          material_fraction: j.metrics?.material_fraction,
          rungs: j.ladder.map((r) => ({ rung: r.id, status: r.status, claim: r.status === "pass" ? r.label : null, detail: clip(r.detail, 240), evidence_id: `${id}#${r.id}` })),
          baselines: j.baselines,
          verdict: j.verdict ? { label: j.verdict.label, lower_bound_peak_c: j.verdict.lower_bound_peak_c, note: j.verdict.note } : null,
          note: "2D steady-state model; margins over the rectangular-fin baselines are small; not validated on a printed part.",
          ...(j.metrics?.peak_temp_c === undefined ? { next_step: "Nothing was solved, so there is NO temperature yet. Do not quote one. Call matter_simulate again with fewer or thinner fins (a smaller n_fins or fin_len, or a larger budget_fraction), or tell the user it could not be solved." } : {}),
        },
        evidence: j.ladder.map((r) => `${id}#${r.id}`),
      };
    }
    case "run_explain_failure": {
      const runId = String(a.run_id);
      const s = await loader.load(runId);
      if (!s) return { ok: false, error: `run ${runId} is not recorded` };
      const n = s.nodes[String(a.node_id)];
      if (!n) return { ok: false, error: `node ${String(a.node_id)} does not exist in ${runId}` };
      const failures = n.attempts.flatMap((at) =>
        Object.entries(at.stages)
          .filter(([, r]) => r?.status === "fail")
          .map(([stage, r]) => ({ attempt: at.attempt, stage, detail: clip(r?.detail, 400) })),
      );
      const logs = n.evidence.map((e) => ({ attempt: e.attempt, stage: e.stage, has_counterexample: !!e.counterexample, log: clip(e.log, 500) }));
      const id = `run:${runId}/${n.id}`;
      const scoredOk = !!(n.score?.feasible || n.domainScore?.feasible);
      return {
        ok: true,
        summary: n.pruned ? `${n.id} was pruned: ${clip(n.pruned.reason, 120)}` : scoredOk ? `${n.id} did not fail; it is scored` : `${n.id} has no recorded failure`,
        data: { evidence_id: id, node_id: n.id, proposal: n.proposal ? { mnemonic: n.proposal.mnemonic, title: n.proposal.title } : null, pruned: n.pruned ? { reason: clip(n.pruned.reason, 400), kind: n.pruned.kind } : null, failures, logs },
        evidence: [id],
      };
    }
  }
  return { ok: false, error: `unknown tool ${name}` };
}

type LibraryManifest = import("./manifest").LibraryManifest;

function manifestSummary(m: LibraryManifest) {
  return {
    id: m.id,
    title: m.title,
    instruction: m.instruction.mnemonic,
    workload: m.source.workload,
    speedup: m.metrics.speedup,
    cpu_carries: m.instruction.cpu_carries,
    kind: m.kind,
    source: m.source,
    metrics: m.metrics,
    ladder: m.ladder,
    claims: m.claims,
    not_claimed: m.not_claimed,
    tools: m.tools,
    artifacts: m.artifacts.map((x) => ({ path: x.path, sha256: x.sha256 })),
    reproduce: m.reproduce,
    reproduce_note: "This command is shown, not run. It re-runs lint, vectors and the formal proof offline with no model.",
    evidence_id: `library:${m.id}`,
  };
}

function libraryResult(m: LibraryManifest): ToolResult {
  if (!reproduceMatches(m)) return { ok: false, error: `library entry ${m.id} carries an unexpected reproduce command, so it is not shown` };
  return { ok: true, summary: `${m.id}: ${m.instruction.mnemonic}, ladder ${Object.entries(m.ladder).map(([k, v]) => `${k} ${v}`).join(" ")}`, data: manifestSummary(m), evidence: [`library:${m.id}`] };
}

/** Server-side loader over `public/replays` (read once per process, parsed lazily). */
export function fsReplayLoader(dir: string): ReplayLoader {
  const cache = new Map<string, RunState | null>();
  return {
    async list() {
      const { readdir } = await import("node:fs/promises");
      return (await readdir(dir)).filter((f) => f.endsWith(".ndjson")).map((f) => f.replace(/\.ndjson$/, "")).sort();
    },
    async load(runId) {
      if (!RUN_ID.test(runId)) return null;
      if (cache.has(runId)) return cache.get(runId)!;
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      let state: RunState | null = null;
      try {
        state = reduceAll(parseNdjson(await readFile(join(dir, `${runId}.ndjson`), "utf8")).events);
      } catch {
        state = null;
      }
      cache.set(runId, state);
      return state;
    },
  };
}
