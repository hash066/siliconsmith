import { join } from "node:path";
import type { NextRequest } from "next/server";
import { configFromEnv, DailyLimiter, publicStatus, runAgentTurn, type AgentConfig } from "@/lib/agent-server";
import { fsReplayLoader } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loader = fsReplayLoader(join(process.cwd(), "public", "replays"));
let limiter: { key: string; l: DailyLimiter } | null = null;
const limiterFor = (cfg: AgentConfig) => {
  const key = `${cfg.visitorTurnsPerDay}/${cfg.globalTurnsPerDay}`;
  if (!limiter || limiter.key !== key) limiter = { key, l: new DailyLimiter(cfg.visitorTurnsPerDay, cfg.globalTurnsPerDay) };
  return limiter.l;
};

/** Whether the endpoint is connected, and its limits. Never includes the key. */
export async function GET() {
  return Response.json(publicStatus(configFromEnv()), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const cfg = configFromEnv();
  if (!cfg) return Response.json({ error: "not_connected", message: "The agent endpoint is not connected." }, { status: 503 });
  if (Number(req.headers.get("content-length") ?? 0) > 4000) return Response.json({ error: "too_large", message: "Request too large." }, { status: 413 });

  let body: { text?: unknown; model?: unknown; run_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request", message: "Body must be JSON." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "bad_request", message: "Write a question first." }, { status: 400 });
  if (text.length > cfg.maxInputChars) return Response.json({ error: "too_long", message: `Keep it under ${cfg.maxInputChars} characters.` }, { status: 400 });

  const visitor = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "anon").trim();
  const taken = limiterFor(cfg).take(visitor);
  if (!taken.ok) {
    return Response.json(
      {
        error: "limit",
        message:
          taken.reason === "visitor"
            ? `Daily limit of ${cfg.visitorTurnsPerDay} agent turns reached. Replays, the library and the evidence drawer still work.`
            : "The shared daily agent budget is used up. Replays, the library and the evidence drawer still work.",
      },
      { status: 429 },
    );
  }

  const turnId = `a${Date.now().toString(36)}`;
  const events = runAgentTurn({ text, model: typeof body.model === "string" ? body.model : undefined, runId: typeof body.run_id === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(body.run_id) ? body.run_id : undefined, cfg, loader, signal: req.signal, turnId });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const { value, done } = await events.next();
      if (done) ctl.close();
      else ctl.enqueue(enc.encode(`${JSON.stringify(value)}\n`));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
