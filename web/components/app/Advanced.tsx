"use client";

import { useEffect, useRef } from "react";
import type { WorkbenchId } from "@/lib/brand";
import { BoardInputs, BoardScope } from "./BoardBench";
import { MODEL_CHOICES, type ModelChoice } from "./CreditsPill";
import { MatterInputs, MatterScope } from "./MatterBench";
import type { BoardBench } from "./useBoardBench";
import type { MatterBench } from "./useMatterBench";
import { IconClose, ScopeRow } from "./ui";

export interface HistoryItem {
  at: number;
  text: string;
  ok: boolean;
}
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function SiliconScope() {
  return (
    <ScopeRow summary="One candidate, live; cycles and area, not clock speed">
      <ul className="list-disc space-y-1 pl-4">
        <li>A live run proposes ONE instruction for a chosen kernel and verifies it in a sandbox: lint, a million test inputs, a formal proof, the whole program, a cycle count and chip area.</li>
        <li>Clock speed (Fmax) is not measured in a live run, so the result is a cycle speedup, not a wall-clock claim.</li>
        <li>Costs are capped at about $0.15 and 4 minutes. The long recorded search is a separate real recording, not a live run.</li>
      </ul>
    </ScopeRow>
  );
}

/** Everything technical lives here: model choice, exact parameters, the JSON design, scope and limits, and what the app did this session. */
export function AdvancedDrawer({ wb, model, onModel, matter, board, history, onClose }: { wb: WorkbenchId; model: ModelChoice; onModel: (m: ModelChoice) => void; matter: MatterBench; board: BoardBench; history: HistoryItem[]; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const root = document.getElementById("advanced-drawer");
        const f = root?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex='-1'])");
        if (!f?.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50" data-testid="advanced">
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 cursor-default bg-black/45" />
      <aside id="advanced-drawer" role="dialog" aria-modal="true" aria-label="Advanced" className="hw-pop absolute inset-y-0 right-0 flex w-[min(460px,100vw)] flex-col border-l border-line bg-panel shadow-[var(--hw-shadow)]">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 className="text-[15px] font-semibold text-ink">Advanced</h2>
          <button ref={close} type="button" onClick={onClose} aria-label="Close Advanced" className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink">
            <IconClose />
          </button>
        </div>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
          <section aria-label="Model" className="border-b border-line p-4">
            <h3 className="hw-label !text-[10.5px]">Agent model</h3>
            <div role="radiogroup" aria-label="Agent model" className="mt-2 grid grid-cols-4 gap-1 rounded-xl border border-line bg-bg p-1">
              {MODEL_CHOICES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={model === m.id} title={m.hint} onClick={() => onModel(m.id)} data-testid={`model-${m.id}`} className={`h-8 rounded-lg text-[12.5px] transition-colors ${model === m.id ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{MODEL_CHOICES.find((m) => m.id === model)?.hint}. Nemotron models only.</p>
          </section>
          <section aria-label="Exact inputs" className="border-b border-line">
            {wb === "matter" && <MatterInputs b={matter} />}
            {wb === "board" && <BoardInputs b={board} />}
            {wb === "silicon" && <p className="p-4 text-[13px] leading-snug text-ink-3">Silicon has no parameters to edit: pick a kernel in the Preview and run it live.</p>}
          </section>
          <section aria-label="Scope and limits" className="border-b border-line p-4">
            {wb === "matter" && <MatterScope />}
            {wb === "board" && <BoardScope />}
            {wb === "silicon" && <SiliconScope />}
          </section>
          <section aria-label="What the app did" className="p-4">
            <h3 className="hw-label !text-[10.5px]">This session</h3>
            {history.length === 0 ? (
              <p className="mt-2 text-[12.5px] leading-snug text-ink-3" role="status">Nothing yet. Checks, simulations and agent actions appear here with their real outcome. Kept in memory for this tab only.</p>
            ) : (
              <ol className="mt-2 flex flex-col gap-1.5">
                {[...history].reverse().map((h, i) => (
                  <li key={`${h.at}-${i}`} className="rounded-md border border-line px-2.5 py-1.5">
                    <div className="flex items-center gap-2 text-[11px] text-ink-3">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.ok ? "var(--hw-ok)" : "var(--hw-bad)" }} aria-hidden="true" />
                      <span className="num">{clock(h.at)}</span>
                      <span className="sr-only">{h.ok ? "succeeded" : "failed"}</span>
                    </div>
                    <p className="mt-0.5 break-words text-[12.5px] leading-snug text-ink-2">{h.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
