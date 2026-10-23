// A visitor's credit balance lives in a signed httpOnly cookie, not on the server, so it is exact even when serverless requests land on
// different instances. The cookie carries {visitor id, UTC day, USD spent today} and an HMAC-SHA256 signature. The signing key is
// SHA-256('hw-credits:' + NEBIUS_API_KEY): derived from a secret the server already has, so there is no new secret to manage and
// nothing secret reaches the browser. A tampered or expired cookie is not an error: the visitor simply gets a fresh allowance for
// today. A determined visitor can therefore clear cookies and start again; the per-IP backstop and the shared pool cap exist for that.
//
// A turn's real cost is only known when its stream ends, after the response headers (and so the cookie) have gone out. So a turn
// RESERVES its worst-case estimate in the cookie up front, and the stream ends with a signed receipt that lowers the cookie to the
// real cost when the browser POSTs it back. A client that never claims the receipt only overpays (the safe direction).

const enc = new TextEncoder();

export const CREDITS_COOKIE = "hw_credits";
const COOKIE_MAX_AGE_S = 60 * 60 * 36;

export interface CreditState {
  /** Visitor id (random, not a secret). */
  v: string;
  /** UTC day the spend belongs to, "YYYY-MM-DD". */
  d: string;
  /** USD spent today, rounded to 1e-6. */
  s: number;
}

export interface CreditReceipt {
  v: string;
  d: string;
  /** The spend recorded in the cookie when the turn started (the reservation was already included). */
  from: number;
  /** The spend after the turn: what it really cost. */
  to: number;
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
export const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/** The signing key for this deployment, derived from the model key (or a fixed label when there is none, which signs nothing of value). */
export async function deriveKey(secret: string | undefined): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`hw-credits:${secret ?? ""}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64u = (bytes: ArrayBuffer | Uint8Array) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string): Uint8Array | null => {
  try {
    const t = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

async function seal(key: CryptoKey, kind: "state" | "receipt", payload: object): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${kind}.${body}`));
  return `${body}.${b64u(sig)}`;
}

async function open<T>(key: CryptoKey, kind: "state" | "receipt", token: string | null | undefined): Promise<T | null> {
  if (!token || token.length > 600) return null;
  const dot = token.indexOf(".");
  if (dot < 1 || token.indexOf(".", dot + 1) !== -1) return null;
  const body = token.slice(0, dot);
  const sig = unb64u(token.slice(dot + 1));
  if (!sig) return null;
  // subtle.verify compares in constant time
  const ok = await crypto.subtle.verify("HMAC", key, sig as BufferSource, enc.encode(`${kind}.${body}`)).catch(() => false);
  if (!ok) return null;
  const raw = unb64u(body);
  if (!raw) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch {
    return null;
  }
}

const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v);
const validDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const validSpend = (s: unknown): s is number => typeof s === "number" && Number.isFinite(s) && s >= 0 && s < 1000;

export const signState = (key: CryptoKey, st: CreditState) => seal(key, "state", st);

/** The cookie's state, or null if it is missing, forged, malformed or from another UTC day. */
export async function readState(key: CryptoKey, token: string | null | undefined, now: Date): Promise<CreditState | null> {
  const st = await open<CreditState>(key, "state", token);
  if (!st || !validId(st.v) || !validDay(st.d) || !validSpend(st.s)) return null;
  return st.d === dayOf(now) ? { v: st.v, d: st.d, s: round6(st.s) } : null;
}

/** A visitor's state for this request: the verified cookie, or a fresh one with a new id and nothing spent. */
export async function stateOrFresh(key: CryptoKey, token: string | null | undefined, now: Date): Promise<{ state: CreditState; fresh: boolean }> {
  const st = await readState(key, token, now);
  if (st) return { state: st, fresh: false };
  return { state: { v: crypto.randomUUID(), d: dayOf(now), s: 0 }, fresh: true };
}

export const signReceipt = (key: CryptoKey, r: CreditReceipt) => seal(key, "receipt", r);

/**
 * Applies a receipt to the cookie's state: it must be signed by this deployment, from today, for this visitor, and written against the
 * spend the cookie still holds (so an old receipt cannot be replayed to lower a balance that has moved on), and it may only lower it.
 */
export async function claimReceipt(key: CryptoKey, token: string | null | undefined, current: CreditState, now: Date): Promise<CreditState | null> {
  const r = await open<CreditReceipt>(key, "receipt", token);
  if (!r || r.v !== current.v || r.d !== current.d || r.d !== dayOf(now)) return null;
  if (!validSpend(r.from) || !validSpend(r.to) || r.to > r.from) return null;
  if (Math.abs(round6(r.from) - current.s) > 1e-9) return null;
  return { ...current, s: round6(r.to) };
}

export function cookieAttrs(value: string, secure: boolean): string {
  const attrs = [`${CREDITS_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${COOKIE_MAX_AGE_S}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}
