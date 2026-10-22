// Read-only tools for the agent endpoint. They read the recorded replays (the same files the UI plays) through the same reducer,
// so the agent can only quote what the event streams say. Pure apart from the replay loader, which is injected.
// Every result carries `evidence` ids ("run:<run>/<node>" or "run:<run>/<node>#<metric>") the answer must cite.

import { buildEvidence, type EvidenceMetric } from "./evidence";
import { parseNdjson } from "./events";
import { reduceAll, wallOf, type RunState } from "./run-state";

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
    name: "library.search",
    description: "Find verified instructions (feasible, proven nodes) across the recorded runs by mnemonic or title text. Empty query lists the best ones.",
    parameters: { type: "object", properties: { query: { type: "string", maxLength: 80 } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "evidence.get",
    description: "Get the evidence behind one number of a scored node: value, tool, version if recorded, event seq, reproduce command.",
    parameters: {
      type: "object",
      properties: { run_id: { type: "string" }, node_id: { type: "string" }, metric: { type: "string", enum: METRICS } },
      required: ["run_id", "node_id", "metric"],
      additionalProperties: false,
    },
  },
  {
    name: "run.explain_failure",
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
    if (typeof v !== "string") return { ok: false, error: `${k} must be a string` };
    if (spec.maxLength && v.length > spec.maxLength) return { ok: false, error: `${k} is too long` };
    if (spec.enum && !spec.enum.includes(v)) return { ok: false, error: `${k} must be one of ${spec.enum.join(", ")}` };
    if (k === "run_id" && !RUN_ID.test(v)) return { ok: false, error: "run_id is not valid" };
    if (k === "node_id" && !NODE_ID.test(v)) return { ok: false, error: "node_id is not valid" };
  }
  return { ok: true, args: a };
}

const clip = (s: string | undefined, n: number) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function runTool(name: string, raw: unknown, loader: ReplayLoader): Promise<ToolResult> {
  const v = validateArgs(name, raw);
  if (!v.ok) return { ok: false, error: v.error };
  const a = v.args;
  switch (name) {
    case "library.search": {
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
    case "evidence.get": {
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
    case "run.explain_failure": {
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
