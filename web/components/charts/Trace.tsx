/** A step trace over run time (oscilloscope style): one series, an optional reference line, a cursor. */
export function Trace({
  series,
  duration,
  cursor,
  max,
  reference,
  referenceLabel,
  height = 64,
  label,
}: {
  series: Array<[number, number]>;
  duration: number;
  cursor?: number;
  max?: number;
  reference?: number;
  referenceLabel?: string;
  height?: number;
  label: string;
}) {
  const W = 260;
  const H = height;
  const pad = 4;
  const top = Math.max(1, max ?? 0, reference ?? 0, ...series.map((p) => p[1]));
  const sx = (t: number) => pad + (duration > 0 ? (t / duration) * (W - 2 * pad) : 0);
  const sy = (v: number) => H - pad - (v / top) * (H - 2 * pad - 8);
  let d = "";
  let prev = 0;
  for (const [t, v] of series) {
    d += d ? ` H${sx(t).toFixed(1)} V${sy(v).toFixed(1)}` : `M${sx(0)},${sy(0)} H${sx(t).toFixed(1)} V${sy(v).toFixed(1)}`;
    prev = v;
  }
  if (d && cursor !== undefined) d += ` H${sx(cursor).toFixed(1)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={label} className="block">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={pad} x2={W - pad} y1={pad + 8 + f * (H - 2 * pad - 8)} y2={pad + 8 + f * (H - 2 * pad - 8)} stroke="var(--grid-major)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--line-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {reference !== undefined && (
        <>
          <line x1={pad} x2={W - pad} y1={sy(reference)} y2={sy(reference)} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {referenceLabel && (
            <text x={W - pad} y={sy(reference) - 3} textAnchor="end" fontSize="9" fill="var(--ink-3)" className="num">
              {referenceLabel}
            </text>
          )}
        </>
      )}
      {d && <path d={d} fill="none" stroke="var(--signal)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      {cursor !== undefined && series.length > 0 && <circle cx={sx(cursor)} cy={sy(prev)} r="2.2" fill="var(--signal)" />}
    </svg>
  );
}
