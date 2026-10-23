"use client";

import { useMemo, useState } from "react";
import { boardRungEvidence, buildFactEvidence } from "@/lib/evidence";
import { ApiErrorView } from "../domain/ApiErrorView";
import type { DrawerRef } from "../domain/BoardCheckPanel";
import { CellGlyph } from "../domain/RungMatrix";
import { isDesignJson, type DesignJson } from "../domain/SchematicGraph";
import { FunctionGraph } from "./FunctionGraph";
import type { BoardBench } from "./useBoardBench";
import { Block, btnGhost, btnPrimary, ScopeRow } from "./ui";

export function BoardScope() {
  return (
    <ScopeRow summary="Netlist-level check only: no layout, routing or EMC">
      <ul className="list-disc space-y-1 pl-4">
        <li>Netlist-level check only: no PCB layout, routing, EMC or fabrication, and no claim that a design will work on a real board.</li>
        <li>The rules are deterministic code (no model, no key). Part facts are author-curated from public documents, not independently verified.</li>
        <li>Battery life is a model, not a measurement. Unknown rungs are never counted as passing.</li>
      </ul>
    </ScopeRow>
  );
}

export function BoardInputs({ b }: { b: BoardBench }) {
  const [headerOpen, setHeaderOpen] = useState(false);
  const headerEdited = b.headerText !== b.loadedHeader && b.headerText !== "";
  return (
    <div className="flex min-h-full flex-col gap-3 p-3">
      <Block title="Brief: start from a template" data-step="brief" tabIndex={-1}>
        <div className="p-2">
          {b.templates.state === "loading" && (
            <div className="flex flex-col gap-1.5 p-1" role="status" aria-label="Loading templates">
              {[0, 1, 2].map((k) => (
                <div key={k} className="h-12 animate-pulse rounded-md bg-raised" />
              ))}
            </div>
          )}
          {b.templates.state === "failed" && <ApiErrorView failure={b.templates.failure} onRetry={() => location.reload()} />}
          {b.templates.state === "ready" && b.templates.value.length === 0 && <p className="p-2 text-[13px] text-ink-3">The service has no templates.</p>}
          {b.templates.state === "ready" && (
            <div className="flex flex-col gap-1" role="radiogroup" aria-label="Templates">
              {b.templates.value.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={b.templateId === t.id}
                  data-testid={`tpl-${t.id}`}
                  onClick={() => void b.loadTemplate(t.id)}
                  className={`min-w-0 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 ${b.templateId === t.id ? "border-signal-line bg-raised" : "border-transparent hover:bg-raised/60"}`}
                >
                  <span className="block truncate text-[13px] text-ink">{t.title}</span>
                  <span className="num block truncate text-[11px] text-ink-3" title={t.description}>
                    {t.id}
                  </span>
                </button>
              ))}
            </div>
          )}
          {b.templateFailure && (
            <div className="mt-2">
              <ApiErrorView failure={b.templateFailure} />
            </div>
          )}
        </div>
      </Block>

      <Block title="Propose: the design" data-step="propose" tabIndex={-1} aside={<span className="num text-[11px] text-ink-3">{b.designText ? `${b.designText.length.toLocaleString("en-US")} chars` : ""}</span>}>
        <div className="flex flex-col gap-2 p-3">
          <label htmlFor="board-design" className="text-[12px] text-ink-3">
            Design JSON. The checker reads exactly this text.
          </label>
          <textarea
            id="board-design"
            value={b.designText}
            onChange={(e) => b.setDesignText(e.target.value)}
            spellCheck={false}
            rows={12}
            className="num scroll-quiet w-full min-w-0 resize-y rounded-md border border-line-2 bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink"
            placeholder={b.templates.state === "loading" ? "Loading a template…" : "Paste a design JSON, or pick a template above"}
          />
          <button type="button" onClick={() => setHeaderOpen((o) => !o)} aria-expanded={headerOpen} className="w-fit text-[12.5px] text-ink-2 hover:text-ink">
            {headerOpen ? "Hide" : "Show"} firmware pin header{headerEdited ? " (edited)" : ""}
          </button>
          {headerOpen && (
            <>
              <textarea aria-label="Firmware pin header" value={b.headerText} onChange={(e) => b.setHeaderText(e.target.value)} spellCheck={false} rows={7} placeholder="Generated from the design on the next check unless you write one here." className="num scroll-quiet w-full min-w-0 resize-y rounded-md border border-line-2 bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink" />
              <p className="text-[11.5px] leading-snug text-ink-3">Rung B4 compares this pin table with the netlist.</p>
            </>
          )}
        </div>
      </Block>

      <div className="sticky bottom-0 -mx-3 mt-auto flex items-center gap-3 border-t border-line bg-panel px-3 py-2.5">
        <button type="button" onClick={() => void b.check()} disabled={b.busy !== "idle" || b.tplLoading || !b.designText.trim()} className={btnPrimary} data-testid="board-check">
          {b.busy === "checking" ? "Checking…" : "Check design"}
        </button>
        <span className="text-[12px] text-ink-3">Free · deterministic</span>
      </div>
      <BoardScope />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
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
      className={`${btnGhost} !h-7 !px-2 !text-[12px]`}
    >
      {done === "ok" ? "Copied" : done === "fail" ? "Copy failed" : "Copy"}
    </button>
  );
}

export function BoardCanvasView({ b, onEvidence }: { b: BoardBench; onEvidence: (r: DrawerRef) => void }) {
  const check = b.result?.check;
  const passN = check ? check.rungs.filter((r) => r.status === "pass").length : 0;
  const parsed = useMemo<{ design: (DesignJson & { mcu_ref?: string }) | null; error: string | null }>(() => {
    if (!b.designText.trim()) return { design: null, error: null };
    try {
      const j: unknown = JSON.parse(b.designText);
      return isDesignJson(j) ? { design: { ...j, mcu_ref: ((m) => (typeof m === "string" ? m : undefined))(Reflect.get(j, "mcu_ref")) }, error: null } : { design: null, error: "The JSON parses but has no instances and nets, so there is no graph to draw." };
    } catch (e) {
      return { design: null, error: `The design is not valid JSON yet: ${e instanceof Error ? e.message : "parse error"}` };
    }
  }, [b.designText]);
  const cited = useMemo(() => {
    const s = new Set<string>();
    if (!check) return s;
    for (const r of check.rungs) {
      if (r.status === "pass") continue;
      for (const id of r.evidence) {
        const f = check.evidence[id];
        s.add(f?.part ?? id.replace(/^part:/, "").split(".")[0]);
      }
    }
    return s;
  }, [check]);

  return (
    <div className="@container flex min-w-0 flex-col gap-3 p-3" aria-live="polite">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Block title="Connection graph" aside={parsed.design ? <span className="num text-[11.5px] text-ink-3">{parsed.design.instances.length} parts · {parsed.design.nets.length} nets</span> : undefined}>
          {parsed.design ? (
            <div className="p-3">
              <FunctionGraph design={parsed.design} highlight={cited} />
              <p className="mt-1 text-[11.5px] leading-snug text-ink-3">Grouped by function. A connection graph, not a laid-out schematic{cited.size ? "; amber parts are cited by a failing rung" : ""}.</p>
            </div>
          ) : (
            <p className="grid place-items-center px-4 text-center text-[13px] leading-snug text-ink-3 [aspect-ratio:480/300]" role="status">
              {parsed.error ?? (b.templates.state === "loading" ? "Loading a template…" : "Pick a template or paste a design to see its connection graph.")}
            </p>
          )}
        </Block>

        <Block title="Check matrix B1–B5" data-step="verify" tabIndex={-1} aside={check && <span className="num text-[11.5px] text-ink-3">{passN} of {check.rungs.length} pass</span>}>
          <div className="flex min-h-[300px] flex-col gap-2 p-3">
            {b.failure && <ApiErrorView failure={b.failure} onRetry={() => void b.check()} />}
            {!check && !b.failure && b.busy === "idle" && (
              <div role="status" className="py-5 text-center">
                <h3 className="text-[14px] font-medium text-ink">No result yet</h3>
                <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-snug text-ink-3">Press Check design. Each rung B1 to B5 reports pass, fail or unknown with the facts it used.</p>
              </div>
            )}
            {b.busy === "checking" && (
              <ul className="flex flex-col gap-1.5" role="status" aria-label="Checking">
                {["B1", "B2", "B3", "B4", "B5"].map((r) => (
                  <li key={r} className="flex h-10 items-center gap-3 rounded-md border border-line px-3">
                    <CellGlyph status="running" />
                    <span className="num text-[12.5px] text-ink-3">{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {check && b.busy !== "checking" && (
              <>
                {b.stale && <p className="rounded-md bg-amber-dim px-3 py-1.5 text-[12.5px] text-ink" role="status">Edited since this check. Press Check design to refresh.</p>}
                <p className={`rounded-md px-3 py-1.5 text-[12.5px] ${check.passed ? "bg-signal-dim text-signal-ink" : "bg-raised text-ink"}`}>
                  {check.passed ? "All five rungs pass, using author-curated facts." : `${passN} of ${check.rungs.length} rungs pass. Unknown is never counted as pass.`}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {check.rungs.map((r) => {
                    const spec = check.ladder.find((l) => l.id === r.rung);
                    return (
                      <li key={r.rung} className="min-w-0 rounded-md border border-line px-2.5 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <CellGlyph status={r.status} />
                          <span className="num text-[12.5px] text-ink">{r.rung}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3" title={spec?.tool}>
                            {r.status === "pass" && r.label ? r.label : r.status === "fail" ? "Did not pass" : "Unknown (not counted as pass)"}
                          </span>
                          <button type="button" onClick={() => { const e = boardRungEvidence(check, r.rung); if (e) onEvidence(e); }} className="shrink-0 rounded-[3px] border border-line-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-signal-ink" aria-label={`Evidence for rung ${r.rung}`}>
                            ev
                          </button>
                        </div>
                        {r.status !== "pass" && r.detail && <p className="mt-1 break-words text-[12px] leading-snug text-ink-2">{r.detail}</p>}
                        {r.evidence.length > 0 && (
                          <details className="mt-1" open={r.status !== "pass"}>
                            <summary className="w-fit cursor-pointer text-[11.5px] text-ink-3 hover:text-ink-2">Facts used ({r.evidence.length})</summary>
                            <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={`Facts used by ${r.rung}`}>
                              {r.evidence.slice(0, 8).map((id) => {
                                const fact = check.evidence[id];
                                return (
                                  <li key={id} className="min-w-0">
                                    <button type="button" disabled={!fact} onClick={() => fact && onEvidence(buildFactEvidence(fact, r.rung))} className="num max-w-full truncate rounded-[3px] border border-line-2 bg-sunken px-1.5 py-0.5 text-left text-[10.5px] text-ink-2 hover:border-signal-line hover:text-signal-ink disabled:opacity-60" title={id}>
                                      {id}
                                    </button>
                                  </li>
                                );
                              })}
                              {r.evidence.length > 8 && <li className="text-[10.5px] text-ink-3">+{r.evidence.length - 8} more</li>}
                            </ul>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {!check.passed && !b.explain && (
                  <button type="button" onClick={() => void b.doExplain()} disabled={b.busy !== "idle"} className={`${btnGhost} w-fit`}>
                    {b.busy === "explaining" ? "Explaining…" : "Explain the failures"}
                  </button>
                )}
                {b.explain && (
                  <section aria-label="Explanation" className="rounded-md border border-line bg-sunken px-3 py-2">
                    <h3 className="text-[12.5px] font-medium text-ink">Why it failed</h3>
                    <ul className="mt-1.5 flex flex-col gap-2">
                      {b.explain.failing.map((f) => (
                        <li key={f.rung} className="text-[12px] leading-snug">
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
        </Block>
      </div>

      <Block title="C header: generated pin map" data-step="export" tabIndex={-1} aside={check ? <CopyButton text={check.header} /> : undefined}>
        {check ? (
          <>
            <pre tabIndex={0} aria-label="Generated C pin header" className="scroll-quiet num max-h-60 overflow-auto p-3 text-[12px] leading-relaxed text-ink">{check.header}</pre>
            <p className="border-t border-line px-3 py-2 text-[11.5px] leading-snug text-ink-3">Written by our own code from the design&apos;s firmware pins. {check.notice}</p>
          </>
        ) : (
          <p className="px-3 py-4 text-[12.5px] text-ink-3" role="status">The header appears after a check. It is the text rung B4 compares with the netlist.</p>
        )}
      </Block>
    </div>
  );
}
