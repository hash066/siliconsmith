// The live Silicon run as an agent action. It runs only after the user clicks Run on a proposal (the route requires `confirm`). The route's
// hosted caller POSTs `/api/silicon/run` ({workload}) and the endpoint answers with NDJSON of contract events (docs/contracts/events.md).
// This module turns those events into conversation chips (one per stage, with a plain-language label), `cost` events from the real
// `llm.call` figures it streams, and a verdict written ONLY from what `node.scored` and the stage results say. Nothing here asks a model.

import type { AgentEvent, AgentModel } from "./agent";
import type { HostedCaller } from "./agent-tools";
import { SILICON_RUN_CAP_USD, SILICON_WORKLOADS } from "./agent-tools";

export const SILICON_RUN_MAX_SECONDS = 270;

/** The stage names a maker sees. */
export const STAGE_PLAIN: Record<string, string> = {
  implement: "Writing the hardware",
  lint: "Checking the hardware code for mistakes",
  unit: "Trying a million random inputs",
  prove: "Proving it for every possible input",
  e2e: "Checking the whole program still gives the same output",
  bench: "Counting cycles",
  synth: "Measuring chip area",
};
const stagePlain = (s: string) => STAGE_PLAIN[s] ?? s;
const DONE_WORD: Record<string, string> = { pass: "passed", fail: "failed", skipped: "was skipped" };

const MODEL: Record<string, AgentModel> = { "nemotron-nano": "nano", "nemotron-super": "super", "nemotron-ultra": "ultra" };

type Ev = Record<string, unknown> & { type?: string };

/** Incremental NDJSON reader: a line that is not JSON is ignored (a stray log line must not end the run). */
async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<Ev> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const parse = (line: string): Ev | null => {
    if (!line.trim()) return null;
    try {
      const v = JSON.parse(line) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Ev) : null;
    } catch {
      return null;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const e = parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (e) yield e;
    }
  }
  const last = parse(buf);
  if (last) yield last;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface SiliconRunInput {
  turnId: string;
  workload: "w1" | "w2";
  hosted: HostedCaller;
  signal?: AbortSignal;
  /** Hard stops: dollars (the endpoint enforces its own cap too) and seconds. */
  caps?: { usd: number; seconds: number };
  now?: () => number;
}

/** One live run. Streams chips while it works and ends with the measured result in plain words. */
export async function* runSiliconRun(input: SiliconRunInput): AsyncGenerator<AgentEvent> {
  const { turnId, workload, hosted } = input;
  const caps = input.caps ?? { usd: SILICON_RUN_CAP_USD, seconds: SILICON_RUN_MAX_SECONDS };
  const now = input.now ?? (() => Date.now());
  const t0 = now();
  const title = SILICON_WORKLOADS[workload].title;
  yield { type: "turn.started", id: turnId, model: "ultra" };
  yield { type: "ui.action", id: turnId, action: { name: "workbench.open", args: { workbench: "silicon" } } };
  yield { type: "ui.action", id: turnId, action: { name: "silicon.run_live", args: { workload } } };

  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  input.signal?.addEventListener("abort", onAbort);
  let spent = 0;
  let stoppedBy: string | null = null;
  const open = new Map<string, string>(); // chip id -> label
  let baselineCycles: number | null = null;
  let proposal: { mnemonic: string; title: string } | null = null;
  let scored: { node: string; cycles: number | null; speedup: number | null; area: number | null; feasible: boolean | null } | null = null;
  const stageEnd = new Map<string, string>(); // stage -> last terminal status on the scored/last node
  let failed: string | null = null;
  let completed = false;
  let chip = 0;

  try {
    const res = await hosted("/api/silicon/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workload }), signal: ctl.signal });
    if (!res.ok || !res.body) {
      let why = `The live Silicon service answered ${res.status}.`;
      try {
        const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
        const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
        if (m) why = m;
      } catch {
        // keep the status-only message
      }
      const notThere = res.status === 404 || res.status === 501 || res.status === 503;
      yield { type: "turn.error", id: turnId, message: notThere ? `The live Silicon run is not available on this deployment right now. ${why}` : why };
      return;
    }
    for await (const e of ndjson(res.body)) {
      if (now() - t0 > caps.seconds * 1000) {
        stoppedBy = `the ${Math.round(caps.seconds / 60)} minute time limit was reached`;
        ctl.abort();
        break;
      }
      switch (e.type) {
        case "run.started":
          break;
        case "run.baseline":
          baselineCycles = num(e.cycles);
          break;
        case "node.created": {
          const p = e.proposal as { mnemonic?: unknown; title?: unknown } | null | undefined;
          if (p && str(p.mnemonic)) {
            proposal = { mnemonic: str(p.mnemonic), title: str(p.title) };
            const id = `sp${chip++}`;
            yield { type: "tool.call", id: turnId, call: { id, name: "silicon_propose", args: { instruction: proposal.mnemonic } } };
            yield { type: "tool.result", id: turnId, callId: id, ok: true, summary: `The agent proposes the instruction ${proposal.mnemonic}${proposal.title ? `: ${proposal.title}` : ""}` };
          }
          break;
        }
        case "node.stage": {
          const stage = str(e.stage);
          const status = str(e.status);
          const attempt = num(e.attempt) ?? 1;
          const key = `${str(e.node_id)}/${stage}/${attempt}`;
          if (status === "running") {
            if (!open.has(key)) {
              open.set(key, stagePlain(stage));
              yield { type: "tool.call", id: turnId, call: { id: key, name: "silicon_stage", args: { stage, attempt } } };
            }
          } else if (status === "pass" || status === "fail" || status === "skipped") {
            if (!open.has(key)) {
              open.set(key, stagePlain(stage));
              yield { type: "tool.call", id: turnId, call: { id: key, name: "silicon_stage", args: { stage, attempt } } };
            }
            const detail = str(e.detail);
            yield { type: "tool.result", id: turnId, callId: key, ok: status !== "fail", summary: `${stagePlain(stage)} ${DONE_WORD[status]}${status === "fail" && detail ? `: ${detail.slice(0, 160)}` : ""}` };
            open.delete(key);
            stageEnd.set(stage, status);
          }
          break;
        }
        case "llm.call": {
          const usd = num(e.cost_usd) ?? 0;
          spent += usd;
          yield { type: "cost", id: turnId, usd, tokens_in: num(e.tokens_in) ?? 0, tokens_out: num(e.tokens_out) ?? 0, model: MODEL[str(e.model)] ?? "super" };
          if (spent > caps.usd * 1.25) {
            stoppedBy = `the $${caps.usd.toFixed(2)} spending cap was reached`;
            ctl.abort();
          }
          break;
        }
        case "node.scored":
          scored = { node: str(e.node_id), cycles: num(e.cycles), speedup: num(e.speedup), area: num(e.area_delta_pct), feasible: typeof e.feasible === "boolean" ? e.feasible : null };
          break;
        case "run.completed":
          completed = true;
          break;
        case "run.failed":
          failed = str(e.error) || "the run failed";
          break;
        default:
          break;
      }
      if (stoppedBy) break;
    }
  } catch (err) {
    if (input.signal?.aborted) {
      yield { type: "turn.error", id: turnId, message: "Stopped." };
      return;
    }
    if (!stoppedBy && (err as { name?: string }).name !== "AbortError") failed = err instanceof Error ? err.message : "the connection failed";
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }

  // Any chip still open: the stream ended before the stage did. Say so rather than leaving it spinning.
  for (const [id, label] of open) yield { type: "tool.result", id: turnId, callId: id, ok: false, summary: `${label}: no result before the run ended` };

  const lines: string[] = [];
  if (scored && scored.feasible && scored.speedup !== null) {
    const x = scored.speedup;
    lines.push(
      `${proposal ? `The new instruction ${proposal.mnemonic} ` : "The new instruction "}makes ${title} ${x.toFixed(2)}× faster in processor cycles${baselineCycles !== null && scored.cycles !== null ? ` (${baselineCycles.toLocaleString("en-US")} cycles down to ${scored.cycles.toLocaleString("en-US")})` : ""}${scored.area !== null ? `, for ${scored.area >= 0 ? "" : "about "}${Math.abs(scored.area).toFixed(1)}% ${scored.area >= 0 ? "more" : "less"} chip area` : ""}.`,
    );
    const passed = [...stageEnd].filter(([, s]) => s === "pass").map(([s]) => stagePlain(s).toLowerCase());
    const skipped = [...stageEnd].filter(([, s]) => s === "skipped").map(([s]) => stagePlain(s).toLowerCase());
    if (passed.length) lines.push(`It passed these checks: ${passed.join("; ")}.${skipped.length ? ` Not run: ${skipped.join("; ")}.` : ""}`);
    lines.push("This is a cycle count in simulation. The clock speed on a real chip was not measured in this run, so it does not say how much faster the finished chip would be.");
  } else if (!failed && !stoppedBy && completed) {
    const bad = [...stageEnd].filter(([, s]) => s === "fail").map(([s]) => stagePlain(s).toLowerCase());
    lines.push(`No instruction passed every check${bad.length ? ` (it failed: ${bad.join("; ")})` : ""}, so nothing is claimed as faster.`);
  } else {
    lines.push("The run did not finish with a result, so nothing is claimed as faster.");
  }
  if (stoppedBy) lines.push(`I stopped it early because ${stoppedBy}.`);
  if (failed) lines.push(`The run reported a problem: ${failed.slice(0, 200)}.`);
  lines.push(`Spent about $${spent.toFixed(4)} in ${Math.round((now() - t0) / 1000)} s.`);
  yield { type: "text.delta", id: turnId, text: lines.join("\n\n") };
  yield { type: "ui.action", id: turnId, action: { name: "preview.tab", args: { tab: "proof" } } };
  yield { type: "suggest", id: turnId, chips: scored?.feasible ? ["Explain the proof checks", "Run the other kernel"] : ["Try the run again", "Show me a recorded full search"] };
  yield { type: "turn.done", id: turnId };
}
