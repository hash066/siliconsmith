"use client";

import { candidates, passCount, rungCell, rungsOf, type CellStatus } from "@/lib/domain";
import type { RunState } from "@/lib/run-state";

export interface RungSelection {
  nodeId: string;
  rung: string;
}

const WORD: Record<CellStatus, string> = { pass: "pass", fail: "fail", unknown: "unknown, not counted as pass", running: "running", pending: "not run yet" };

export function CellGlyph({ status }: { status: CellStatus }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  switch (status) {
    case "pass":
      return (
        <svg {...common} style={{ color: "var(--signal-ink)" }}>
          <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "fail":
      return (
        <svg {...common} style={{ color: "var(--red)" }}>
          <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "unknown":
      return (
        <svg {...common} style={{ color: "var(--amber)" }}>
          <path d="M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 2.4" />
        </svg>
      );
    case "running":
      return (
        <svg {...common} className="anim-breathe" style={{ color: "var(--signal-ink)" }}>
          <circle cx="8" cy="8" r="3.2" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...common} style={{ color: "var(--ink-3)" }}>
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}

export function MatrixLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3" aria-label="Legend">
      {(["pass", "fail", "unknown", "running", "pending"] as CellStatus[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <CellGlyph status={s} />
          {s === "unknown" ? "Unknown or not run (never counts as pass)" : s === "pending" ? "Not run yet" : s[0].toUpperCase() + s.slice(1)}
        </li>
      ))}
    </ul>
  );
}

/** Rungs down, candidates across. A cell is a button that opens the evidence drawer for that rung of that node. */
export function RungMatrix({
  state,
  selected,
  onSelect,
  nodeLabel,
}: {
  state: RunState;
  selected: RungSelection | null;
  onSelect: (sel: RungSelection) => void;
  nodeLabel?: (id: string) => string | undefined;
}) {
  const rungs = rungsOf(state);
  const nodes = candidates(state);
  if (!rungs.length || !nodes.length)
    return (
      <p className="px-4 py-6 text-[13px] text-ink-3" role="status">
        {state.baseline || state.status !== "waiting" ? "Waiting for the first candidate to be judged…" : "Loading the run…"}
      </p>
    );
  return (
    <div className="scroll-quiet min-w-0 overflow-x-auto" role="region" aria-label="Check matrix" tabIndex={0}>
      <table className="w-max min-w-full border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-[148px] border-b border-line bg-panel px-3 py-2 text-[12px] font-normal text-ink-3">
              Rung · tool
            </th>
            {nodes.map((n) => {
              const pc = passCount(n, rungs);
              return (
                <th key={n.id} scope="col" className="min-w-[76px] border-b border-l border-line px-2 py-2 text-center align-bottom font-normal">
                  <span className="num block text-[12.5px] text-ink">{n.id}</span>
                  {nodeLabel?.(n.id) && <span className="block max-w-[110px] truncate text-[11px] text-ink-3">{nodeLabel(n.id)}</span>}
                  <span className="num block text-[11px] text-ink-3">
                    {pc.pass}/{pc.total}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rungs.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="sticky left-0 z-10 border-b border-line bg-panel px-3 py-1.5 text-left font-normal">
                <span className="num block text-[12.5px] text-ink">{r.id}</span>
                <span className="block max-w-[190px] truncate text-[11px] text-ink-3" title={r.tool}>
                  {r.tool ?? "tool not recorded"}
                </span>
              </th>
              {nodes.map((n) => {
                const cell = rungCell(n, r);
                const on = selected?.nodeId === n.id && selected.rung === r.id;
                return (
                  <td key={n.id} className="border-b border-l border-line p-0 text-center">
                    <button
                      type="button"
                      onClick={() => onSelect({ nodeId: n.id, rung: r.id })}
                      aria-label={`${n.id} ${r.id}: ${WORD[cell.status]}. Open evidence`}
                      aria-pressed={on}
                      className={`grid h-11 w-full min-w-[44px] place-items-center transition-colors duration-150 ${on ? "bg-raised" : "hover:bg-raised/60"}`}
                    >
                      <CellGlyph status={cell.status} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
