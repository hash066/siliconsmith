"use client";

import { useState } from "react";
import { ApiErrorView } from "../domain/ApiErrorView";
import type { BoardBench } from "./useBoardBench";
import { Block, btnPrimary, ScopeRow } from "./ui";

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

