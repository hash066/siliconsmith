"use client";

import type { NodeId } from "@/lib/events";
import { pct, times } from "@/lib/format";
import type { FrontierPoint } from "@/lib/run-state";

const W = 720;
const H = 380;
const M = { l: 52, r: 24, t: 28, b: 46 };

function niceMax(v: number, step: number) {
  return Math.ceil(v / step) * step;
}

export function Pareto({
  points,
  budget,
  mnemonics,
  onSelect,
}: {
  points: FrontierPoint[];
  budget?: number;
  mnemonics: Record<NodeId, string>;
  onSelect?: (id: NodeId) => void;
}) {
  const maxArea = Math.max(budget ? budget * 1.25 : 1, ...points.map((p) => p.areaPct)) + 0.25;
  const xMax = niceMax(maxArea, 1);
  const yMax = Math.max(2, niceMax(Math.max(...points.map((p) => p.wall), 1) + 0.15, 1));
  const sx = (a: number) => M.l + (Math.max(0, a) / xMax) * (W - M.l - M.r);
  const sy = (w: number) => H - M.b - ((w - 1) / (yMax - 1)) * (H - M.t - M.b);
  const front = [{ areaPct: 0, wall: 1 }, ...points.filter((p) => p.onPareto).sort((a, b) => a.areaPct - b.areaPct)];
  let d = "";
  front.forEach((p, i) => {
    d += i === 0 ? `M${sx(p.areaPct)},${sy(p.wall)}` : ` H${sx(p.areaPct)} V${sy(p.wall)}`;
  });
  const overBudget = points.filter((p) => p.kind === "budget" || (budget !== undefined && p.areaPct > budget));
  const bestOver = overBudget.sort((a, b) => b.wall - a.wall)[0];
  const unproven = points.filter((p) => p.kind === "unproven").sort((a, b) => b.wall - a.wall)[0];
  const best = points.find((p) => p.best);
  const labelled = new Set([best?.id, bestOver?.id, unproven?.id].filter(Boolean) as string[]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Wall-clock speedup against area for every measured candidate" className="block h-auto">
      <defs>
        <pattern id="over-budget" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--amber)" strokeOpacity="0.16" strokeWidth="1.5" />
        </pattern>
      </defs>
      {budget !== undefined && <rect x={sx(budget)} y={M.t} width={W - M.r - sx(budget)} height={H - M.t - M.b} fill="url(#over-budget)" />}
      {Array.from({ length: yMax }, (_, i) => i + 1).map((v) => (
        <g key={`y${v}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke={v === 1 ? "var(--line-2)" : "var(--grid-major)"} strokeWidth="1" />
          <text x={M.l - 10} y={sy(v) + 4} textAnchor="end" fontSize="12" fill="var(--ink-3)" className="num">
            {v}×
          </text>
        </g>
      ))}
      {Array.from({ length: xMax + 1 }, (_, i) => i).map((v) => (
        <text key={`x${v}`} x={sx(v)} y={H - M.b + 18} textAnchor="middle" fontSize="12" fill="var(--ink-3)" className="num">
          {v}%
        </text>
      ))}
      <text x={(M.l + W - M.r) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--ink-3)">
        Area Δ, % LUT-equivalent
      </text>
      <text x={14} y={(M.t + H - M.b) / 2} textAnchor="middle" fontSize="12" fill="var(--ink-3)" transform={`rotate(-90 14 ${(M.t + H - M.b) / 2})`}>
        Wall-clock speedup
      </text>
      {budget !== undefined && (
        <g>
          <line x1={sx(budget)} x2={sx(budget)} y1={M.t - 8} y2={H - M.b} stroke="var(--amber)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={sx(budget) + 6} y={M.t - 1} fontSize="12" fill="var(--amber)" className="num">
            budget {budget.toFixed(1)}%
          </text>
        </g>
      )}
      <path d={d} fill="none" stroke="var(--signal)" strokeWidth="1.5" strokeOpacity="0.85" />
      <g>
        <circle cx={sx(0)} cy={sy(1)} r="4" fill="var(--panel)" stroke="var(--ink-3)" strokeWidth="1.5" />
        <text x={sx(0) + 8} y={sy(1) - 8} fontSize="11.5" fill="var(--ink-3)" className="num">
          baseline
        </text>
      </g>
      {points
        .slice()
        .sort((a, b) => Number(a.best) - Number(b.best))
        .map((p) => {
          const x = sx(p.areaPct);
          const y = sy(p.wall);
          const title = `${p.id} ${mnemonics[p.id] ?? ""}: ${times(p.wall)} at ${pct(p.areaPct)}${p.kind === "budget" ? " (over budget)" : p.kind === "unproven" ? " (proof incomplete)" : ""}`;
          const mark =
            p.best ? (
              <g>
                <circle cx={x} cy={y} r="10" fill="none" stroke="var(--signal)" strokeWidth="1" />
                <circle cx={x} cy={y} r="6" fill="var(--signal)" />
              </g>
            ) : p.kind === "unproven" ? (
              <rect x={x - 5} y={y - 5} width="10" height="10" transform={`rotate(45 ${x} ${y})`} fill="var(--panel)" stroke="var(--amber)" strokeWidth="1.5" />
            ) : p.kind === "budget" ? (
              <circle cx={x} cy={y} r="4.5" fill="var(--panel)" stroke="var(--amber)" strokeWidth="1.5" />
            ) : (
              <circle cx={x} cy={y} r="4.5" fill={p.onPareto ? "var(--ink)" : "var(--ink-3)"} />
            );
          return (
            <g
              key={p.id}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={title}
              onClick={onSelect ? () => onSelect(p.id) : undefined}
              onKeyDown={onSelect ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(p.id) : undefined}
              className={onSelect ? "cursor-pointer" : undefined}
            >
              <circle cx={x} cy={y} r="12" fill="transparent" />
              {mark}
              <title>{title}</title>
              {labelled.has(p.id) && (
                <text
                  x={p.kind === "budget" ? x - 10 : x + 12}
                  y={p.best ? y + 22 : y - 10}
                  textAnchor={p.kind === "budget" ? "end" : "start"}
                  fontSize="12"
                  fill={p.best ? "var(--signal-ink)" : "var(--amber)"}
                  className="num"
                >
                  {mnemonics[p.id]} {times(p.wall)}
                  {p.kind === "unproven" ? " · proof incomplete" : p.kind === "budget" ? " · over budget" : ""}
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}

export function ParetoLegend() {
  const item = (svg: React.ReactNode, label: string) => (
    <li className="flex items-center gap-1.5">
      <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
        {svg}
      </svg>
      {label}
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
      {item(<circle r="4.5" fill="var(--signal)" />, "Best")}
      {item(<circle r="4" fill="var(--ink)" />, "On the frontier")}
      {item(<circle r="4" fill="var(--ink-3)" />, "Verified, dominated")}
      {item(<rect x="-4" y="-4" width="8" height="8" transform="rotate(45)" fill="none" stroke="var(--amber)" strokeWidth="1.5" />, "Proof incomplete")}
      {item(<circle r="4" fill="none" stroke="var(--amber)" strokeWidth="1.5" />, "Over budget (measured, pruned)")}
      {item(<line x1="-6" x2="6" y1="0" y2="0" stroke="var(--signal)" strokeWidth="1.5" />, "Pareto front")}
    </ul>
  );
}
