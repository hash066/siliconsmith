import type { NextRequest } from "next/server";
import { getCredits, identify } from "@/lib/credits-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The visitor's demo credits and the shared pool. `scope` says whether the numbers are durable or per server instance. */
export async function GET(req: NextRequest) {
  const who = identify(req.headers, req.nextUrl.protocol === "https:");
  const headers = new Headers({ "cache-control": "no-store" });
  if (who.setCookie) headers.append("set-cookie", who.setCookie);
  try {
    return Response.json(await getCredits().snapshot(who.id, who.ip), { headers });
  } catch {
    return Response.json({ error: "store_unavailable", message: "The credit store is unavailable. Free tools and replays still work." }, { status: 503, headers });
  }
}
