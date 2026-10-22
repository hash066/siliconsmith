// Browser side of /api/agent: the status probe and the transport the Agent panel plugs in.

import type { AgentEvent, AgentTransport } from "./agent";

export interface AgentStatus {
  connected: boolean;
  limits?: { visitorTurnsPerDay: number; globalTurnsPerDay: number; turnMaxTokens: number; maxInputChars: number; scope: string };
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

/** `getRunId` tells the agent which run the user is looking at (the id only; the server reads the recorded replay itself). */
export const httpAgentTransport = (getRunId: () => string | undefined): AgentTransport => ({
  async *send({ text, signal }) {
    const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, run_id: getRunId() }), signal });
    if (!res.ok || !res.body) {
      let message = `The agent endpoint answered ${res.status}.`;
      try {
        const j = (await res.json()) as { message?: string };
        if (j.message) message = j.message;
      } catch {
        // keep the status-only message
      }
      throw new Error(message);
    }
    yield* parseEventStream(res.body);
  },
});
