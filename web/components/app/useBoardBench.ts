"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UiActionResult } from "@/lib/agent-actions";
import { boardApi, type ApiFailure, type BoardCheck, type BoardExplain, type BoardTemplateSummary } from "@/lib/hosted";

export type Load<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; failure: ApiFailure };
export const pretty = (d: unknown) => JSON.stringify(d, null, 2);

export function summarizeCheck(c: BoardCheck): string {
  const pass = c.rungs.filter((r) => r.status === "pass").length;
  const bad = c.rungs.filter((r) => r.status !== "pass");
  if (!bad.length) return `All ${c.rungs.length} rungs pass (author-curated facts).`;
  return `${pass} of ${c.rungs.length} rungs pass. ${bad.map((r) => `${r.rung} ${r.status}${r.detail ? `: ${r.detail.slice(0, 140)}` : ""}`).join(" | ")}`;
}

export function useBoardBench() {
  const [templates, setTemplates] = useState<Load<BoardTemplateSummary[]>>({ state: "loading" });
  const [templateId, setTemplateIdState] = useState<string | null>(null);
  const chosen = useRef<string | null>(null);
  const [designText, setDesignTextState] = useState("");
  const designRef = useRef("");
  const [headerText, setHeaderText] = useState("");
  const [loadedHeader, setLoadedHeader] = useState("");
  const headerRef = useRef({ text: "", loaded: "" });
  const [busy, setBusy] = useState<"idle" | "checking" | "explaining">("idle");
  const [result, setResult] = useState<{ check: BoardCheck; design: string; header: string } | null>(null);
  const [explain, setExplain] = useState<BoardExplain | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [templateFailure, setTemplateFailure] = useState<ApiFailure | null>(null);
  const [tplLoading, setTplLoading] = useState(false);
  const inflight = useRef<Promise<unknown> | null>(null);

  const setDesignText = useCallback((t: string) => {
    designRef.current = t;
    setDesignTextState(t);
  }, []);
  const setHeader = useCallback((t: string, loaded?: string) => {
    headerRef.current = { text: t, loaded: loaded ?? headerRef.current.loaded };
    setHeaderText(t);
    if (loaded !== undefined) setLoadedHeader(loaded);
  }, []);

  const loadTemplate = useCallback(
    async (id: string): Promise<UiActionResult> => {
      chosen.current = id;
      setTemplateIdState(id);
      setTemplateFailure(null);
      setTplLoading(true);
      const req = boardApi.template(id);
      inflight.current = req;
      const r = await req;
      if (inflight.current === req) setTplLoading(false);
      if (!r.ok) {
        setTemplateFailure(r);
        return { ok: false, summary: `Could not load template ${id}: ${r.message}` };
      }
      setDesignText(pretty(r.data.design));
      setHeader(r.data.header, r.data.header);
      setResult(null);
      setExplain(null);
      setFailure(null);
      return { ok: true, summary: `Loaded template ${id}: ${r.data.title}. Not checked yet.` };
    },
    [setDesignText, setHeader],
  );

  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await boardApi.templates();
      if (dead) return;
      if (!r.ok) return setTemplates({ state: "failed", failure: r });
      setTemplates({ state: "ready", value: r.data.templates });
      if (r.data.templates[0] && chosen.current === null) void loadTemplate(r.data.templates[0].id);
    })();
    return () => {
      dead = true;
    };
  }, [loadTemplate]);

  const setDesign = useCallback(
    (design: unknown): UiActionResult => {
      if (design === null || typeof design !== "object" || Array.isArray(design)) return { ok: false, summary: "Not applied: a design must be a JSON object with instances and nets." };
      setDesignText(pretty(design));
      // The firmware pin header is regenerated from the design on the next check unless the visitor edits it.
      setHeader("", "");
      setTemplateIdState(null);
      chosen.current = chosen.current ?? "custom";
      setResult(null);
      setExplain(null);
      setFailure(null);
      return { ok: true, summary: "Design replaced. The pin header will be generated from it on the next check." };
    },
    [setDesignText, setHeader],
  );

  const check = useCallback(async (): Promise<UiActionResult> => {
    // A template that is still loading is the design the visitor chose: wait for it instead of checking the previous one.
    if (inflight.current) await inflight.current.catch(() => undefined);
    await Promise.resolve();
    const design = designRef.current;
    if (!design.trim()) return { ok: false, summary: "No design to check. Load a template or set a design first." };
    const { text, loaded } = headerRef.current;
    const edited = text !== loaded && text !== "";
    setBusy("checking");
    setFailure(null);
    setExplain(null);
    const r = await boardApi.check(design, edited ? text : undefined);
    setBusy("idle");
    if (!r.ok) {
      setFailure(r);
      return { ok: false, summary: `Check failed: ${r.message}` };
    }
    setResult({ check: r.data, design, header: text });
    const ids = new Set<string>();
    for (const rg of r.data.rungs) if (rg.status !== "pass") for (const e of [rg.rung, ...rg.evidence]) ids.add(e);
    return { ok: true, summary: summarizeCheck(r.data), evidence_ids: [...ids].slice(0, 24) };
  }, []);

  const doExplain = useCallback(async () => {
    if (!result) return;
    const { text, loaded } = headerRef.current;
    setBusy("explaining");
    const r = await boardApi.explain(result.design, text !== loaded && text !== "" ? text : undefined);
    setBusy("idle");
    if (!r.ok) return setFailure(r);
    setExplain(r.data);
  }, [result]);

  const stale = !!result && (result.design !== designText || result.header !== headerText);
  return {
    templates,
    templateId,
    designText,
    setDesignText,
    headerText,
    loadedHeader,
    setHeaderText: (t: string) => setHeader(t),
    busy,
    tplLoading,
    result,
    explain,
    failure,
    templateFailure,
    stale,
    loadTemplate,
    setDesign,
    check,
    doExplain,
  };
}

export type BoardBench = ReturnType<typeof useBoardBench>;
