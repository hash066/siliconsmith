// Request plumbing shared by /api/agent and /api/credits: the visitor cookie, the client IP, and the one Credits instance per server process.

import { Credits, creditsConfigFromEnv, creditStoreFromEnv } from "./credits";

export const VISITOR_COOKIE = "hw_vid";
const ID_RE = /^[A-Za-z0-9-]{16,64}$/;

let instance: Credits | null = null;
/** One ledger per process; its store is durable only when the Upstash / Vercel KV REST env vars are set. */
export function getCredits(): Credits {
  return (instance ??= new Credits(creditStoreFromEnv(), creditsConfigFromEnv()));
}
/** For tests. */
export function setCreditsForTest(c: Credits | null) {
  instance = c;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export interface VisitorIdentity {
  id: string;
  ip: string;
  /** A Set-Cookie value when this request had no valid id, otherwise null. */
  setCookie: string | null;
}

/** The visitor is the httpOnly cookie id; the IP is only a backstop. A missing or malformed cookie gets a fresh id. */
export function identify(headers: { get(name: string): string | null }, secure: boolean): VisitorIdentity {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (fwd || headers.get("x-real-ip") || "anon").slice(0, 64);
  const existing = readCookie(headers.get("cookie"), VISITOR_COOKIE);
  if (existing && ID_RE.test(existing)) return { id: existing, ip, setCookie: null };
  const id = crypto.randomUUID();
  const attrs = [`${VISITOR_COOKIE}=${id}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${60 * 60 * 24 * 365}`];
  if (secure) attrs.push("Secure");
  return { id, ip, setCookie: attrs.join("; ") };
}
