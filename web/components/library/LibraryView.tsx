"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildEvidence, type EvidenceMetric } from "@/lib/evidence";
import { parseNdjson } from "@/lib/events";
import { int, pct, times } from "@/lib/format";
import { libraryEntries, sha256Hex, type LibraryEntry } from "@/lib/library";
import { reduceAll, type RunState } from "@/lib/run-state";
import { EvidenceChip } from "../evidence/EvidenceChip";
import { EvidencePanel } from "../evidence/EvidencePanel";
import { CellGlyph } from "../domain/RungMatrix";

type Loaded = { status: "loading" } | { status: "ready"; entries: LibraryEntry[]; states: Record<string, RunState>; failed: string[] };

function useLibrary(runIds: string[]): Loaded {
  const [r, setR] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    let dead = false;
    (async () => {
      const states: Record<string, RunState> = {};
      const failed: string[] = [];
      await Promise.all(
        runIds.map(async (id) => {
          try {
            const res = await fetch(`/replays/${id}.ndjson`, { cache: "no-store" });
            if (!res.ok) throw new Error(String(res.status));
            states[id] = reduceAll(parseNdjson(await res.text()).events);
          } catch {
            failed.push(id);
          }
        }),
      );
      if (dead) return;
      setR({ status: "ready", entries: libraryEntries(runIds.filter((id) => states[id]).map((runId) => ({ runId, state: states[runId] }))), states, failed });
    })();
    return () => {
      dead = true;
    };
  }, [runIds]);
  return r;
}

function Rungs({ rungs }: { rungs: Record<string, "pass" | "fail" | "skipped"> }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Rungs L1 to L5: ${["L1", "L2", "L3", "L4", "L5"].map((r) => `${r} ${rungs[r]}`).join(", ")}`}>
      {["L1", "L2", "L3", "L4", "L5"].map((r) => (
        <span key={r} className="flex flex-col items-center" title={`${r}: ${rungs[r]}`}>
          <CellGlyph status={rungs[r] === "pass" ? "pass" : rungs[r] === "fail" ? "fail" : "unknown"} />
          <span className="num text-[9px] text-ink-3">{r}</span>
        </span>
      ))}
    </span>
  );
}

function Detail({ entry, states }: { entry: LibraryEntry; states: Record<string, RunState> }) {
  const [metric, setMetric] = useState<EvidenceMetric | null>(null);
  const [rtlHash, setRtlHash] = useState<string | null>(null);
  const b = entry.best;
  useEffect(() => {
    let dead = false;
    setMetric(null);
    setRtlHash(null);
    if (entry.rtlText) void sha256Hex(entry.rtlText).then((h) => !dead && setRtlHash(h));
    return () => {
      dead = true;
    };
  }, [entry]);
  const ev = metric ? buildEvidence(states[b.runId], b.nodeId, metric, "replay") : null;
  const figure = (label: string, value: string, m: EvidenceMetric) => (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-[12px] text-ink-3">{label}</dt>
        <EvidenceChip metric={m} label={label} onOpen={setMetric} />
      </div>
      <dd className="num mt-1 truncate text-[18px] text-ink">{value}</dd>
    </div>
  );
  return (
    <article id="library-detail" className="min-w-0 scroll-mt-4 rounded-lg border border-line bg-panel" aria-label={`${entry.mnemonic} evidence`}>
      <div className="border-b border-line px-4 py-3">
        <h2 className="num text-[18px] text-ink">{entry.mnemonic}</h2>
        <p className="mt-0.5 text-[13px] text-ink-2">{entry.title}</p>
      </div>
      <dl className="grid grid-cols-3 gap-3 border-b border-line px-4 py-3">
        {figure("Wall-clock", times(b.wallSpeedup), "wall_speedup")}
        {figure("Area", pct(b.areaPct), "area")}
        {figure("Cycles", int(b.cycles), "cycles")}
      </dl>
      <div className="border-b border-line">
        <EvidencePanel evidence={ev} artifacts={[]} onClear={() => setMetric(null)} compact />
      </div>
      <div className="px-4 py-3">
        <h3 className="text-[13px] text-ink-2">Specification (C reference)</h3>
        <pre className="scroll-quiet num mt-1.5 max-h-56 overflow-auto rounded-md bg-sunken p-3 text-[12px] leading-relaxed text-ink">{entry.semantics_c}</pre>
        <p className="num mt-2 text-[12px] text-ink-3">
          rs1 {entry.operands.rs1} · rs2 {entry.operands.rs2} · rd {entry.operands.rd}
        </p>
        {entry.rationale && <p className="mt-2 text-[13px] leading-snug text-ink-2">{entry.rationale}</p>}
        <p className="num mt-3 break-all text-[12px] text-ink-3">
          RTL text in the event log: {entry.rtlText ? (rtlHash ? `sha256 ${rtlHash}` : "hashing…") : "not present in the log"}
        </p>
        {entry.rtlText && <p className="mt-0.5 text-[11.5px] text-ink-3">Computed in your browser from the RTL text the run recorded; the engine&apos;s own artifact hashes are not in these replays.</p>}
      </div>
      <div className="border-t border-line px-4 py-3">
        <h3 className="text-[13px] text-ink-2">Proven in {entry.proofs.length} run node{entry.proofs.length === 1 ? "" : "s"}</h3>
        <ul className="mt-1.5 divide-y divide-line">
          {entry.proofs.map((p) => (
            <li key={`${p.runId}/${p.nodeId}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[12.5px]">
              <Link href={`/runs/${p.runId}?node=${p.nodeId}`} className="num min-w-0 truncate text-signal-ink underline-offset-2 hover:underline">
                {p.runId} · {p.nodeId}
              </Link>
              <span className="num text-ink-2">{times(p.wallSpeedup)}</span>
              <span className="num text-ink-3">{pct(p.areaPct)}</span>
              {p.onBestPath && <span className="rounded-full bg-signal-dim px-2 text-[11px] text-signal-ink">on the run&apos;s best path</span>}
              <span className="ml-auto">
                <Rungs rungs={p.rungs} />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-ink-3">L6, running on a real FPGA, was not run for any entry.</p>
      </div>
    </article>
  );
}

export function LibraryView({ runIds }: { runIds: string[] }) {
  const lib = useLibrary(runIds);
  const [sel, setSel] = useState<string | null>(null);
  const entries = lib.status === "ready" ? lib.entries : [];
  const selected = useMemo(() => entries.find((e) => e.mnemonic === sel) ?? entries[0] ?? null, [entries, sel]);

  if (lib.status === "loading")
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading the library">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 rounded-lg border border-line bg-panel" />
        ))}
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {lib.failed.length > 0 && (
        <p className="rounded-md bg-amber-dim px-3 py-2 text-[12.5px] text-amber" role="alert">
          {lib.failed.length} recorded run{lib.failed.length > 1 ? "s" : ""} could not be read ({lib.failed.join(", ")}). Entries found only in {lib.failed.length > 1 ? "them" : "it"} are missing from this list.
        </p>
      )}
      {entries.length === 0 ? (
        <section className="rounded-lg border border-line bg-panel p-5" role="status">
          <h2 className="text-[15px] font-medium text-ink">No verified instructions yet</h2>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-snug text-ink-3">An entry appears only when a recorded run proved it through lint, unit tests, the formal proof, the whole-workload check and synthesis.</p>
        </section>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] [&>*]:min-w-0">
          <section aria-label="Verified instructions">
            <p className="mb-2 text-[12.5px] text-ink-3">
              <span className="num text-ink-2">{entries.length}</span> instructions passed L1 to L5 in {runIds.length - lib.failed.length} recorded runs. Sorted by best wall-clock speedup of a CPU that uses them.
            </p>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
              {entries.map((e) => {
                const on = selected?.mnemonic === e.mnemonic;
                return (
                  <li key={e.mnemonic}>
                    <button type="button" onClick={() => {
                        setSel(e.mnemonic);
                        // On a narrow screen the detail sits below the list: bring it into view.
                        if (!window.matchMedia("(min-width: 1024px)").matches) document.getElementById("library-detail")?.scrollIntoView({ block: "start" });
                      }} aria-pressed={on} className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 text-left transition-colors duration-150 ${on ? "bg-raised" : "hover:bg-raised/60"}`}>
                      <span className="min-w-0">
                        <span className="num block truncate text-[14px] text-ink">{e.mnemonic}</span>
                        <span className="block truncate text-[12.5px] text-ink-3">{e.title}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="num text-[13px] text-signal-ink">{times(e.best.wallSpeedup)}</span>
                        <span className="num hidden text-[12px] text-ink-3 sm:inline">{pct(e.best.areaPct)}</span>
                        <span className="hidden md:inline-flex">
                          <Rungs rungs={e.best.rungs} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          {selected && <Detail entry={selected} states={lib.status === "ready" ? lib.states : {}} />}
        </div>
      )}
    </div>
  );
}
