"use client";

import { useId, useState } from "react";

type IconProps = { size?: number; className?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }) as const;

export const IconMatter = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 18h16" />
    <path d="M7 18V9M10.5 18V6M14 18V9M17.5 18V6" />
    <path d="M9 3.5c.8 1 .8 1.6 0 2.5M13 2.5c.8 1 .8 1.6 0 2.5" />
  </svg>
);
export const IconSilicon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" />
    <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
  </svg>
);
export const IconBoard = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="8" cy="9" r="1.2" />
    <circle cx="16" cy="15" r="1.2" />
    <path d="M9.2 9H13l2 2v2.8M8 10.2V15h6.8" />
  </svg>
);
export const IconRuns = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const IconSettings = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5 7h9M18 7h1M5 17h1M10 17h9" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </svg>
);
export const IconTour = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.6v.1" />
  </svg>
);
export const IconChevron = ({ size = 16, className, dir = "right" }: IconProps & { dir?: "left" | "right" | "up" | "down" }) => (
  <svg {...base(size)} className={className} style={{ transform: `rotate(${{ right: 0, down: 90, left: 180, up: 270 }[dir]}deg)` }}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const IconShare = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </svg>
);
export const IconCheck = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={2.2}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const IconClose = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconCoin = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8M12 16v1.5" />
  </svg>
);
export const WB_ICON = { matter: IconMatter, silicon: IconSilicon, board: IconBoard } as const;

/** A collapsible "Scope and limits" row: one line when closed, the honest notes when open. */
export function ScopeRow({ title = "Scope and limits", summary, children }: { title?: string; summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="rounded-lg border border-line bg-panel">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex min-h-9 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left">
        <IconChevron size={14} dir={open ? "down" : "right"} className="shrink-0 text-ink-3" />
        <span className="hw-label shrink-0 !text-[10.5px]">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{summary}</span>
      </button>
      {open && (
        <div id={id} className="border-t border-line px-3 py-2 text-[12.5px] leading-snug text-ink-2">
          {children}
        </div>
      )}
    </div>
  );
}

/** A titled block in a pane. */
export function Block({ title, aside, children, className = "", ...rest }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} aria-label={title} className={`min-w-0 rounded-lg border border-line bg-panel ${className}`}>
      <div className="flex min-h-9 items-center justify-between gap-2 border-b border-line px-3">
        <h3 className="hw-label !text-[10.5px]">{title}</h3>
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function StatusPill({ tone, children }: { tone: "ok" | "warn" | "bad" | "idle" | "info"; children: React.ReactNode }) {
  const c = { ok: "var(--hw-ok)", warn: "var(--hw-warn)", bad: "var(--hw-bad)", idle: "var(--hw-ink-3)", info: "var(--wb)" }[tone];
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 text-[12px] text-ink-2">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  );
}

export const btnPrimary = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-signal px-3.5 text-[13px] font-medium text-on-signal transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
export const btnGhost = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-2 px-3 text-[13px] text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
