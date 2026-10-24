"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canonicalNetlist, findLayout, LAYOUT_BASE, type BoardGeometry, type LayoutIndex, type LayoutSummary } from "@/lib/layout";

export type LayoutState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "none" }
  | { status: "failed"; message: string }
  | { status: "ready"; dir: string; summary: LayoutSummary; geom: BoardGeometry };

// one fetch per file for the whole visit
let indexPromise: Promise<LayoutIndex | null> | null = null;
const loaded = new Map<string, Promise<{ summary: LayoutSummary; geom: BoardGeometry }>>();

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

/** The routed board for the design in the editor, if the engine has made one for its netlist. Looks the design up by its parts and connections. */
export function useBoardLayout(designText: string): LayoutState & { design: Parameters<typeof canonicalNetlist>[0] | null } {
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
        if (!hit) return !dead && setState({ status: "none" });
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
  return { ...state, design };
}
