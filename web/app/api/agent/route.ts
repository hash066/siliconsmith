import { join } from "node:path";
import type { NextRequest } from "next/server";
import { ACTION_TOOLS, type AgentContext, type AgentEvent, type ModelChoice } from "@/lib/agent";
import { LOOP_CAPS, httpLlm, runBoardDesign, runMatterOptimize } from "@/lib/agent-loops";
import { configFromEnv, publicStatus, routeModel, runAgentTurn, turnEstimateUsd } from "@/lib/agent-server";
import { fsReplayLoader } from "@/lib/agent-tools";
import { WORKBENCHES, type WorkbenchId } from "@/lib/brand";
import { round6, signReceipt } from "@/lib/credits-cookie";
import { getCredits, identify, setCookieFor } from "@/lib/credits-server";
import { MATTER_GENERATORS, type MatterGenerator } from "@/lib/hosted";
import { fsManifestStore } from "@/lib/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A confirmed loop can run up to its 90 s cap.
export const maxDuration = 120;

const loader = fsReplayLoader(join(process.cwd(), "public", "replays"));
const manifests = fsManifestStore(join(process.cwd(), "public", "library"));

/** Whether the endpoint is connected, and its limits. Never includes the key. Credits are at /api/credits. */
export async function GET() {
  return Response.json(publicStatus(configFromEnv()), { headers: { "cache-control": "no-store" } });
}

const json = (status: number, body: unknown, setCookie: string | null) => {
  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("set-cookie", setCookie);
  return Response.json(body, { status, headers });
};

const isWorkbench = (v: unknown): v is WorkbenchId => typeof v === "string" && v in WORKBENCHES;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export async function POST(req: NextRequest) {
  const cfg = configFromEnv();
  const who = await identify(req.headers, req.nextUrl.protocol === "https:");
  const freshCookie = who.fresh ? await setCookieFor(who, who.state) : null;
  if (!cfg) return json(503, { error: "not_connected", message: "The agent endpoint is not connected." }, freshCookie);
  if (Number(req.headers.get("content-length") ?? 0) > 40_000) return json(413, { error: "too_large", message: "Request too large." }, freshCookie);

  let body: Record<string, unknown>;
  try {
    const b: unknown = await req.json();
    if (!isRecord(b)) throw new Error("not an object");
    body = b;
  } catch {
    return json(400, { error: "bad_request", message: "Body must be a JSON object." }, freshCookie);
  }

  const workbench = isWorkbench(body.workbench) ? body.workbench : undefined;
  const confirm = body.confirm === true;
  const action = isRecord(body.action) ? body.action : null;

  // A confirmed loop: validate what the click carried, never trust the model's earlier proposal.
  let loop: { tool: "board_design"; brief: string } | { tool: "matter_optimize"; generator: MatterGenerator } | null = null;
  if (confirm) {
    const tool = action?.tool;
    const args = isRecord(action?.args) ? action.args : {};
    if (!(ACTION_TOOLS as readonly unknown[]).includes(tool)) return json(400, { error: "bad_request", message: "Unknown action." }, freshCookie);
    if (tool === "board_design") {
      const brief = typeof args.brief === "string" ? args.brief.trim() : "";
      if (!brief || brief.length > 500) return json(400, { error: "bad_request", message: "The brief must be 1 to 500 characters." }, freshCookie);
      loop = { tool, brief };
    } else {
      const g = args.generator === undefined ? "rect_fins" : args.generator;
      if (typeof g !== "string" || !(g in MATTER_GENERATORS)) return json(400, { error: "bad_request", message: "Unknown generator." }, freshCookie);
      loop = { tool: "matter_optimize", generator: g as MatterGenerator };
    }
  } else if (action) {
    return json(400, { error: "bad_request", message: "A loop only runs with confirm: true." }, freshCookie);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!loop) {
    if (!text) return json(400, { error: "bad_request", message: "Write a question first." }, freshCookie);
    if (text.length > cfg.maxInputChars) return json(400, { error: "too_long", message: `Keep it under ${cfg.maxInputChars} characters.` }, freshCookie);
  }
  const choice = (typeof body.model === "string" ? body.model : "auto") as ModelChoice;
  const model = routeModel(text, choice);
  const history = Array.isArray(body.history)
    ? body.history.filter((m): m is { role: "user" | "assistant"; text: string } => isRecord(m) && (m.role === "user" || m.role === "assistant") && typeof m.text === "string").slice(-cfg.historyMessages)
    : [];
  const context = isRecord(body.context) ? (body.context as AgentContext) : undefined;

  const credits = getCredits();
  const need = loop ? LOOP_CAPS.usd : turnEstimateUsd(model, cfg);
  const pre = await credits.preflight(who.state.s, who.ip, need);
  if (!pre.ok) return json(402, { error: "credits", reason: pre.reason, message: pre.message, credits: pre.snapshot }, freshCookie);

  // The hosted Board and Matter functions live on this same deployment; the agent calls them like any visitor (they are rate limited too).
  const origin = req.nextUrl.origin;
  const hosted = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "x-forwarded-for": who.ip }, signal: req.signal });
  const turnId = `a${Date.now().toString(36)}`;
  const tools = { manifests, hosted };

  let events: AsyncGenerator<AgentEvent>;
  if (loop?.tool === "board_design") events = runBoardDesign({ turnId, brief: loop.brief, llm: httpLlm(cfg), hosted, signal: req.signal });
  else if (loop?.tool === "matter_optimize") events = runMatterOptimize({ turnId, generator: loop.generator, llm: httpLlm(cfg), hosted, signal: req.signal });
  else events = runAgentTurn({ text, model: choice, workbench, context, history, runId: typeof body.run_id === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(body.run_id) ? body.run_id : undefined, tools, cfg, loader, signal: req.signal, turnId });

  // The cookie goes out with the headers, before the turn's real cost is known, so the turn RESERVES its worst case there. The stream ends
  // with a signed receipt that lowers the cookie to the real cost once the browser posts it to /api/credits. If the client never does,
  // or stops the turn, it only overpays.
  const reserved = round6(who.state.s + need);
  const reservation = await setCookieFor(who, { ...who.state, s: reserved });
  let spent = 0;
  let settled = false;
  const metered = async function* (): AsyncGenerator<AgentEvent> {
    try {
      for await (const e of events) {
        if (e.type === "cost") spent += e.usd;
        yield e;
      }
      settled = true;
    } finally {
      // Charge the pool and the IP the real cost of whatever the turn used, even if the client stops it.
      await credits.charge(who.ip, spent);
    }
    if (settled) {
      const actual = round6(Math.min(spent, need));
      const to = round6(who.state.s + actual);
      const snapshot = await credits.snapshot(to, who.ip).catch(() => null);
      if (snapshot) yield { type: "credits", snapshot, receipt: await signReceipt(who.key, { v: who.state.v, d: who.state.d, from: reserved, to }) };
    }
  };
  const it = metered();
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const { value, done } = await it.next();
      if (done) ctl.close();
      else ctl.enqueue(enc.encode(`${JSON.stringify(value)}\n`));
    },
    async cancel() {
      await it.return(undefined);
    },
  });
  const headers = new Headers({ "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
  headers.append("set-cookie", reservation);
  return new Response(stream, { headers });
}
