// Read-only tools for the agent endpoint. They read the recorded replays (the same files the UI plays) through the same reducer,
// so the agent can only quote what the event streams say. Pure apart from the replay loader, which is injected.
// Every result carries `evidence` ids ("run:<run>/<node>" or "run:<run>/<node>#<metric>") the answer must cite.

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
}

export type ReplayLoader = {
  list(): Promise<string[]>;
  load(runId: string): Promise<RunState | null>;
};

const RUN_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const NODE_ID = /^[A-Za-z0-9_.]{1,32}$/;
const METRICS: EvidenceMetric[] = ["wall_speedup", "cycles", "area", "fmax"];

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** OpenAI-style function definitions. Read-only: no tool starts a run or changes anything. */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: "library_search",
    description: "Find verified instructions (feasible, proven nodes) across the recorded runs by mnemonic or title text. Empty query lists the best ones.",
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
    name: "library_lookup",
    description: "Search the evidence library (stored manifests of proven instructions) by id, title or mnemonic. Returns each entry's manifest summary and the exact reproduce command (shown, not run). Empty query lists all.",
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
      "Simulate a heat-spreader plate with one of the built-in generators (rect_fins or radial_spokes) through the validated solver and the ladder M1 to M5. Returns peak temperature, both rectangular-fin baselines and the honest verdict. Numbers only; defaults are used for anything omitted.",
    parameters: {
      type: "object",
      properties: {
        generator: { type: "string", enum: ["rect_fins", "radial_spokes"] },
        gen_params: { type: "object", additionalProperties: { type: "number" } },
        Q: { type: "number" },
        budget_fraction: { type: "number" },
        h: { type: "number" },
        k: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "run_explain_failure",
    description: "Explain why a node was pruned or failed a rung: the failing stage per attempt, its detail, and the prune reason, from the run's events.",
    parameters: { type: "object", properties: { run_id: { type: "string" }, node_id: { type: "string" } }, required: ["run_id", "node_id"], additionalProperties: false },
  },
];

export type ToolResult = { ok: true; summary: string; data: unknown; evidence: string[] } | { ok: false; error: string };

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

const clip = (s: string | undefined, n: number) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function runTool(name: string, raw: unknown, loader: ReplayLoader, ctx: ToolContext = {}): Promise<ToolResult> {
  const v = validateArgs(name, raw);
  if (!v.ok) return { ok: false, error: v.error };
  const a = v.args;
  switch (name) {
    case "library_search": {
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
    case "library_lookup": {
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
      if (out.length === 0) return { ok: true, summary: "no library entry matches", data: [], evidence: [] };
      return { ok: true, summary: `${out.length} library entr${out.length === 1 ? "y" : "ies"}`, data: out.map(manifestSummary), evidence: out.map((m) => `library:${m.id}`) };
    }
    case "board_check": {
      if (!ctx.hosted) return { ok: false, error: "the Board checker is not available here" };
      if ((a.template_id === undefined) === (a.design_json === undefined)) return { ok: false, error: "give exactly one of template_id or design_json" };
      let design: string;
      let label: string;
      if (a.template_id !== undefined) {
        const id = String(a.template_id);
        if (!/^[a-z0-9_]{1,64}$/.test(id)) return { ok: false, error: "template_id is not valid" };
        const t = await ctx.hosted(`/api/board/templates/${id}`);
        if (!t.ok) return { ok: false, error: `unknown template ${id}` };
        design = JSON.stringify(((await t.json()) as { design: unknown }).design);
        label = id;
      } else {
        design = String(a.design_json);
        label = "custom";
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
      return { ok: true, summary: `${label}: ${passN} of ${rungs.length} rungs pass${j.passed ? "" : "; unknown or failing rungs do not count"}`, data: { template: label, passed: !!j.passed, rungs, notice: j.notice, note: "Netlist-level check with author-curated facts; not a claim the board works." }, evidence: [...evidence] };
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
      const bad = validateLocally(input);
      if (bad.length) return { ok: false, error: bad.map((b) => `${b.path} ${b.message}`).join("; ") };
      const res = await ctx.hosted("/api/matter/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const j = (await res.json()) as { error?: { message?: string; field?: string }; ladder?: Array<{ id: string; status: string; label: string | null; detail: string }>; metrics?: { peak_temp_c: number; material_fraction: number }; baselines?: Record<string, { peak_temp_c: number; delta_k: number }>; verdict?: { label: string; lower_bound_peak_c: number; note: string } | null };
      if (!res.ok || !j.ladder) return { ok: false, error: j.error ? `${j.error.field ?? ""} ${j.error.message ?? ""}`.trim() : `the simulator answered ${res.status}` };
      const id = `matter:${generator}`;
      const passN = j.ladder.filter((r) => r.status === "pass").length;
      return {
        ok: true,
        summary: `${generator}: peak ${j.metrics?.peak_temp_c.toFixed(1)} C, ${passN} of ${j.ladder.length} rungs pass`,
        data: {
          generator,
          inputs: input,
          peak_temp_c: j.metrics?.peak_temp_c,
          material_fraction: j.metrics?.material_fraction,
          rungs: j.ladder.map((r) => ({ rung: r.id, status: r.status, claim: r.status === "pass" ? r.label : null, detail: clip(r.detail, 240), evidence_id: `${id}#${r.id}` })),
          baselines: j.baselines,
          verdict: j.verdict ? { label: j.verdict.label, lower_bound_peak_c: j.verdict.lower_bound_peak_c, note: j.verdict.note } : null,
          note: "2D steady-state model; margins over the rectangular-fin baselines are small; not validated on a printed part.",
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
