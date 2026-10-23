// Request plumbing shared by /api/agent and /api/credits: the signed credits cookie, the client IP, and the one Credits instance (pool and
// IP ledger) per server process. The visitor's own spend is read from the verified cookie on every request: see credits-cookie.ts.

import { Credits, creditsConfigFromEnv, creditStoreFromEnv } from "./credits";
import { CREDITS_COOKIE, cookieAttrs, deriveKey, signState, stateOrFresh, type CreditState } from "./credits-cookie";

let instance: Credits | null = null;
/** One pool/IP ledger per process; its store is durable only when the Upstash / Vercel KV REST env vars are set. */
export function getCredits(): Credits {
  return (instance ??= new Credits(creditStoreFromEnv(), creditsConfigFromEnv()));
}
/** For tests. */
export function setCreditsForTest(c: Credits | null) {
  instance = c;
}

let keyCache: { secret: string; key: CryptoKey } | null = null;
/** The cookie signing key: SHA-256('hw-credits:' + NEBIUS_API_KEY). Without a model key nothing can be spent, so a fixed label is fine. */
export async function signingKey(): Promise<CryptoKey> {
  const secret = process.env.NEBIUS_API_KEY?.trim() ?? "";
  if (!keyCache || keyCache.secret !== secret) keyCache = { secret, key: await deriveKey(secret) };
  return keyCache.key;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export interface Visitor {
  state: CreditState;
  /** No valid cookie came with the request (missing, tampered, malformed or from an earlier day): the allowance starts fresh. */
  fresh: boolean;
  ip: string;
  key: CryptoKey;
  secure: boolean;
}

export async function identify(headers: { get(name: string): string | null }, secure: boolean, now: Date = new Date()): Promise<Visitor> {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (fwd || headers.get("x-real-ip") || "anon").slice(0, 64);
  const key = await signingKey();
  const { state, fresh } = await stateOrFresh(key, readCookie(headers.get("cookie"), CREDITS_COOKIE), now);
  return { state, fresh, ip, key, secure };
}

/** A Set-Cookie value carrying `state`, signed. */
export async function setCookieFor(v: Visitor, state: CreditState): Promise<string> {
  return cookieAttrs(await signState(v.key, state), v.secure);
}
