"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { boardApi, type ApiFailure, type BoardCheck, type BoardExplain, type BoardTemplateSummary } from "@/lib/hosted";
import { boardRungEvidence, buildFactEvidence, type FactEvidenceRef, type RungEvidenceRef } from "@/lib/evidence";
import { Panel } from "./DomainShell";
import { ApiErrorView } from "./ApiErrorView";
import { CellGlyph } from "./RungMatrix";

export type DrawerRef = RungEvidenceRef | FactEvidenceRef;

type Load<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; failure: ApiFailure };

const pretty = (d: unknown) => JSON.stringify(d, null, 2);

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone("ok");
        } catch {
          setDone("fail");
        }
        setTimeout(() => setDone("idle"), 1600);
      }}
      className="h-7 rounded-md border border-line-2 px-2 text-[12px] text-ink-2 hover:text-ink"
    >
      {done === "ok" ? "Copied" : done === "fail" ? "Copy failed" : label}
    </button>
  );
}

/** "Check your design": pick a real template or paste your own design JSON, run the deterministic B1..B5 ladder on the hosted function. */
export function BoardCheckPanel({ onEvidence }: { onEvidence: (ref: DrawerRef) => void }) {
  const [templates, setTemplates] = useState<Load<BoardTemplateSummary[]>>({ state: "loading" });
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [designText, setDesignText] = useState("");
  const [headerText, setHeaderText] = useState("");
  const [headerOpen, setHeaderOpen] = useState(false);
  const [busy, setBusy] = useState<"idle" | "checking" | "explaining">("idle");
  const [result, setResult] = useState<{ check: BoardCheck; checkedDesign: string; checkedHeader: string } | null>(null);
  const [explain, setExplain] = useState<BoardExplain | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [templateFailure, setTemplateFailure] = useState<ApiFailure | null>(null);
  const loadedHeader = useRef("");

  const loadTemplate = useCallback(async (id: string) => {
    setTemplateId(id);
    setTemplateFailure(null);
    const r = await boardApi.template(id);
    if (!r.ok) return setTemplateFailure(r);
    setDesignText(pretty(r.data.design));
    setHeaderText(r.data.header);
    loadedHeader.current = r.data.header;
    setResult(null);
    setExplain(null);
    setFailure(null);
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await boardApi.templates();
      if (dead) return;
      if (!r.ok) return setTemplates({ state: "failed", failure: r });
      setTemplates({ state: "ready", value: r.data.templates });
      if (r.data.templates[0]) void loadTemplate(r.data.templates[0].id);
    })();
    return () => {
      dead = true;
    };
  }, [loadTemplate]);

  const headerEdited = headerText !== loadedHeader.current;
  const run = async () => {
    setBusy("checking");
    setFailure(null);
    setExplain(null);
    const r = await boardApi.check(designText, headerEdited ? headerText : undefined);
    setBusy("idle");
    if (!r.ok) return setFailure(r);
    setResult({ check: r.data, checkedDesign: designText, checkedHeader: headerText });
  };
  const doExplain = async () => {
    if (!result) return;
    setBusy("explaining");
    const r = await boardApi.explain(result.checkedDesign, result.checkedHeader !== loadedHeader.current ? result.checkedHeader : undefined);
    setBusy("idle");
    if (!r.ok) return setFailure(r);
    setExplain(r.data);
  };

  const stale = !!result && (result.checkedDesign !== designText || result.checkedHeader !== headerText);
  const check = result?.check;
  const passN = check ? check.rungs.filter((r) => r.status === "pass").length : 0;
  const tpl = templates.state === "ready" ? templates.value.find((t) => t.id === templateId) : null;

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[12.5px] leading-snug text-ink-2" role="note">
        Netlist-level check only: no PCB layout, routing, EMC or fabrication, and no claim that a design will work on a real board. The rules are deterministic code (no model, no key). Part facts are author-curated from public documents, not independently verified; battery life is a model, not a measurement.
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Panel title="Design" aside={<span className="num text-[12px] text-ink-3">{designText ? `${designText.length.toLocaleString("en-US")} chars` : ""}</span>}>
          <div className="flex flex-col gap-3 p-3">
            <fieldset>
              <legend className="mb-1.5 text-[12px] text-ink-3">Start from a real template</legend>
              {templates.state === "loading" && (
                <p className="text-[13px] text-ink-3" role="status">
                  Loading templates…
                </p>
              )}
              {templates.state === "failed" && <ApiErrorView failure={templates.failure} onRetry={() => location.reload()} />}
              {templates.state === "ready" && (
                <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Templates">
                  {templates.value.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={templateId === t.id}
                      onClick={() => void loadTemplate(t.id)}
                      className={`min-w-0 rounded-md border px-3 py-2 text-left transition-colors duration-150 ${templateId === t.id ? "border-signal-line bg-raised" : "border-line hover:bg-raised/60"}`}
                    >
                      <span className="block text-[13px] text-ink">{t.title}</span>
                      <span className="block text-[12px] leading-snug text-ink-3">{t.description}</span>
                    </button>
                  ))}
                </div>
              )}
              {templateFailure && <div className="mt-2"><ApiErrorView failure={templateFailure} /></div>}
            </fieldset>

            <div>
              <label htmlFor="board-design" className="mb-1 flex items-center justify-between gap-2 text-[12px] text-ink-3">
                <span>Design JSON (edit it; the checker reads exactly this text)</span>
                {tpl && <span className="num text-[11px]">{tpl.id}</span>}
              </label>
              <textarea
                id="board-design"
                value={designText}
                onChange={(e) => setDesignText(e.target.value)}
                spellCheck={false}
                rows={14}
                className="num scroll-quiet w-full min-w-0 resize-y rounded-md border border-line-2 bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink"
                placeholder={templates.state === "loading" ? "Loading a template…" : "Paste a design JSON"}
              />
            </div>

            <div>
              <button type="button" onClick={() => setHeaderOpen((o) => !o)} aria-expanded={headerOpen} className="text-[12.5px] text-ink-2 hover:text-ink">
                {headerOpen ? "Hide" : "Show"} the firmware pin header (B4 judges this text{headerEdited ? ", edited" : ""})
              </button>
              {headerOpen && (
                <textarea
                  aria-label="Firmware pin header"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  spellCheck={false}
                  rows={8}
                  className="num scroll-quiet mt-1.5 w-full min-w-0 resize-y rounded-md border border-line-2 bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy !== "idle" || !designText.trim()}
                className="h-10 rounded-md bg-signal px-4 text-[14px] font-medium text-on-signal disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "checking" ? "Checking…" : "Check design"}
              </button>
              <span className="text-[12px] text-ink-3">Free and deterministic. About a tenth of a second.</span>
            </div>
          </div>
        </Panel>

        <Panel title="Result" aside={check && <span className="num text-[12px] text-ink-3">{passN} of {check.rungs.length} rungs pass</span>}>
          <div className="flex flex-col gap-3 p-3" aria-live="polite">
            {failure && <ApiErrorView failure={failure} onRetry={() => void run()} />}
            {!check && !failure && busy === "idle" && (
              <div role="status">
                <h3 className="text-[14px] font-medium text-ink">No result yet</h3>
                <p className="mt-1 text-[13px] leading-snug text-ink-3">Pick a template or paste a design, then press Check design. Each rung B1 to B5 reports pass, fail or unknown with the facts it used.</p>
              </div>
            )}
            {busy === "checking" && (
              <ul className="flex flex-col gap-2" role="status" aria-label="Checking">
                {["B1", "B2", "B3", "B4", "B5"].map((r) => (
                  <li key={r} className="flex h-11 items-center gap-3 rounded-md border border-line px-3">
                    <span className="anim-breathe"><CellGlyph status="running" /></span>
                    <span className="num text-[12.5px] text-ink-3">{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {check && busy !== "checking" && (
              <>
                {stale && (
                  <p className="rounded-md bg-amber-dim px-3 py-2 text-[12.5px] text-amber" role="status">
                    The design or header was edited after this check. Press Check design to refresh.
                  </p>
                )}
                <p className={`rounded-md px-3 py-2 text-[13px] ${check.passed ? "bg-signal-dim text-signal-ink" : "bg-raised text-ink"}`}>
                  {check.passed ? "All five rungs pass, using author-curated facts." : `${passN} of ${check.rungs.length} rungs pass. Unknown rungs are not counted as passing.`}
                </p>
                <ul className="flex flex-col gap-2">
                  {check.rungs.map((r) => {
                    const spec = check.ladder.find((l) => l.id === r.rung);
                    return (
                      <li key={r.rung} className="min-w-0 rounded-md border border-line px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <CellGlyph status={r.status === "unknown" ? "unknown" : r.status} />
                          <span className="num text-[13px] text-ink">{r.rung}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3" title={spec?.tool}>
                            {r.status === "pass" && r.label ? r.label : r.status === "fail" ? "Did not pass" : "Unknown (not counted as pass)"}
                          </span>
                          <button type="button" onClick={() => { const e = boardRungEvidence(check, r.rung); if (e) onEvidence(e); }} className="shrink-0 rounded-[3px] border border-line-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-signal-ink" aria-label={`Evidence for rung ${r.rung}`}>
                            ev
                          </button>
                        </div>
                        {r.detail && <p className="mt-1.5 break-words text-[12.5px] leading-snug text-ink-2">{r.detail}</p>}
                        {r.evidence.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Facts used by ${r.rung}`}>
                            {r.evidence.slice(0, 12).map((id) => {
                              const fact = check.evidence[id];
                              return (
                                <li key={id}>
                                  <button
                                    type="button"
                                    disabled={!fact}
                                    onClick={() => fact && onEvidence(buildFactEvidence(fact, r.rung))}
                                    className="num max-w-full break-all rounded-[3px] border border-line-2 bg-sunken px-1.5 py-0.5 text-left text-[11px] text-ink-2 hover:border-signal-line hover:text-signal-ink disabled:opacity-60"
                                  >
                                    {id}
                                  </button>
                                </li>
                              );
                            })}
                            {r.evidence.length > 12 && <li className="text-[11px] text-ink-3">+{r.evidence.length - 12} more in the evidence drawer</li>}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[12px] leading-snug text-ink-3">{check.notice}</p>
                {!check.passed && !explain && (
                  <button type="button" onClick={() => void doExplain()} disabled={busy !== "idle"} className="h-9 w-fit rounded-md border border-line-2 px-3 text-[13px] text-ink hover:bg-raised disabled:opacity-50">
                    {busy === "explaining" ? "Explaining…" : "Explain the failures"}
                  </button>
                )}
                {explain && (
                  <section aria-label="Explanation" className="rounded-md border border-line bg-sunken px-3 py-2">
                    <h3 className="text-[13px] font-medium text-ink">Why it failed</h3>
                    <ul className="mt-1.5 flex flex-col gap-2.5">
                      {explain.failing.map((f) => (
                        <li key={f.rung} className="text-[12.5px] leading-snug">
                          <p className="text-ink">
                            <span className="num">{f.rung}</span> · {f.meaning}
                          </p>
                          <p className="mt-0.5 text-ink-3">Rule: {f.rule}</p>
                          <ul className="mt-1 list-disc pl-4 text-ink-2">
                            {f.problems.map((p, i) => (
                              <li key={i} className="break-words">
                                {p.detail}
                                {p.hint && <span className="text-ink-3"> Hint: {p.hint}</span>}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>

      {check && (
        <Panel title="Generated C pin header" aside={<CopyButton text={check.header} />}>
          <pre className="scroll-quiet num max-h-72 overflow-auto p-3 text-[12px] leading-relaxed text-ink">{check.header}</pre>
          <p className="border-t border-line px-3 py-2 text-[12px] leading-snug text-ink-3">Written by our own code from the design&apos;s firmware pins. Rung B4 compares the pin table in this text with the netlist.</p>
        </Panel>
      )}
    </div>
  );
}
