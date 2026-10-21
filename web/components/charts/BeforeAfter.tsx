export interface Pair {
  label: string;
  before: number;
  after: number;
  format: (n: number) => string;
  /** Which direction is better: fewer cycles, less area. */
  better: "lower" | "higher";
  note?: string;
}

/** Paired horizontal bars, baseline above candidate, on one scale per row. */
export function BeforeAfter({ rows, beforeLabel, afterLabel }: { rows: Pair[]; beforeLabel: string; afterLabel: string }) {
  return (
    <div className="space-y-6">
      {rows.map((r) => {
        const max = Math.max(r.before, r.after) || 1;
        const ratio = r.after / (r.before || 1);
        const good = r.better === "lower" ? ratio <= 1 : ratio >= 1;
        return (
          <div key={r.label}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-ink-2">{r.label}</span>
              <span className="num text-[12px]" style={{ color: good ? "var(--signal-ink)" : "var(--amber)" }}>
                {ratio < 1 ? `${(1 / ratio).toFixed(2)}× fewer` : `${ratio.toFixed(3)}× (${ratio >= 1 ? "+" : ""}${((ratio - 1) * 100).toFixed(1)}%)`}
              </span>
            </div>
            {[
              { name: beforeLabel, v: r.before, color: "var(--ink-3)" },
              { name: afterLabel, v: r.after, color: good ? "var(--signal)" : "var(--amber)" },
            ].map((b) => (
              <div key={b.name} className="mt-1.5 grid grid-cols-[96px_1fr_auto] items-center gap-3">
                <span className="num truncate text-[12px] text-ink-3">{b.name}</span>
                <div className="h-3 rounded-[2px] bg-raised">
                  <div className="h-3 rounded-[2px] transition-[width] duration-700" style={{ width: `${(b.v / max) * 100}%`, background: b.color }} />
                </div>
                <span className="num w-24 text-right text-[13px] text-ink">{r.format(b.v)}</span>
              </div>
            ))}
            {r.note && <p className="mt-2 text-[12px] text-ink-3">{r.note}</p>}
          </div>
        );
      })}
    </div>
  );
}
