"use client";

import { useState } from "react";
import type { EvidenceRef, FactEvidenceRef, RungEvidenceRef } from "@/lib/evidence";
import type { ArtifactRecord } from "@/lib/run-state";
import { EvidencePanel } from "../evidence/EvidencePanel";
import { CostPanel } from "../run/CostPanel";
import { EventTicker } from "../run/EventTicker";
import type { SiliconBench } from "./SiliconBench";
import { IconChevron } from "./ui";

export type AnyEvidence = EvidenceRef | RungEvidenceRef | FactEvidenceRef;
type Tab = "evidence" | "events" | "cost";

/** Evidence drawer at the bottom of the canvas: the facts behind a number, plus events and cost for a Silicon run. */
export function EvidenceDock({ evidence, onClear, open, onToggle, silicon, wide }: { evidence: AnyEvidence | null; onClear: () => void; open: boolean; onToggle: () => void; silicon: SiliconBench | null; wide: boolean }) {
  const [tab, setTab] = useState<Tab>("evidence");
  const artifacts: ArtifactRecord[] = silicon?.s.artifacts ?? [];
  const tabs: Array<[Tab, string]> = silicon ? [["evidence", "Evidence"], ["events", "Events"], ["cost", "Cost"]] : [["evidence", "Evidence"]];
  const active = silicon ? tab : "evidence";
  return (
    <section aria-label="Evidence" data-step="evidence" tabIndex={-1} className="shrink-0 border-t border-line bg-panel">
      <div className="flex h-10 items-center gap-1 px-2">
        <div role="tablist" aria-label="Evidence views" className="flex gap-1">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={active === k}
              onClick={() => {
                setTab(k);
                if (!open) onToggle();
              }}
              className={`h-8 rounded-md px-3 text-[12.5px] transition-colors duration-150 ${active === k ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
            >
              {label}
              {k === "evidence" && evidence && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle" aria-label="a number is selected" />}
            </button>
          ))}
        </div>
        <span className="ml-2 hidden min-w-0 flex-1 truncate text-[12px] text-ink-3 sm:block">{evidence ? "Facts behind the selected number" : "Select an ev chip on any number to see the facts behind it"}</span>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? "Collapse the evidence drawer" : "Expand the evidence drawer"} className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink">
          <IconChevron dir={open ? "down" : "up"} size={15} />
        </button>
      </div>
      {open && (
        <div className="scroll-quiet max-h-[34vh] overflow-y-auto border-t border-line">
          {active === "evidence" &&
            (evidence ? (
              <EvidencePanel evidence={evidence} artifacts={artifacts} onClear={onClear} compact={!wide} />
            ) : (
              <p className="px-4 py-4 text-[13px] leading-snug text-ink-3" role="status">
                Nothing selected. Numbers that carry a claim have an <span className="num rounded-[3px] border border-line-2 px-1 text-[10px] uppercase">ev</span> chip; it opens the tool, the facts and the command that reproduce it.
              </p>
            ))}
          {active === "events" && silicon && <EventTicker state={silicon.s} onSelect={silicon.focus.select} rows={7} />}
          {active === "cost" && silicon && (silicon.snap ? <CostPanel state={silicon.s} t={silicon.snap.t} duration={silicon.snap.duration} /> : <p className="px-4 py-3 text-[13px] text-ink-3">Cost appears when a run is loaded.</p>)}
        </div>
      )}
    </section>
  );
}
