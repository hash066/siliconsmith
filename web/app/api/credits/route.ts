import type { NextRequest } from "next/server";
import { claimReceipt, round6 } from "@/lib/credits-cookie";
import { getCredits, identify, setCookieFor } from "@/lib/credits-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = (extra?: string | null) => {
  const h = new Headers({ "cache-control": "no-store" });
  if (extra) h.append("set-cookie", extra);
  return h;
};

/**
 * The visitor's demo credits and the shared pool. The visitor's balance is exact (it is read from a signed cookie); the pool's scope
 * depends on the store, and `scope` says which. A request without a valid cookie gets a fresh allowance for today.
 */
export async function GET(req: NextRequest) {
  const who = await identify(req.headers, req.nextUrl.protocol === "https:");
  const cookie = who.fresh ? await setCookieFor(who, who.state) : null;
  try {
    return Response.json(await getCredits().snapshot(who.state.s, who.ip), { headers: headers(cookie) });
  } catch {
    return Response.json({ error: "store_unavailable", message: "The credit store is unavailable. Free tools and replays still work." }, { status: 503, headers: headers(cookie) });
  }
}

/**
 * Settles a finished turn: the browser posts back the signed receipt that ended the stream, and the cookie drops from the turn's reserved
 * estimate to its real cost. A receipt that is forged, from another visitor or day, or written against an older balance is refused.
 */
export async function POST(req: NextRequest) {
  const who = await identify(req.headers, req.nextUrl.protocol === "https:");
  let receipt: unknown;
  try {
    receipt = ((await req.json()) as { receipt?: unknown }).receipt;
  } catch {
    receipt = null;
  }
  const next = typeof receipt === "string" ? await claimReceipt(who.key, receipt, who.state, new Date()) : null;
  if (!next) return Response.json({ error: "bad_receipt", message: "That receipt does not match your balance." }, { status: 400, headers: headers(who.fresh ? await setCookieFor(who, who.state) : null) });
  const snap = await getCredits().snapshot(round6(next.s), who.ip);
  return Response.json(snap, { headers: headers(await setCookieFor(who, next)) });
}
