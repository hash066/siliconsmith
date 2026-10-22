// Checks an event stream against docs/contracts/events.md (v1.1 rules, v1.2 polish, v1.3 timing).
// Used by the tests on every replay in public/replays, and handy for the engine:
//   npx vitest run lib/contract.test.ts

import { MODELS, ROLES, STAGES, type RunEvent, type Stage } from "./events";

export interface Issue {
  level: "error" | "warn";
  seq: number;
  rule: string;
  message: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const STATUSES = ["queued", "running", "pass", "fail", "skipped"];
const REQUIRED: Record<string, string[]> = {
  "run.started": ["workload", "config", "backend"],
  "run.baseline": ["cycles", "luts", "ffs", "cells", "fmax_mhz", "output_hash", "hotspots"],
  "run.completed": ["best_node_id", "pareto", "totals", "report"],
  "run.failed": ["error"],
  "node.created": ["node_id", "parent_id", "depth", "proposal", "instruction_set"],
  "node.stage": ["node_id", "stage", "status", "attempt"],
  "node.scored": ["node_id", "cycles", "speedup", "luts", "ffs", "area_delta_pct", "fmax_mhz", "wall_speedup", "feasible", "on_pareto", "ladder"],
  "node.pruned": ["node_id", "reason"],
  "node.expanded": ["node_id", "children"],
  "node.timing": ["node_id", "fmax_mhz", "wall_speedup", "seeds"],
  "artifact.created": ["kind", "path", "sha256"],
  "llm.call": ["node_id", "model", "role", "tokens_in", "tokens_out", "cost_usd", "latency_ms"],
  "sandbox.op": ["node_id", "op_id", "from_image", "status"],
  log: ["level", "msg"],
};

export function validateStream(events: readonly RunEvent[]): Issue[] {
  const issues: Issue[] = [];
  const err = (e: RunEvent, rule: string, message: string) => issues.push({ level: "error", seq: e.seq, rule, message });
  const warn = (e: RunEvent, rule: string, message: string) => issues.push({ level: "warn", seq: e.seq, rule, message });

  const created = new Set<string>();
  const ended = new Set<string>();
  // per node: last stage index within the current attempt, current attempt, pending failure
  const progress = new Map<string, { attempt: number; idx: number; pendingFail: Stage | null; synthPassed: boolean; failedFinal: boolean }>();
  const ops = new Map<string, "open" | "done">();
  let lastT = -Infinity;
  let runId: string | null = null;
  let completed = false;
  // v2: a non-silicon domain uses free-string stage names, so the silicon stage order does not apply to it.
  let silicon = true;

  events.forEach((e, i) => {
    if (e.v !== 1) err(e, "envelope", `v must be 1, got ${String(e.v)}`);
    if (e.seq !== i) err(e, "seq", `seq ${e.seq} at position ${i}: must start at 0 and increase by 1`);
    if (typeof e.t !== "number" || e.t < lastT) err(e, "t", `t ${e.t} goes backwards (previous ${lastT})`);
    lastT = Math.max(lastT, e.t);
    runId ??= e.run_id;
    if (e.run_id !== runId) err(e, "run_id", `run_id ${e.run_id} differs from ${runId}`);
    if (completed) err(e, "order", "event after run.completed");
    const req = REQUIRED[e.type];
    if (!req) {
      err(e, "type", `unknown type ${e.type}`);
      return;
    }
    for (const k of req) if (!(k in e)) err(e, "fields", `${e.type} missing ${k}`);

    const nodeId = (e as { node_id?: string | null }).node_id;
    if (e.type !== "node.created" && nodeId && !created.has(nodeId)) err(e, "node-order", `${e.type} for ${nodeId} before node.created`);

    switch (e.type) {
      case "run.started":
        if (e.domain !== undefined && (typeof e.domain !== "string" || !e.domain)) err(e, "domain", "domain must be a non-empty string");
        silicon = e.domain === undefined || e.domain === "silicon";
        if (e.ladder !== undefined) {
          if (!Array.isArray(e.ladder)) err(e, "ladder", "ladder must be a list of {id, label, tool?}");
          else {
            const ids = new Set<string>();
            for (const r of e.ladder) {
              if (!r || typeof r.id !== "string" || !r.id || typeof r.label !== "string" || !r.label) err(e, "ladder", "each rung needs a string id and label");
              else if (r.tool !== undefined && typeof r.tool !== "string") err(e, "ladder", `rung ${r.id}: tool must be a string`);
              else if (ids.has(r.id)) err(e, "ladder", `rung ${r.id} listed twice`);
              else ids.add(r.id);
            }
          }
        }
        break;
      case "artifact.created":
        if (typeof e.kind !== "string" || !e.kind || typeof e.path !== "string" || !e.path) err(e, "artifact", "kind and path must be non-empty strings");
        if (typeof e.sha256 !== "string" || !SHA256.test(e.sha256)) err(e, "artifact", "sha256 must be 64 lowercase hex characters");
        if (e.node_id && !created.has(e.node_id)) err(e, "node-order", `artifact for ${e.node_id} before node.created`);
        break;
      case "run.baseline":
        for (const h of e.hotspots ?? []) if (!("symbol" in h)) warn(e, "hotspot", `hotspot uses ${"function" in h ? "`function`" : "no name"} instead of \`symbol\``);
        if (e.fmax_mhz !== null && typeof e.fmax_mhz !== "number") err(e, "fmax", "fmax_mhz must be number | null");
        break;
      case "node.created":
        if (created.has(e.node_id)) err(e, "node", `${e.node_id} created twice`);
        if (e.parent_id !== null && !created.has(e.parent_id)) err(e, "node", `${e.node_id} parent ${e.parent_id} unknown`);
        if ((e.parent_id === null) !== (e.proposal === null)) err(e, "node", `${e.node_id}: only the root has proposal null`);
        created.add(e.node_id);
        progress.set(e.node_id, { attempt: 0, idx: -1, pendingFail: null, synthPassed: false, failedFinal: false });
        break;
      case "node.stage": {
        if (typeof e.stage !== "string" || !e.stage) err(e, "stage", "stage must be a non-empty string");
        else if (silicon && !STAGES.includes(e.stage as Stage)) err(e, "stage", `unknown stage ${e.stage}`);
        if (!STATUSES.includes(e.status)) err(e, "stage", `unknown status ${e.status}`);
        const p = progress.get(e.node_id);
        if (!p) break;
        if (ended.has(e.node_id)) err(e, "stage", `${e.node_id} stage after the node ended`);
        const idx = silicon ? STAGES.indexOf(e.stage as Stage) : 0;
        if (p.pendingFail) {
          if (!(e.stage === "implement" && e.attempt === p.attempt + 1)) err(e, "repair", `${e.node_id}: a fail at attempt ${p.attempt} must be followed by implement attempt ${p.attempt + 1}`);
          p.pendingFail = null;
          p.attempt = e.attempt;
          p.idx = idx;
        } else if (silicon && e.attempt !== p.attempt) {
          err(e, "attempt", `${e.node_id}: attempt ${e.attempt} without a failure at attempt ${p.attempt}`);
          p.attempt = e.attempt;
          p.idx = idx;
        } else if (silicon && idx < p.idx) {
          err(e, "stage-order", `${e.node_id}: ${e.stage} after ${STAGES[p.idx]} (v1.1 order is ${STAGES.join(" → ")})`);
        } else {
          p.attempt = Math.max(p.attempt, e.attempt);
          p.idx = idx;
        }
        if (e.status === "fail" && silicon) {
          if (e.stage === "bench" || e.stage === "synth" || e.attempt >= 2) p.failedFinal = true;
          else p.pendingFail = e.stage as Stage;
        }
        if (e.stage === "synth" && e.status === "pass") p.synthPassed = true;
        if (e.attempt < 0 || e.attempt > 2) err(e, "attempt", `attempt ${e.attempt} out of range 0..2`);
        break;
      }
      case "node.scored": {
        const p = progress.get(e.node_id);
        if (silicon && p && !p.synthPassed) err(e, "scored", `${e.node_id} scored before synth passed`);
        if (e.fmax_mhz === null && Math.abs(e.wall_speedup - e.speedup) > 1e-9) err(e, "fmax", `${e.node_id}: fmax null but wall_speedup != speedup`);
        break;
      }
      case "node.pruned": {
        const p = progress.get(e.node_id);
        // The engine may give up after any failure (implementation error, polish attempts used up, run budget).
        ended.add(e.node_id);
        break;
      }
      case "node.expanded":
        for (const c of e.children) if (!created.has(c)) err(e, "expanded", `child ${c} not created yet`);
        break;
      case "llm.call":
        if (!MODELS.includes(e.model)) err(e, "llm", `unknown model ${e.model}`);
        if (!ROLES.includes(e.role)) err(e, "llm", `unknown role ${e.role}`);
        break;
      case "sandbox.op": {
        const st = ops.get(e.op_id);
        if (e.status === "started") {
          if (st) err(e, "sandbox", `op ${e.op_id} started twice`);
          ops.set(e.op_id, "open");
        } else {
          if (st !== "open") err(e, "sandbox", `op ${e.op_id} finished without starting`);
          ops.set(e.op_id, "done");
        }
        break;
      }
      case "run.completed":
        completed = true;
        if (e.best_node_id !== null && !created.has(e.best_node_id)) err(e, "completed", `best ${e.best_node_id} unknown`);
        for (const [id, p] of progress) if (p.failedFinal && !ended.has(id)) err(e, "pruned", `${id} failed but never got node.pruned`);
        for (const [op, st] of ops) if (st === "open") err(e, "sandbox", `op ${op} still open at run.completed`);
        break;
    }
  });
  return issues;
}
