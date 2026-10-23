"use client";

import { useEffect, useRef } from "react";
import { ThemeToggle } from "../site/Brand";
import type { RunIndexEntry } from "./SiliconBench";
import type { Overlay } from "./Sidebar";
import { btnGhost, IconClose } from "./ui";

export interface HistoryItem {
  at: number;
  text: string;
  ok: boolean;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside role="dialog" aria-label={title} className="hw-pop absolute inset-y-0 left-0 z-40 flex w-[min(340px,100%)] flex-col border-r border-line bg-panel shadow-[var(--hw-shadow)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        <button ref={close} type="button" onClick={onClose} aria-label={`Close ${title}`} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink">
          <IconClose />
        </button>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  );
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function RunsOverlay({ runs, runId, history, onPick, onClose }: { runs: RunIndexEntry[]; runId: string; history: HistoryItem[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Sheet title="Runs and history" onClose={onClose}>
      <h3 className="hw-label !text-[10.5px]">Recorded Silicon runs</h3>
      {runs.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">No recorded runs are installed in this deployment.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-0.5">
          {runs.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)} aria-current={r.id === runId ? "true" : undefined} className={`block w-full min-w-0 rounded-md px-2.5 py-1.5 text-left ${r.id === runId ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised/60"}`}>
                <span className="num block truncate text-[12.5px]">{r.id}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{r.title} · {r.backend}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="hw-label mt-5 !text-[10.5px]">This session</h3>
      {history.length === 0 ? (
        <p className="mt-2 text-[13px] leading-snug text-ink-3" role="status">Nothing yet. Checks, simulations and agent actions you run appear here, with their real outcome. It is kept in memory for this tab only.</p>
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
    </Sheet>
  );
}

export function SettingsOverlay({ onClose, onResetLayout, onReplayTour, onShare, shareNote }: { onClose: () => void; onResetLayout: () => void; onReplayTour: () => void; onShare: () => void; shareNote: string | null }) {
  return (
    <Sheet title="Settings" onClose={onClose}>
      <dl className="flex flex-col gap-4 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-2">Theme</dt>
          <dd>
            <ThemeToggle />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-2">Pane sizes</dt>
          <dd>
            <button type="button" onClick={onResetLayout} className={btnGhost}>
              Reset layout
            </button>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-2">Welcome tour</dt>
          <dd>
            <button type="button" onClick={onReplayTour} className={btnGhost}>
              Replay
            </button>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-2">Link to this view</dt>
          <dd>
            <button type="button" onClick={onShare} className={btnGhost}>
              {shareNote ?? "Copy link"}
            </button>
          </dd>
        </div>
      </dl>
      <p className="mt-5 border-t border-line pt-3 text-[12px] leading-snug text-ink-3">Theme, pane sizes and the tour flag are stored in this browser only. Credits are counted on the server per instance and are demo credits, not money.</p>
    </Sheet>
  );
}

export type { Overlay };
