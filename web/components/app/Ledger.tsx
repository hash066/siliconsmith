import type { LedgerRow } from "@/lib/ledger";

const TONE: Record<LedgerRow["result"], string> = { pass: "var(--hw-ok)", fail: "var(--hw-bad)", unknown: "var(--hw-warn)", "not run": "var(--ink-3)" };

/** "Verified by": what stands behind each claim. */
export function Ledger({ rows, title = "Verified by" }: { rows: LedgerRow[]; title?: string }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border border-line bg-panel p-3" data-testid="ledger">
      <h3 className="hw-label mb-2 !text-[10.5px]">{title}</h3>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.what} data-result={r.result} className="flex min-w-0 items-start gap-3 py-2">
            <span className="mt-0.5 w-[58px] shrink-0 rounded-full border px-2 py-0.5 text-center text-[10.5px]" style={{ borderColor: TONE[r.result], color: TONE[r.result] }}>
              {r.result}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[12.5px] leading-snug text-ink">{r.what}</span>
              <span className="num block break-words text-[11.5px] leading-snug text-ink-3">{r.tool}</span>
              {r.note && <span className="block break-words text-[11.5px] leading-snug text-ink-3">{r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
