"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { rungLabel, RUNG_CHECK, STATUS_WORD } from "@/lib/labels";
import { ladderFor, type NodeState, type RungView } from "@/lib/run-state";

const STATUS_COLOR: Record<RungView["status"], string> = {
  pass: "var(--signal-ink)",
  fail: "var(--red)",
  skipped: "var(--amber)",
  running: "var(--signal-ink)",
  pending: "var(--ink-3)",
  "not-run": "var(--ink-3)",
};

function RungMark({ status }: { status: RungView["status"] }) {
  const reduce = usePrefersReducedMotion();
  return (
    <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true" className="shrink-0">
      <circle r="7.5" fill="none" stroke={status === "pending" || status === "not-run" ? "var(--line-2)" : STATUS_COLOR[status]} strokeWidth="1.25" strokeDasharray={status === "not-run" ? "2 2.2" : undefined} />
      {status === "pass" && (
        <motion.path
          d="M-3.4 0.2 L-1 2.6 L3.6 -2.4"
          fill="none"
          stroke="var(--signal-ink)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      {status === "fail" && (
        <g stroke="var(--red)" strokeWidth="1.8" strokeLinecap="round">
          <line x1="-2.8" y1="-2.8" x2="2.8" y2="2.8" />
          <line x1="2.8" y1="-2.8" x2="-2.8" y2="2.8" />
        </g>
      )}
      {status === "skipped" && <line x1="-3" y1="0" x2="3" y2="0" stroke="var(--amber)" strokeWidth="1.8" strokeLinecap="round" />}
      {status === "running" && <circle r="3" fill="var(--signal)" className="anim-breathe" />}
    </svg>
  );
}

export function Ladder({ node, dense = false }: { node: NodeState; dense?: boolean }) {
  const rungs = ladderFor(node);
  return (
    <ol className="relative" aria-label="Verification ladder">
      {rungs.map((r, i) => {
        const claimed = r.status === "pass";
        const label = rungLabel(r, node);
        const isLast = i === rungs.length - 1;
        return (
          <li key={r.rung} className={`relative flex gap-3 ${dense ? "py-1.5" : "py-2.5"}`}>
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute left-[8.5px] top-[30px] bottom-[-6px] w-px transition-colors duration-500"
                style={{ background: claimed && rungs[i + 1].status === "pass" ? "var(--signal-line)" : "var(--line)" }}
              />
            )}
            <RungMark status={r.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="num w-6 shrink-0 text-[12px] text-ink-3">{r.rung}</span>
                <span className={`min-w-0 flex-1 text-[13.5px] leading-snug ${claimed ? "text-ink" : "text-ink-3"}`}>
                  {label}
                </span>
                <span className="shrink-0 text-[12px]" style={{ color: STATUS_COLOR[r.status] }}>
                  {STATUS_WORD[r.status]}
                </span>
              </div>
              {!dense && (
                <p className="num mt-0.5 pl-8 text-[11.5px] leading-relaxed text-ink-3">
                  {r.detail ?? (r.status === "not-run" ? (r.rung === "L6" ? "No FPGA run yet" : "Did not run on this candidate") : RUNG_CHECK[r.rung])}
                </p>
              )}
              {!dense &&
                r.failures.map((f) => (
                  <p key={f.attempt} className="num mt-1 pl-8 text-[11.5px] leading-relaxed text-red">
                    Attempt {f.attempt} failed{f.detail ? `: ${f.detail}` : ""}
                  </p>
                ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
