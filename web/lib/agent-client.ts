// Browser side of /api/agent: the status probe and the transport the Agent panel uses.

import type { CreditsSnapshot } from "./credits";
import type { AgentEvent, AgentRequest, AgentTransport } from "./agent";
import { CREDITS_CHANGED, announceCredits } from "./credits-client";

export interface AgentStatus {
  connected: boolean;
  limits?: { turnMaxTokens: number; maxInputChars: number };
}

export async function fetchAgentStatus(signal?: AbortSignal): Promise<AgentStatus> {
  try {
    const res = await fetch("/api/agent", { cache: "no-store", signal });
    if (!res.ok) return { connected: false };
    return (await res.json()) as AgentStatus;
  } catch {
    return { connected: false };
  }
}

/** Parse NDJSON lines of AgentEvents out of a byte stream. A partial last line is held until it completes. */
export async function* parseEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line) as AgentEvent;
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as AgentEvent;
}

/** The credits ran out (or the store is down). The message is the server's plain explanation; free tools and replays still work. */
export class CreditsError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "CreditsError";
  }
}

export const httpAgentTransport = (): AgentTransport => ({
  async *send({ signal, ...req }: AgentRequest & { signal: AbortSignal }) {
    const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal });
    if (!res.ok || !res.body) {
      let message = `The agent endpoint answered ${res.status}.`;
      let reason = "";
      try {
        const j = (await res.json()) as { message?: string; reason?: string };
        if (j.message) message = j.message;
        reason = j.reason ?? "";
      } catch {
        // keep the status-only message
      }
      if (res.status === 402) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event(CREDITS_CHANGED));
        throw new CreditsError(message, reason);
      }
      throw new Error(message);
    }
    let settled = false;
    try {
      for await (const e of parseEventStream(res.body)) {
        if (e.type === "credits") {
          // The balance after this turn: show it now, then settle the cookie with the signed receipt and show what the server confirms.
          announceCredits(e.snapshot);
          const confirmed = await settleReceipt(e.receipt);
          settled = true;
          announceCredits(confirmed ?? e.snapshot);
        }
        yield e;
      }
    } finally {
      // A turn that was stopped has no receipt: its cookie keeps the reserved estimate. Either way every credits pill re-reads the server.
      if (!settled && typeof window !== "undefined") window.dispatchEvent(new Event(CREDITS_CHANGED));
    }
  },
});

/** Posts the turn's signed receipt so the credits cookie drops from the reserved estimate to the real cost. Null if refused. */
async function settleReceipt(receipt: string): Promise<CreditsSnapshot | null> {
  try {
    const res = await fetch("/api/credits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt }), cache: "no-store" });
    return res.ok ? ((await res.json()) as CreditsSnapshot) : null;
  } catch {
    return null;
  }
}
