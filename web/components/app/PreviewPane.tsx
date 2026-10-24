"use client";

import { useEffect, useRef, useState } from "react";
import { WORKBENCHES, type WorkbenchId } from "@/lib/brand";
import { bytesOf, downloadFile, sizeLabel, type ProductFile } from "./files";
import type { Verdict } from "./verdict";
import { btnGhost, IconDownload, IconReset, IconShare, IconSliders, WB_ICON } from "./ui";

export type PreviewTab = "preview" | "files" | "proof";
const TABS: Array<[PreviewTab, string]> = [["preview", "Preview"], ["files", "Files"], ["proof", "Proof"]];

const TONE: Record<Verdict["tone"], { color: string; word: string }> = {
  idle: { color: "var(--hw-ink-3)", word: "Waiting" },
  working: { color: "var(--wb)", word: "Working" },
  green: { color: "var(--hw-ok)", word: "Passed" },
  amber: { color: "var(--hw-warn)", word: "Check this" },
  red: { color: "var(--hw-bad)", word: "Problem" },
};

export function VerdictBar({ v }: { v: Verdict }) {
  const t = TONE[v.tone];
  return (
    <div role="status" aria-live="polite" data-tone={v.tone} data-testid="verdict" className="flex min-h-[66px] min-w-0 items-start gap-3 rounded-xl border px-3.5 py-2.5" style={{ borderColor: `color-mix(in srgb, ${t.color} 55%, transparent)`, background: `color-mix(in srgb, ${t.color} 10%, transparent)` }}>
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${v.tone === "working" ? "anim-breathe" : ""}`} style={{ background: t.color }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-snug text-ink">
          <span className="sr-only">{t.word}: </span>
          {v.title}
        </p>
        {v.detail && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{v.detail}</p>}
      </div>
    </div>
  );
}

function DownloadMenu({ files }: { files: ProductFile[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={files.length === 0} aria-expanded={open} aria-haspopup="menu" title={files.length ? "Download" : "Nothing to download yet"} data-testid="download" className={`${btnGhost} !h-9`}>
        <IconDownload />
        <span className="max-sm:sr-only">Download</span>
      </button>
      {open && (
        <ul role="menu" aria-label="Downloads" className="hw-pop absolute right-0 top-11 z-40 w-[min(280px,calc(100vw-24px))] rounded-xl border border-line bg-panel p-1.5 shadow-[var(--hw-shadow)]">
          {files.map((f) => (
            <li key={f.name} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  downloadFile(f);
                  setOpen(false);
                }}
                data-testid={`dl-${f.name}`}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-raised"
              >
                <span className="min-w-0 flex-1">
                  <span className="num block truncate text-[12.5px] text-ink">{f.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">{f.note}</span>
                </span>
                <span className="num shrink-0 text-[11px] text-ink-3">{sizeLabel(bytesOf(f))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FilesTab({ files, empty }: { files: ProductFile[]; empty: string }) {
  const [view, setView] = useState<string | null>(null);
  if (!files.length)
    return (
      <p className="m-4 rounded-xl border border-line bg-panel px-4 py-6 text-center text-[13px] leading-snug text-ink-3" role="status">
        {empty}
      </p>
    );
  return (
    <ul className="flex flex-col gap-2 p-4" aria-label="Files">
      {files.map((f) => (
        <li key={f.name} className="min-w-0 rounded-xl border border-line bg-panel p-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="num truncate text-[13px] text-ink">{f.name}</p>
              <p className="truncate text-[12px] text-ink-3">
                {f.note} · {sizeLabel(bytesOf(f))}
              </p>
            </div>
            {f.text !== undefined && (
              <button type="button" onClick={() => setView(view === f.name ? null : f.name)} aria-expanded={view === f.name} className="text-[12px] text-ink-3 hover:text-ink">
                {view === f.name ? "Hide" : "View"}
              </button>
            )}
            <button type="button" onClick={() => downloadFile(f)} className={`${btnGhost} !h-8`} data-testid={`file-${f.name}`}>
              <IconDownload size={14} />
              Download
            </button>
          </div>
          {view === f.name && f.text !== undefined && (
            <pre tabIndex={0} aria-label={`Contents of ${f.name}`} className="scroll-quiet num mt-2 max-h-64 overflow-auto rounded-lg bg-sunken p-3 text-[11.5px] leading-relaxed text-ink">
              {f.text.length > 20000 ? `${f.text.slice(0, 20000)}\n… (${f.text.length.toLocaleString("en-US")} characters in the file)` : f.text}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Header (workbench, verdict, actions), the three tabs and the tab body. */
export function PreviewPane({ wb, title, verdict, tab, onTab, files, onShare, shareNote, onStartOver, onAdvanced, children }: { wb: WorkbenchId; title: string; verdict: Verdict; tab: PreviewTab; onTab: (t: PreviewTab) => void; files: ProductFile[]; onShare: () => void; shareNote: string | null; onStartOver: () => void; onAdvanced: () => void; children: React.ReactNode }) {
  return (
    <section aria-label="Preview" data-coach="preview" className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line bg-panel px-3 pb-0 pt-3 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-2" data-testid="project-badge">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-bg" style={{ color: WORKBENCHES[wb].accent }} title={WORKBENCHES[wb].name}>
              {(() => {
                const Icon = WB_ICON[wb];
                return <Icon size={17} />;
              })()}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="hw-label !text-[10.5px]">{WORKBENCHES[wb].name} project</p>
              <p className="max-w-[34vw] truncate text-[13.5px] text-ink sm:max-w-[28ch]" title={title}>{title}</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <DownloadMenu files={files} />
            <button type="button" onClick={onShare} className={`${btnGhost} !h-9 !px-2.5`} aria-label="Copy a link to this view" title={shareNote ?? "Copy a link to this view"} data-testid="share">
              <IconShare size={16} />
              <span className="sr-only" role="status">{shareNote}</span>
            </button>
            <button type="button" onClick={onAdvanced} className={`${btnGhost} !h-9`} data-testid="advanced-open" data-coach="advanced">
              <IconSliders />
              <span className="max-sm:sr-only">Advanced</span>
            </button>
            <button type="button" onClick={onStartOver} className={`${btnGhost} !h-9 !px-2.5`} aria-label="New project" title="New project" data-testid="start-over">
              <IconReset />
            </button>
          </div>
        </div>
        <VerdictBar v={verdict} />
        <div role="tablist" aria-label="Preview views" data-coach="tabs" className="flex gap-1">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} id={`tab-${k}`} aria-controls="preview-body" onClick={() => onTab(k)} data-testid={`ptab-${k}`} className={`h-10 border-b-2 px-3.5 text-[13px] transition-colors ${tab === k ? "border-[var(--wb)] text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div id="preview-body" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </section>
  );
}
