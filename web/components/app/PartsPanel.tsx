"use client";

import { useEffect, useMemo, useState } from "react";
import { bomCsvText, bomOf, CATEGORIES, categoryOf, filterParts, type BomRow, type Category, type LibPart } from "@/lib/parts-library";
import { downloadFile } from "./files";
import { btnGhost } from "./ui";

let cache: Promise<LibPart[]> | null = null;
/** The part library from the hosted API, once per visit. */
export function useLibraryParts(): { parts: LibPart[]; state: "loading" | "ready" | "failed" } {
  const [s, setS] = useState<{ parts: LibPart[]; state: "loading" | "ready" | "failed" }>({ parts: [], state: "loading" });
  useEffect(() => {
    let dead = false;
    cache ??= fetch("/api/board/parts").then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      return ((await r.json()) as { parts: LibPart[] }).parts;
    });
    cache.then((parts) => !dead && setS({ parts, state: "ready" })).catch(() => {
      cache = null;
      if (!dead) setS({ parts: [], state: "failed" });
    });
    return () => {
      dead = true;
    };
  }, []);
  return s;
}

function PartCard({ p, used, onAsk }: { p: LibPart; used: number; onAsk: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const checked = p.facts.filter((f) => f.citation_checked).length;
  return (
    <li className="rounded-xl border border-line bg-panel" data-part={p.id}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full min-w-0 items-start gap-3 p-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-ink">{p.name}</span>
          <span className="num block text-[11.5px] text-ink-3">{p.package || p.kind} · {p.pins.length} pins</span>
          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-ink-2">{p.description}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-ink-3">
          {used > 0 && <span className="rounded-full border border-signal-line px-2 py-0.5 text-ink">in design ×{used}</span>}
          <span>{p.facts.length ? `${checked}/${p.facts.length} facts sourced` : "no facts"}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-3">
          <p className="text-[11.5px] leading-snug text-ink-3">{p.pin_table_checked ? "Pin table checked against its datasheet." : "Pin table has not been cross-checked against a datasheet."}</p>
          {p.pins.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label={`${p.name} pins`}>
              {p.pins.slice(0, 40).map((x) => (
                <li key={`${x.name}-${x.number}`} className="num rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-2" title={x.capabilities?.join(", ")}>
                  {x.number} {x.name}
                </li>
              ))}
              {p.pins.length > 40 && <li className="text-[10.5px] text-ink-3">+{p.pins.length - 40} more</li>}
            </ul>
          )}
          {p.facts.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {p.facts.slice(0, 6).map((f) => (
                <li key={f.id} className="rounded bg-sunken px-2 py-1 text-[11.5px] leading-snug text-ink-2">
                  <span className="num mr-1.5 text-ink-3">{f.id}</span>
                  {f.text}
                  {!f.citation_checked && <span className="ml-1 text-ink-3">· not checked against its source</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {(p.sources ?? []).slice(0, 2).map((u) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" className={btnGhost}>
                Datasheet ↗
              </a>
            ))}
            <button type="button" onClick={() => onAsk(`Add a ${p.name} to the board, wire it up using its facts, and re-check the design.`)} className={btnGhost} data-testid={`add-${p.id}`}>
              Ask the agent to add it
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The part library (search, categories, facts, datasheets) and the BOM of the design on the canvas. */
export function PartsPanel({ design, onAsk }: { design: { instances: Array<{ ref: string; part: string; params?: Record<string, unknown> }> } | null; onAsk: (text: string) => void }) {
  const { parts, state } = useLibraryParts();
  const [cat, setCat] = useState<Category>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => filterParts(parts, cat, q), [parts, cat, q]);
  const bom = useMemo<BomRow[]>(() => bomOf(design, parts), [design, parts]);
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of design?.instances ?? []) m.set(i.part, (m.get(i.part) ?? 0) + 1);
    return m;
  }, [design]);
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-testid="parts-panel">
      <section aria-label="Bill of materials" className="rounded-xl border border-line bg-panel p-3">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="hw-label !text-[10.5px]">Bill of materials</h3>
          <button type="button" disabled={bom.length === 0} onClick={() => downloadFile({ name: "bom.csv", mime: "text/csv", note: "Parts list", text: bomCsvText(bom) })} className={`${btnGhost} ml-auto !h-7`}>
            Download CSV
          </button>
        </div>
        {bom.length === 0 ? (
          <p className="py-3 text-[12.5px] text-ink-3">No design yet.</p>
        ) : (
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="text-[11px] text-ink-3">
                <th className="py-1 pr-2 font-normal">Refs</th>
                <th className="py-1 pr-2 font-normal">Qty</th>
                <th className="py-1 pr-2 font-normal">Part</th>
                <th className="py-1 font-normal">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bom.map((r) => (
                <tr key={`${r.part}${r.value}`}>
                  <td className="num py-1.5 pr-2 text-ink">{r.refs.join(" ")}</td>
                  <td className="num py-1.5 pr-2 text-ink-2">{r.refs.length}</td>
                  <td className="py-1.5 pr-2 text-ink">{r.name}</td>
                  <td className="num py-1.5 text-ink-2">{r.value || "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section aria-label="Part library" className="min-w-0">
        <h3 className="hw-label mb-2 !text-[10.5px]">Part library</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[160px] flex-1">
            <span className="sr-only">Search parts</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts: esp32, sensor, resistor…" className="h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13px] text-ink placeholder:text-ink-3 focus:border-[var(--wb)] focus:outline-none" />
          </label>
          <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1">
            {CATEGORIES.map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={cat === id} onClick={() => setCat(id)} data-testid={`pcat-${id}`} className={`h-8 rounded-full border px-3 text-[12px] ${cat === id ? "border-signal-line bg-raised text-ink" : "border-line text-ink-3 hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {state === "loading" && <p className="mt-3 text-[12.5px] text-ink-3" role="status">Loading the library…</p>}
        {state === "failed" && <p className="mt-3 text-[12.5px] text-ink-3" role="alert">The part library could not be loaded.</p>}
        <ul className="mt-3 flex flex-col gap-2" aria-label="Parts">
          {shown.map((p) => (
            <PartCard key={p.id} p={p} used={used.get(p.id) ?? 0} onAsk={onAsk} />
          ))}
          {state === "ready" && shown.length === 0 && <li className="rounded-xl border border-line bg-panel px-3 py-4 text-[13px] text-ink-3">No part matches. The library holds the parts the checks have facts for; the agent can use only these.</li>}
        </ul>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-3">Facts are author-curated. A fact without a checked source is marked; the checks say so when they rely on one. Categories: {CATEGORIES.slice(1).map(([id]) => `${id} (${parts.filter((p) => categoryOf(p) === id && p.kind !== "placeholder" && p.kind !== "standard").length})`).join(", ")}.</p>
      </section>
    </div>
  );
}
