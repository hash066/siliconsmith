// Same-origin calls to the hosted engine (rewritten to the Python project in next.config.ts) and to the recorded replays.
// Every failure becomes a BenchApiError with a kind the games turn into a plain message; none of them throws past a game.

export type ApiErrorKind = "network" | "timeout" | "rate-limit" | "invalid" | "server" | "parse";

export class BenchApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status?: number,
    public field?: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "BenchApiError";
  }
}

/** The message shown to the player. */
export function describeError(e: unknown): string {
  if (!(e instanceof BenchApiError)) return "Something went wrong. Try again.";
  switch (e.kind) {
    case "rate-limit":
      return e.retryAfter ? `The hosted engine is rate limiting requests. Try again in ${e.retryAfter} s.` : "The hosted engine is rate limiting requests. Wait a moment and try again.";
    case "invalid":
      return e.field ? `The engine rejected ${e.field}: ${e.message}` : `The engine rejected the request: ${e.message}`;
    case "timeout":
      return "The hosted engine did not answer in time. Try again.";
    case "network":
      return "Could not reach the hosted engine. Check your connection and try again.";
    case "parse":
      return "The engine's answer was not readable. Try again.";
    default:
      return `The hosted engine returned an error${e.status ? ` (${e.status})` : ""}. Try again.`;
  }
}

async function request<T>(url: string, init: RequestInit, signal?: AbortSignal, timeoutMs = 45000): Promise<T> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: ctl.signal });
    } catch (e) {
      if (timedOut) throw new BenchApiError("timeout", "timeout");
      if (signal?.aborted) throw e; // the game left or reset: not an error to show
      throw new BenchApiError("network", e instanceof Error ? e.message : "network");
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok || (body && typeof body === "object" && (body as { ok?: boolean }).ok === false)) {
      const err = (body as { error?: { message?: string; field?: string } } | null)?.error;
      const ra = Number(res.headers.get("retry-after"));
      if (res.status === 429) throw new BenchApiError("rate-limit", "rate limited", 429, undefined, Number.isFinite(ra) && ra > 0 ? ra : undefined);
      if (res.status === 422 || res.status === 400 || res.status === 413) throw new BenchApiError("invalid", err?.message ?? "invalid request", res.status, err?.field);
      throw new BenchApiError("server", err?.message ?? "server error", res.status);
    }
    if (body === null) throw new BenchApiError("parse", "unreadable response", res.status);
    return body as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export const getJson = <T,>(url: string, signal?: AbortSignal) => request<T>(url, { headers: { accept: "application/json" } }, signal);
export const postJson = <T,>(url: string, body: unknown, signal?: AbortSignal) =>
  request<T>(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }, signal);

export async function getText(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new BenchApiError("server", "not found", res.status);
    return await res.text();
  } catch (e) {
    if (e instanceof BenchApiError || signal?.aborted) throw e;
    throw new BenchApiError("network", "network");
  }
}

export const isAbort = (e: unknown, signal?: AbortSignal) => !!signal?.aborted || (e instanceof DOMException && e.name === "AbortError");
