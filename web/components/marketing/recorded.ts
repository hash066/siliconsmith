// Turns a recorded agent event stream into display segments. Pure: the same events always give the same segments.
export type Ev = { type: string; id?: string; [k: string]: unknown };

export type Seg =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; args: Record<string, unknown>; status: "running" | "ok" | "error"; summary?: string }
  | { kind: "evidence"; ids: string[] };

export function applyEvent(segs: Seg[], e: Ev): Seg[] {
  switch (e.type) {
    case "text.delta": {
      const last = segs[segs.length - 1];
      const t = String(e.text ?? "");
      if (last?.kind === "text") return [...segs.slice(0, -1), { kind: "text", text: last.text + t }];
      return [...segs, { kind: "text", text: t }];
    }
    case "tool.call": {
      const c = e.call as { id: string; name: string; args: Record<string, unknown> };
      return [...segs, { kind: "tool", id: c.id, name: c.name, args: c.args, status: "running" }];
    }
    case "tool.result":
      return segs.map((s) => (s.kind === "tool" && s.id === e.callId ? { ...s, status: e.ok ? "ok" : "error", summary: String(e.summary ?? "") } : s));
    case "evidence":
      return [...segs, { kind: "evidence", ids: (e.ids as string[]) ?? [] }];
    default:
      return segs;
  }
}

export const allSegments = (events: Ev[]): Seg[] => events.reduce(applyEvent, [] as Seg[]).map((s) => (s.kind === "text" ? { ...s, text: s.text.replace(/\n{3,}/g, "\n\n").trim() } : s)).filter((s) => s.kind !== "text" || s.text);

/** The text after the last tool call: what the agent concluded. */
export const finalText = (segs: Seg[]): string => {
  const i = segs.map((s) => s.kind).lastIndexOf("tool");
  return segs
    .slice(i + 1)
    .filter((s): s is Extract<Seg, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("\n\n");
};
