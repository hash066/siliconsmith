"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UiActionResult } from "@/lib/agent-actions";
import type { RunEvent } from "@/lib/events";
import { initialRunState, reduce, type RunState } from "@/lib/run-state";
import { siliconVerdict } from "./verdict";

export type Phase = "idle" | "running" | "done" | "failed";
export type Workload = "w1" | "w2";
export const WORKLOADS: Record<Workload, { title: string; blurb: string }> = {
  w1: { title: "TinyMaix dot product", blurb: "An int8 fully-connected layer from a small neural-network library." },
  w2: { title: "ChaCha20 cipher", blurb: "The stream cipher from the Monocypher crypto library." },
};

export interface BundleFile {
  path: string;
  /** Text content when the file is text; otherwise base64. */
  text?: string;
  base64?: string;
}

/** The final `bundle` event: files as an array of {path, content|text|base64} or as a {path: text} map. Anything else yields no files. */
export function parseBundle(e: unknown): BundleFile[] {
  const files = (e as { files?: unknown } | null)?.files;
  const out: BundleFile[] = [];
  if (Array.isArray(files)) {
    for (const f of files) {
      if (!f || typeof f !== "object") continue;
      const r = f as Record<string, unknown>;
      if (typeof r.path !== "string") continue;
      const text = typeof r.text === "string" ? r.text : typeof r.content === "string" && r.encoding !== "base64" ? r.content : undefined;
      const base64 = typeof r.base64 === "string" ? r.base64 : typeof r.content === "string" && r.encoding === "base64" ? r.content : undefined;
      if (text !== undefined || base64 !== undefined) out.push({ path: r.path, text, base64 });
    }
  } else if (files && typeof files === "object") {
    for (const [path, v] of Object.entries(files)) if (typeof v === "string") out.push({ path, text: v });
  }
  return out;
}

export const RUN_CAP = { usd: 0.15, minutes: 4 } as const;

async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
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
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

export function failureMessage(status: number, j: { message?: string } | null): string {
  if (status === 402) return j?.message ?? "Your demo credits are used up. The free tools still work.";
  if (status === 429) return j?.message ?? "Too many runs right now. Try again in a little while.";
  if (status === 404 || status === 503) return "Live Silicon runs are not enabled on this deployment yet. Nothing was started and nothing was spent.";
  return j?.message ?? `The run service answered ${status}.`;
}

/** The LIVE single-candidate Silicon run: POST /api/silicon/run streams v2 events, then a final `bundle`. Nothing here replays a recording. */
export function useSiliconLive() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<RunState>(() => initialRunState());
  const [files, setFiles] = useState<BundleFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workload, setWorkload] = useState<Workload>("w1");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const live = useRef({ phase, run, error });
  live.current = { phase, run, error };
  const waiters = useRef<Array<() => void>>([]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (phase === "done" || phase === "failed") {
      for (const w of waiters.current.splice(0)) w();
    }
  }, [phase]);

  const start = useCallback(async (w: Workload): Promise<UiActionResult> => {
    if (live.current.phase === "running") return { ok: false, summary: "A live run is already in progress." };
    const ctl = new AbortController();
    abort.current = ctl;
    setWorkload(w);
    setPhase("running");
    setRun(initialRunState());
    setFiles([]);
    setError(null);
    setStartedAt(Date.now());
    let state = initialRunState();
    let sawEnd = false;
    let pending = 0;
    const flush = () => {
      pending = 0;
      setRun(state);
    };
    try {
      const res = await fetch("/api/silicon/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workload: w }), signal: ctl.signal });
      if (!res.ok || !res.body) {
        let j: { message?: string } | null = null;
        try {
          j = (await res.json()) as { message?: string };
        } catch {
          // keep the status-only message
        }
        const msg = failureMessage(res.status, j);
        setError(msg);
        setPhase("failed");
        return { ok: false, summary: msg };
      }
      for await (const e of ndjson(res.body)) {
        const t = (e as { type?: string } | null)?.type;
        if (t === "bundle") {
          setFiles(parseBundle(e));
          continue;
        }
        state = reduce(state, e as RunEvent);
        if (t === "run.completed" || t === "run.failed") sawEnd = true;
        if (!pending) pending = requestAnimationFrame(flush);
      }
      cancelAnimationFrame(pending);
      flush();
      const failed = state.status === "failed" || !sawEnd;
      if (failed) setError(state.error ?? (sawEnd ? null : "The connection ended before the run finished."));
      setPhase(failed ? "failed" : "done");
      const v = siliconVerdict({ phase: failed ? "failed" : "done", state, error: state.error });
      return { ok: !failed, summary: `${v.title}${v.detail ? `. ${v.detail}` : ""}` };
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        setPhase("failed");
        setError("Stopped. Anything already spent stays spent.");
        return { ok: false, summary: "The run was stopped." };
      }
      const msg = err instanceof Error ? err.message : "The run connection failed.";
      setError(msg);
      setPhase("failed");
      return { ok: false, summary: msg };
    }
  }, []);

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => {
    abort.current?.abort();
    setPhase("idle");
    setRun(initialRunState());
    setFiles([]);
    setError(null);
    setStartedAt(null);
  }, []);

  return { phase, run, files, error, workload, setWorkload, startedAt, start, stop, reset };
}
export type SiliconLive = ReturnType<typeof useSiliconLive>;
