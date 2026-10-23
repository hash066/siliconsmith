"use client";

import { IconCheck } from "./ui";
import type { StepId, StepState, StepStatus } from "./workflow";

const TONE: Record<StepState, string> = {
  todo: "var(--hw-ink-3)",
  active: "var(--wb)",
  done: "var(--hw-ok)",
  warn: "var(--hw-warn)",
  blocked: "var(--hw-ink-3)",
};
const WORD: Record<StepState, string> = { todo: "not started", active: "in progress", done: "done", warn: "needs attention", blocked: "waiting" };

/** Brief, Propose, Verify, Evidence, Export. Every status comes from the workbench's real state; a click jumps to that part of the app. */
export function WorkflowBar({ steps, focused, onStep }: { steps: StepStatus[]; focused: StepId | null; onStep: (s: StepId) => void }) {
  return (
    <nav aria-label="Workflow" data-tour="workflow" className="@container shrink-0 border-b border-line bg-panel px-2 py-1.5">
      <ol className="grid grid-cols-5 gap-1">
        {steps.map((s, i) => (
          <li key={s.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onStep(s.id)}
              aria-current={focused === s.id ? "step" : undefined}
              aria-label={`${s.label}: ${WORD[s.state]}, ${s.note}`}
              data-step-id={s.id}
              data-state={s.state}
              className={`flex h-12 w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 text-left transition-colors duration-150 @lg:h-11 @lg:flex-row @lg:justify-start @lg:gap-2 @lg:px-2.5 ${focused === s.id ? "bg-raised" : "hover:bg-raised/60"}`}
            >
              <span className="num grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10.5px]" style={{ borderColor: TONE[s.state], color: TONE[s.state], background: s.state === "done" ? "color-mix(in srgb, var(--hw-ok) 16%, transparent)" : "transparent" }}>
                {s.state === "done" ? <IconCheck size={11} /> : s.state === "warn" ? "!" : i + 1}
              </span>
              <span className="flex min-w-0 max-w-full flex-col leading-tight">
                <span className="truncate text-[11px] font-medium text-ink @lg:text-[12.5px]">{s.label}</span>
                <span className="hidden truncate text-[11px] text-ink-3 @2xl:block">{s.note}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status">
        {steps.map((s) => `${s.label} ${WORD[s.state]}`).join(", ")}
      </p>
    </nav>
  );
}
