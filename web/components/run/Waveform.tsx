"use client";

import type { Counterexample, WaveSignal } from "@/lib/events";

const LABEL_W = 96;
const ROW_BIT = 24;
const ROW_BUS = 28;

const isUnknown = (v: string) => /^[xz?]+$/i.test(v) || v === "";

function fmtValue(sig: WaveSignal, v: string) {
  if (isUnknown(v)) return "";
  if (sig.width === 1) return v;
  return `0x${v.toLowerCase().replace(/^0x/, "")}`;
}

/** Cycles where a miter / equivalence output drops to 0: the counterexample's failing step. */
export function mismatchCycles(cex: Counterexample): Set<number> {
  const out = new Set<number>();
  for (const s of cex.signals) {
    if (s.width === 1 && /(miter|ok|eq|equiv|assert)/i.test(s.name)) s.values.forEach((v, i) => v === "0" && out.add(i));
  }
  return out;
}

function pairKey(name: string) {
  return name.replace(/^spec_/, "").replace(/^pcpi_/, "").replace(/_q$/, "");
}

/** SVG waveform for a formal counterexample (artifacts.counterexample on a failed prove stage). */
export function Waveform({ cex, cycleWidth = 76 }: { cex: Counterexample; cycleWidth?: number }) {
  const n = Math.max(cex.cycles, ...cex.signals.map((s) => s.values.length));
  const bad = mismatchCycles(cex);
  const spec = new Map(cex.signals.filter((s) => s.name.startsWith("spec_")).map((s) => [pairKey(s.name), s]));
  const rows = cex.signals.map((s) => ({ s, h: s.width === 1 ? ROW_BIT : ROW_BUS }));
  const top = 22;
  const height = top + rows.reduce((a, r) => a + r.h, 0) + 6;
  const width = LABEL_W + n * cycleWidth + 8;
  let y = top;

  return (
    <div className="scroll-quiet overflow-x-auto rounded-md border border-line bg-sunken" role="region" aria-label="Counterexample waveform" tabIndex={0}>
      <svg width={width} height={height} className="block" role="img" aria-label={`Counterexample over ${n} cycles${bad.size ? `, mismatch at cycle ${[...bad].join(", ")}` : ""}`}>
        <defs>
          <pattern id="wave-x" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--line-2)" strokeWidth="1.2" />
          </pattern>
        </defs>
        {/* graticule: one division per cycle */}
        {Array.from({ length: n + 1 }, (_, i) => (
          <line key={`g${i}`} x1={LABEL_W + i * cycleWidth} y1={top - 6} x2={LABEL_W + i * cycleWidth} y2={height - 4} stroke="var(--grid-major)" strokeWidth="1" />
        ))}
        {[...bad].map((c) => (
          <g key={`bad${c}`}>
            <rect x={LABEL_W + c * cycleWidth} y={top - 6} width={cycleWidth} height={height - top + 2} fill="var(--red-dim)" />
            <text x={LABEL_W + c * cycleWidth + cycleWidth / 2} y={12} textAnchor="middle" fontSize="10.5" fill="var(--red)" className="num">
              mismatch
            </text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) =>
          bad.has(i) ? null : (
            <text key={`c${i}`} x={LABEL_W + i * cycleWidth + cycleWidth / 2} y={12} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)" className="num">
              {i}
            </text>
          ),
        )}
        {rows.map(({ s, h }) => {
          const y0 = y;
          y += h;
          const mid = y0 + h / 2;
          const lo = y0 + h - 6;
          const hi = y0 + 6;
          const pair = s.name.startsWith("spec_") ? undefined : spec.get(pairKey(s.name));
          const isGateOfPair = !!pair;
          return (
            <g key={s.name}>
              <text x={8} y={mid + 4} fontSize="11.5" className="num" fill={s.name.startsWith("spec_") ? "var(--ink-2)" : "var(--ink)"}>
                {s.name}
                {s.width > 1 ? <tspan fill="var(--ink-3)">{` [${s.width - 1}:0]`}</tspan> : null}
              </text>
              {s.width === 1
                ? (() => {
                    let d = "";
                    const segs: React.ReactElement[] = [];
                    for (let i = 0; i < n; i++) {
                      const v = s.values[i] ?? "x";
                      const x0 = LABEL_W + i * cycleWidth;
                      if (isUnknown(v)) {
                        segs.push(<rect key={i} x={x0} y={hi} width={cycleWidth} height={lo - hi} fill="url(#wave-x)" />);
                        continue;
                      }
                      const yy = v === "1" ? hi : lo;
                      d += `${d ? "L" : "M"}${x0},${yy} L${x0 + cycleWidth},${yy} `;
                    }
                    return (
                      <g>
                        {segs}
                        <path d={d} fill="none" stroke={/(miter|ok|eq)/i.test(s.name) ? "var(--ink-2)" : "var(--signal)"} strokeWidth="1.5" />
                      </g>
                    );
                  })()
                : (() => {
                    const segs: Array<{ from: number; to: number; v: string }> = [];
                    for (let i = 0; i < n; i++) {
                      const v = s.values[i] ?? "x";
                      const last = segs.at(-1);
                      if (last && last.v === v) last.to = i + 1;
                      else segs.push({ from: i, to: i + 1, v });
                    }
                    return segs.map((g) => {
                      const x0 = LABEL_W + g.from * cycleWidth + 1;
                      const x1 = LABEL_W + g.to * cycleWidth - 1;
                      const sl = 4;
                      if (isUnknown(g.v)) return <rect key={g.from} x={x0} y={hi} width={x1 - x0} height={lo - hi} fill="url(#wave-x)" />;
                      const pts = `${x0},${mid} ${x0 + sl},${hi} ${x1 - sl},${hi} ${x1},${mid} ${x1 - sl},${lo} ${x0 + sl},${lo}`;
                      const differs = pair && [...bad].some((c) => c >= g.from && c < g.to && (pair.values[c] ?? "").toLowerCase().replace(/^0+/, "") !== g.v.toLowerCase().replace(/^0+/, ""));
                      const color = differs && isGateOfPair ? "var(--red)" : s.name.startsWith("spec_") ? "var(--ink-2)" : "var(--ink)";
                      return (
                        <g key={g.from}>
                          <polygon points={pts} fill={differs ? "var(--red-dim)" : "var(--panel)"} stroke={differs ? "var(--red)" : "var(--line-2)"} strokeWidth="1" />
                          <text x={(x0 + x1) / 2} y={mid + 3.8} textAnchor="middle" fontSize="10.5" className="num" fill={color}>
                            {x1 - x0 > 40 ? fmtValue(s, g.v) : ""}
                          </text>
                        </g>
                      );
                    });
                  })()}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
