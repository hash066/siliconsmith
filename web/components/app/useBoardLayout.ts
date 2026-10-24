"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canonicalNetlist, findLayout, LAYOUT_BASE, type BoardGeometry, type LayoutIndex, type LayoutSummary } from "@/lib/layout";

export interface GeneratedFile {
  name: string;
  mime: string;
  note: string;
  base64: string;
}

export type LayoutState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "none" }
  | { status: "failed"; message: string }
  | { status: "ready"; dir: string; summary: LayoutSummary; geom: BoardGeometry; /** present when the board was made on request (its files travel in the response, not on disk) */ downloads?: GeneratedFile[] };

export interface Generation {
  status: "idle" | "running" | "failed";
  /** What the server last said it was doing. */
  step: string;
  seconds: number;
  message?: string;
}

// one fetch per file for the whole visit
let indexPromise: Promise<LayoutIndex | null> | null = null;
const loaded = new Map<string, Promise<{ summary: LayoutSummary; geom: BoardGeometry }>>();
// boards made on request, by netlist (kept for the visit so going back to a design does not repeat two minutes of work)
const generated = new Map<string, { summary: LayoutSummary; geom: BoardGeometry; downloads: GeneratedFile[] }>();

const getJson = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return (await r.json()) as T;
};
const loadIndex = () => (indexPromise ??= getJson<LayoutIndex>(`${LAYOUT_BASE}/index.json`).catch(() => null));
const loadLayout = (dir: string) => {
  let p = loaded.get(dir);
  if (!p) {
    p = Promise.all([getJson<LayoutSummary>(`${LAYOUT_BASE}/${dir}/summary.json`), getJson<BoardGeometry>(`${LAYOUT_BASE}/${dir}/board.json`)]).then(([summary, geom]) => ({ summary, geom }));
    loaded.set(dir, p);
    p.catch(() => loaded.delete(dir));
  }
  return p;
};

/** Reads a layout stream (NDJSON): progress and heartbeat lines, then one result or error. */
export async function readLayoutStream(
  body: ReadableStream<Uint8Array>,
  on: { progress: (message: string) => void; heartbeat: (seconds: number) => void },
): Promise<{ summary: LayoutSummary; board: BoardGeometry; downloads: GeneratedFile[] }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const take = (line: string) => {
    if (!line.trim()) return null;
    const e = JSON.parse(line) as Record<string, unknown>;
    if (e.type === "progress") on.progress(String(e.message ?? ""));
    else if (e.type === "heartbeat") on.heartbeat(Number(e.seconds ?? 0));
    else if (e.type === "error") throw new Error(String(e.message ?? "the board could not be made"));
    else if (e.type === "result") return e as unknown as { summary: LayoutSummary; board: BoardGeometry; downloads: GeneratedFile[] };
    return null;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const r = take(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (r) return r;
    }
  }
  const last = take(buf);
  if (last) return last;
  throw new Error("The connection ended before the board was finished.");
}

/** The routed board for the design in the editor: a stored one if the engine made one for its netlist, or one made on request in a Sandbox. */
export interface LayoutOptions {
  style?: "default" | "smallest" | "emi";
  /** free text, at most 300 characters; the server reports which parts it understood */
  constraints?: string;
}

export function useBoardLayout(designText: string): LayoutState & { design: Parameters<typeof canonicalNetlist>[0] | null; generation: Generation; generate: (opts?: LayoutOptions) => void; cancel: () => void } {
  const design = useMemo(() => {
    try {
      const j: unknown = JSON.parse(designText);
      const d = j as Parameters<typeof canonicalNetlist>[0];
      return j && Array.isArray(d.instances) && Array.isArray(d.nets) ? d : null;
    } catch {
      return null;
    }
  }, [designText]);
  const key = useMemo(() => (design ? canonicalNetlist(design) : null), [design]);
  const designRef = useRef(design);
  designRef.current = design;
  const [state, setState] = useState<LayoutState>({ status: "idle" });
  const [gen, setGen] = useState<Generation>({ status: "idle", step: "", seconds: 0 });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const d = designRef.current;
    if (!d || !key) {
      setState({ status: "idle" });
      return;
    }
    let dead = false;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    void (async () => {
      try {
        const idx = await loadIndex();
        const hit = findLayout(idx, d);
        if (!hit) {
          const made = generated.get(key);
          if (dead) return;
          setState(made ? { status: "ready", dir: "", summary: made.summary, geom: made.geom, downloads: made.downloads } : { status: "none" });
          return;
        }
        const { summary, geom } = await loadLayout(hit.dir);
        if (!dead) setState({ status: "ready", dir: hit.dir, summary, geom });
      } catch (e) {
        if (!dead) setState({ status: "failed", message: e instanceof Error ? e.message : "could not load the board" });
      }
    })();
    return () => {
      dead = true;
    };
  }, [key]);

  // a design that changes while a board is being made no longer wants that board
  useEffect(() => () => abort.current?.abort(), [key]);

  const generate = useCallback((opts?: LayoutOptions) => {
    const d = designRef.current;
    const style = opts?.style ?? "default";
    const constraints = (opts?.constraints ?? "").trim().slice(0, 300);
    if (!d || !key || abort.current) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const t0 = Date.now();
    setGen({ status: "running", step: "Starting", seconds: 0 });
    const tick = setInterval(() => setGen((g) => (g.status === "running" ? { ...g, seconds: Math.round((Date.now() - t0) / 1000) } : g)), 1000);
    void (async () => {
      try {
        const r = await fetch("/api/board/layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ design: d, style, ...(constraints ? { constraints } : {}) }), signal: ctl.signal });
        if (!r.ok || !r.body) {
          const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(j?.error?.message ?? `The board service answered ${r.status}.`);
        }
        const res = await readLayoutStream(r.body, { progress: (m) => setGen((g) => ({ ...g, step: m })), heartbeat: () => undefined });
        generated.set(key, { summary: res.summary, geom: res.board, downloads: res.downloads });
        setState({ status: "ready", dir: "", summary: res.summary, geom: res.board, downloads: res.downloads });
        setGen({ status: "idle", step: "", seconds: 0 });
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") setGen({ status: "idle", step: "", seconds: 0 });
        else setGen({ status: "failed", step: "", seconds: 0, message: e instanceof Error ? e.message : "The board could not be made." });
      } finally {
        clearInterval(tick);
        abort.current = null;
      }
    })();
  }, [key]);
  const cancel = useCallback(() => abort.current?.abort(), []);
  return { ...state, design, generation: gen, generate, cancel };
}
