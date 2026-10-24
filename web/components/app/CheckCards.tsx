"use client";

import { useState } from "react";
import type { BoardFact } from "@/lib/hosted";
import { CellGlyph } from "../domain/RungMatrix";
import type { CheckCard } from "./verdict";
import { btnGhost } from "./ui";

/** One card per check: a tick or a cross, the plain title, one plain sentence. Failing cards can ask the agent to fix it; facts open on demand. */
export function CheckCards({ cards, facts, detail, onFix, busy, onShow, showable }: { cards: CheckCard[]; facts?: Record<string, BoardFact>; detail?: Record<string, string>; onFix?: (c: CheckCard) => void; busy?: boolean; onShow?: (c: CheckCard) => void; showable?: Set<string> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-2" aria-label="Checks">
      {cards.map((c) => {
        const tone = c.state === "pass" ? "var(--hw-ok)" : c.state === "fail" ? "var(--hw-bad)" : "var(--hw-warn)";
        const ids = facts ? c.evidence.filter((id) => facts[id]) : [];
        const showDetail = open === c.id;
        return (
          <li key={c.id} data-check={c.id} data-state={c.state} className="min-w-0 rounded-xl border border-line bg-panel p-3" style={{ borderLeft: `3px solid ${tone}` }}>
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                <CellGlyph status={c.state === "pass" ? "pass" : c.state === "fail" ? "fail" : "unknown"} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[13.5px] font-medium leading-snug text-ink">
                  {c.title} <span className="sr-only">: {c.state === "pass" ? "passed" : c.state === "fail" ? "failed" : "undecided"}</span>
                </h3>
                <p className="mt-0.5 line-clamp-3 break-words text-[12.5px] leading-snug text-ink-2">{c.sentence}</p>
              </div>
              <span className="num shrink-0 text-[10.5px] text-ink-3" title="Check id">
                {c.id}
              </span>
            </div>
            {(ids.length > 0 || detail?.[c.id] || (c.state === "fail" && onFix) || (onShow && showable?.has(c.id))) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-[26px]">
                {onShow && showable?.has(c.id) && (
                  <button type="button" onClick={() => onShow(c)} className={`${btnGhost} !h-8`} data-testid={`show-${c.id}`}>
                    Show on the board
                  </button>
                )}
                {c.state === "fail" && onFix && (
                  <button type="button" onClick={() => onFix(c)} disabled={busy} className={`${btnGhost} !h-8 !border-[var(--hw-bad)] !text-ink`} data-testid={`fix-${c.id}`}>
                    Fix it
                  </button>
                )}
                {(ids.length > 0 || detail?.[c.id]) && (
                  <button type="button" onClick={() => setOpen(showDetail ? null : c.id)} aria-expanded={showDetail} className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
                    {showDetail ? "Hide details" : ids.length ? `Show the facts (${ids.length})` : "Show details"}
                  </button>
                )}
              </div>
            )}
            {showDetail && (
              <div className="mt-2 flex flex-col gap-1.5 pl-[26px]">
                {detail?.[c.id] && <p className="num text-[11.5px] text-ink-3">Checked by {detail[c.id]}</p>}
                {ids.slice(0, 10).map((id) => (
                  <p key={id} className="min-w-0 break-words rounded-md bg-sunken px-2 py-1.5 text-[12px] leading-snug text-ink-2">
                    <span className="num mr-1.5 text-[11px] text-ink-3">{id}</span>
                    {facts?.[id]?.text}
                    {facts?.[id]?.source && <span className="text-ink-3"> · {facts[id].source}</span>}
                  </p>
                ))}
                {ids.length > 10 && <p className="text-[11.5px] text-ink-3">+{ids.length - 10} more facts</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
