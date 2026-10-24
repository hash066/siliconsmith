"use client";

import type { EvidenceMetric } from "@/lib/evidence";

/** The workstation's signature: a calibration-sticker tag on a number. It opens the evidence drawer for that number. */
export function EvidenceTag({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Evidence for ${label}`}
      title={`Evidence for ${label}: tool, source, detail`}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[3px] border border-line-2 bg-sunken px-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.08em] text-ink-3 transition-colors duration-150 hover:border-signal-line hover:text-signal-ink"
    >
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <path d="M1 7V1M4 7V3M7 7V5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      ev
    </button>
  );
}

/** A tag for a silicon metric of a scored node. */
export function EvidenceChip({ metric, label, onOpen }: { metric: EvidenceMetric; label: string; onOpen: (metric: EvidenceMetric) => void }) {
  return <EvidenceTag label={label} onClick={() => onOpen(metric)} />;
}
