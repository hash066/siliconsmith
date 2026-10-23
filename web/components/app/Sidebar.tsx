"use client";

import { WORKBENCHES, WORKBENCH_ORDER, type WorkbenchId } from "@/lib/brand";
import { IconChevron, IconRuns, IconSettings, IconTour, WB_ICON } from "./ui";

export type Overlay = "runs" | "settings" | null;

function RailButton({ label, expanded, active, accent, onClick, children, pressed, testId }: { label: string; expanded: boolean; active?: boolean; accent?: string; onClick: () => void; children: React.ReactNode; pressed?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      aria-pressed={pressed}
      data-testid={testId}
      className={`hw-tip relative flex h-11 shrink-0 items-center gap-3 rounded-xl transition-colors duration-150 max-lg:w-11 max-lg:justify-center ${expanded ? "lg:w-full lg:px-3" : "lg:w-11 lg:justify-center"} ${active ? "bg-raised text-ink" : "text-ink-3 hover:bg-raised/70 hover:text-ink"}`}
      style={active && accent ? ({ color: accent } as React.CSSProperties) : undefined}
    >
      {active && <span className="absolute left-[-6px] top-2.5 h-6 w-[3px] rounded-full max-lg:left-2.5 max-lg:top-auto max-lg:bottom-[-5px] max-lg:h-[3px] max-lg:w-6" style={{ background: accent }} aria-hidden="true" />}
      {children}
      {expanded && <span className="hidden truncate text-[13px] text-ink lg:inline">{label}</span>}
      {!expanded && <span className="hw-tip-text">{label}</span>}
    </button>
  );
}

/** Icon rail with an expanded state (labels). Vertical at >= 1024 px, a horizontal strip below. */
export function Sidebar({ wb, onWorkbench, expanded, onToggleExpanded, overlay, onOverlay, onTour }: { wb: WorkbenchId; onWorkbench: (w: WorkbenchId) => void; expanded: boolean; onToggleExpanded: () => void; overlay: Overlay; onOverlay: (o: Overlay) => void; onTour: () => void }) {
  return (
    <nav aria-label="Workbenches" data-tour="sidebar" className={`z-20 flex shrink-0 items-center gap-1 border-line bg-panel px-2 max-lg:h-[52px] max-lg:justify-between max-lg:overflow-x-auto max-lg:border-b lg:flex-col lg:items-stretch lg:border-r lg:py-2 ${expanded ? "lg:w-[188px]" : "lg:w-[60px]"}`}>
      <div className="flex items-center gap-1 lg:flex-col lg:items-stretch">
        {WORKBENCH_ORDER.map((id) => {
          const Icon = WB_ICON[id];
          return (
            <RailButton key={id} label={WORKBENCHES[id].name} expanded={expanded} active={wb === id} accent={WORKBENCHES[id].accent} onClick={() => onWorkbench(id)} testId={`wb-${id}`}>
              <Icon />
            </RailButton>
          );
        })}
      </div>
      <div className="mx-1 h-6 w-px shrink-0 bg-line lg:mx-2 lg:my-1 lg:h-px lg:w-auto" role="separator" aria-orientation="horizontal" />
      <div className="flex items-center gap-1 lg:flex-col lg:items-stretch">
        <RailButton label="Runs and history" expanded={expanded} pressed={overlay === "runs"} active={overlay === "runs"} accent="var(--hw-ink)" onClick={() => onOverlay(overlay === "runs" ? null : "runs")} testId="nav-runs">
          <IconRuns />
        </RailButton>
        <RailButton label="Settings" expanded={expanded} pressed={overlay === "settings"} active={overlay === "settings"} accent="var(--hw-ink)" onClick={() => onOverlay(overlay === "settings" ? null : "settings")} testId="nav-settings">
          <IconSettings />
        </RailButton>
        <RailButton label="Tour" expanded={expanded} onClick={onTour} testId="nav-tour">
          <IconTour />
        </RailButton>
      </div>
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-label={expanded ? "Collapse the sidebar" : "Expand the sidebar"}
        aria-expanded={expanded}
        className="mt-auto hidden h-9 items-center justify-center rounded-lg text-ink-3 hover:bg-raised/70 hover:text-ink lg:flex"
      >
        <IconChevron dir={expanded ? "left" : "right"} />
      </button>
    </nav>
  );
}
