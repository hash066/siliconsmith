"use client";

import { useEffect, useMemo, useState } from "react";
import { DRC_WORDS, groupByType, parseDrcReport, type DrcFinding } from "@/lib/drc";
import type { LayoutSummary } from "@/lib/layout";
import { downloadFile, type ProductFile } from "./files";
import { btnGhost, btnPrimary } from "./ui";

const tone = (ok: boolean | null) => (ok === null ? "var(--ink-3)" : ok ? "var(--hw-ok)" : "var(--hw-bad)");

function Check({ ok, label, note }: { ok: boolean | null; label: string; note?: string }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5" data-ok={String(ok)}>
      <span aria-hidden="true" className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]" style={{ borderColor: tone(ok), color: tone(ok) }}>
        {ok === null ? "–" : ok ? "✓" : "✕"}
      </span>
      <span className="min-w-0 text-[12.5px] leading-snug text-ink">
        {label}
        {note && <span className="block text-[11.5px] text-ink-3">{note}</span>}
      </span>
    </li>
  );
}

const QUOTES: Array<[string, string]> = [
  ["PCBWay instant quote", "https://www.pcbway.com/orderonline.aspx"],
  ["JLCPCB quote", "https://jlcpcb.com/quote"],
  ["OSH Park", "https://oshpark.com/"],
];

/** What a board maker needs, read from the finished board, and the checks that say the files are ready. No prices: we have no quote to show. */
export function ManufacturePanel({ summary, gerber }: { summary: LayoutSummary; gerber: ProductFile | null }) {
  const s = summary.stats;
  const spec: Array<[string, string, string?]> = [
    ["Layers", `${s.layers}`, "from the board file"],
    ["Board size", `${s.board_mm[0]} × ${s.board_mm[1]} mm`, "from the board outline"],
    ["Thickness", "1.6 mm", "KiCad's default stack-up; choose it when ordering"],
    ["Tracks and spacing", "0.2 mm tracks, 0.15 mm clearance", "the rules the board was routed and checked with"],
    ["Vias", "0.6 mm pad, 0.3 mm drill", "plated through-holes"],
    ["Copper weight, finish, mask colour", "not set in the file", "you choose these on the maker's form"],
    ["Parts", `${s.parts} (${s.added_parts} bypass capacitors added by the layout)`, "see the BOM"],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-testid="manufacture">
      <section aria-label="Ready to send" className="rounded-xl border border-line bg-panel p-3">
        <h3 className="hw-label mb-1 !text-[10.5px]">Ready to send to a board maker?</h3>
        <ul className="divide-y divide-line">
          <Check ok={s.fully_routed} label="Every connection is routed" note={s.fully_routed ? undefined : `${s.unrouted_connections} connection(s) are not`} />
          <Check ok={summary.drc.errors === 0} label="KiCad design-rule check: no errors" note={`${summary.drc.errors} error(s), ${summary.drc.warnings} warning(s), all silkscreen`.replace("all silkscreen", summary.drc.errors === 0 ? "warnings are silkscreen" : "see the DRC tab")} />
          <Check ok={gerber !== null} label="Gerber and drill files are generated" />
          <Check ok={null} label="Electrical testing and fabrication" note="Not done. This is a prototype layout, not a tested design." />
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={!gerber} onClick={() => gerber && downloadFile(gerber)} className={btnPrimary} data-testid="mfg-gerber">
            Download Gerbers and drill
          </button>
        </div>
      </section>
      <section aria-label="Board specification" className="rounded-xl border border-line bg-panel p-3">
        <h3 className="hw-label mb-1 !text-[10.5px]">Board specification</h3>
        <dl className="divide-y divide-line text-[12.5px]">
          {spec.map(([k, v, n]) => (
            <div key={k} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
              <dt className="w-[40%] min-w-[130px] text-ink-3">{k}</dt>
              <dd className="min-w-0 flex-1 text-ink">
                {v}
                {n && <span className="block text-[11.5px] text-ink-3">{n}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label="Get a quote" className="rounded-xl border border-line bg-panel p-3">
        <h3 className="hw-label mb-1 !text-[10.5px]">Get a quote</h3>
        <p className="text-[12.5px] leading-snug text-ink-2">Upload the Gerber zip on a board maker&apos;s own quote page; it detects the layers and size from the files. We show no price here because we have no quote to show.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUOTES.map(([n, u]) => (
            <a key={n} href={u} target="_blank" rel="noopener noreferrer" className={btnGhost}>
              {n} ↗
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

/** KiCad's design-rule findings, grouped, each with its place on the board. */
export function DrcPanel({ summary, reportText, onShow }: { summary: LayoutSummary; reportText: string | null; onShow: (x: number, y: number) => void }) {
  const findings = useMemo<DrcFinding[]>(() => (reportText ? parseDrcReport(reportText) : []), [reportText]);
  const groups = useMemo(() => groupByType(findings), [findings]);
  const [open, setOpen] = useState<string | null>(null);
  const d = summary.drc;
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-testid="drc-panel">
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px] [&>div]:bg-panel [&>div]:px-3 [&>div]:py-2">
        <div>
          <dt className="text-[11.5px] text-ink-3">Errors</dt>
          <dd className="num text-[20px] leading-tight" style={{ color: d.errors ? "var(--hw-bad)" : "var(--hw-ok)" }}>{d.errors}</dd>
        </div>
        <div>
          <dt className="text-[11.5px] text-ink-3">Warnings</dt>
          <dd className="num text-[20px] leading-tight text-ink">{d.warnings}</dd>
        </div>
        <div>
          <dt className="text-[11.5px] text-ink-3">Unconnected</dt>
          <dd className="num text-[20px] leading-tight text-ink">{d.unconnected}</dd>
        </div>
      </dl>
      <p className="text-[12px] leading-snug text-ink-3">KiCad 7&apos;s own design-rule check on the finished board. Errors block manufacture; silkscreen warnings do not. Click a finding to see where it is.</p>
      {groups.length === 0 && <p className="rounded-xl border border-line bg-panel px-3 py-4 text-[13px] text-ink-3" role="status">{reportText === null ? "Loading the report…" : "KiCad reported nothing."}</p>}
      <ul className="flex flex-col gap-2" aria-label="Findings">
        {groups.map((g) => {
          const key = `${g.severity}:${g.type}`;
          return (
            <li key={key} className="rounded-xl border border-line bg-panel" data-severity={g.severity}>
              <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
                <span className="rounded-full border px-2 py-0.5 text-[10.5px]" style={{ borderColor: g.severity === "error" ? "var(--hw-bad)" : "var(--hw-warn)", color: g.severity === "error" ? "var(--hw-bad)" : "var(--hw-warn)" }}>{g.severity}</span>
                <span className="min-w-0 flex-1 text-[13px] text-ink">{DRC_WORDS[g.type] ?? g.description}</span>
                <span className="num text-[12px] text-ink-3">{g.list.length}</span>
              </button>
              {open === key && (
                <ul className="border-t border-line px-3 py-2">
                  {g.list.map((f, i) => (
                    <li key={i}>
                      {f.items.slice(0, 1).map((it, j) => (
                        <button key={j} type="button" onClick={() => onShow(it.x, it.y)} className="flex w-full items-baseline gap-2 py-1 text-left text-[12px] text-ink-2 hover:text-ink">
                          <span className="num shrink-0 text-ink-3">{it.x.toFixed(1)}, {it.y.toFixed(1)}</span>
                          <span className="min-w-0 truncate">{f.items.map((x) => x.text).join(" · ")}</span>
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The DRC report text for a board: from a stored file, or from the files of a board made on request. */
export function useDrcText(href: string | null, base64: string | null): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    setText(null);
    if (base64) {
      try {
        setText(atob(base64));
      } catch {
        setText("");
      }
      return;
    }
    if (!href) return;
    void fetch(href)
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => !dead && setText(t))
      .catch(() => !dead && setText(""));
    return () => {
      dead = true;
    };
  }, [href, base64]);
  return text;
}
