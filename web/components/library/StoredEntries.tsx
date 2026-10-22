"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { int, mhz, pct, times } from "@/lib/format";
import { isEntryId, parseIndexIds, parseManifest, reproduceMatches, type LibraryManifest } from "@/lib/manifest";
import { CellGlyph } from "../domain/RungMatrix";

type State = { status: "loading" } | { status: "ready"; entries: LibraryManifest[]; invalid: string[] } | { status: "failed"; message: string };

function useManifests(): State {
  const [s, setS] = useState<State>({ status: "loading" });
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch("/library/index.json", { cache: "no-store" });
        if (res.status === 404) return !dead && setS({ status: "ready", entries: [], invalid: [] });
        if (!res.ok) throw new Error(`index answered ${res.status}`);
        const ids = parseIndexIds(await res.json());
        const entries: LibraryManifest[] = [];
        const invalid: string[] = [];
        await Promise.all(
          ids.map(async (id) => {
            try {
              const r = await fetch(`/library/${id}/manifest.json`, { cache: "no-store" });
              const m = r.ok ? parseManifest(await r.json()) : null;
              if (m && m.id === id) entries.push(m);
              else invalid.push(id);
            } catch {
              invalid.push(id);
            }
          }),
        );
        entries.sort((a, b) => a.id.localeCompare(b.id));
        if (!dead) setS({ status: "ready", entries, invalid });
      } catch (e) {
        if (!dead) setS({ status: "failed", message: e instanceof Error ? e.message : "unreadable" });
      }
    })();
    return () => {
      dead = true;
    };
  }, []);
  return s;
}

function CopyCommand({ text }: { text: string }) {
  const [done, setDone] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <div className="flex min-w-0 items-start gap-2">
      <code className="num min-w-0 flex-1 break-all rounded bg-sunken px-2.5 py-1.5 text-[12.5px] text-ink">{text}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone("ok");
          } catch {
            setDone("fail");
          }
          setTimeout(() => setDone("idle"), 1600);
        }}
        className="h-8 shrink-0 rounded-md border border-line-2 px-2.5 text-[12px] text-ink-2 hover:text-ink"
      >
        {done === "ok" ? "Copied" : done === "fail" ? "Copy failed" : "Copy"}
      </button>
    </div>
  );
}

function Entry({ m, open, onToggle }: { m: LibraryManifest; open: boolean; onToggle: () => void }) {
  const rungs = Object.entries(m.ladder);
  return (
    <li className="min-w-0 rounded-lg border border-line bg-panel">
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 text-left hover:bg-raised/60">
        <span className="min-w-0">
          <span className="num block truncate text-[14px] text-ink">{m.instruction.mnemonic}</span>
          <span className="block truncate text-[12.5px] text-ink-3">{m.title}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="num text-[13px] text-signal-ink">{m.metrics.speedup === null ? "—" : times(m.metrics.speedup)}</span>
          <span className="hidden items-center gap-1 sm:flex" aria-label={`Ladder: ${rungs.map(([k, v]) => `${k} ${v}`).join(", ")}`}>
            {rungs.map(([k, v]) => (
              <span key={k} className="flex flex-col items-center" title={`${k}: ${v === "skipped" ? "not run" : v}`}>
                <CellGlyph status={v === "pass" ? "pass" : v === "fail" ? "fail" : "unknown"} />
                <span className="num text-[9px] text-ink-3">{k}</span>
              </span>
            ))}
          </span>
        </span>
      </button>
      {open && (
        <div className="grid min-w-0 gap-4 border-t border-line px-4 py-4 text-[13px] leading-snug">
          <div>
            <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Reproduce</h3>
            {reproduceMatches(m) ? <CopyCommand text={m.reproduce} /> : <p className="text-amber">This manifest carries an unexpected command, so it is not shown.</p>}
            <p className="mt-1.5 text-[12px] text-ink-3">
              Re-runs lint, the random-vector test and the formal proof from the stored artifacts with no model, on a machine with the engine installed. <strong className="font-medium text-ink-2">This page does not run it</strong>, and nothing here claims it was re-run.
            </p>
          </div>

          <div className="grid min-w-0 gap-4 md:grid-cols-2 [&>*]:min-w-0">
            <div>
              <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">What the stored evidence claims</h3>
              <ul className="list-disc pl-4 text-ink-2">
                {m.claims.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
              <h3 className="mb-1.5 mt-3 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Not claimed</h3>
              <ul className="list-disc pl-4 text-ink-2">
                {m.not_claimed.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">System numbers</h3>
              <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
                <dt className="text-ink-3">Cycle speedup</dt>
                <dd>{m.metrics.speedup === null ? "—" : times(m.metrics.speedup, 3)}</dd>
                <dt className="text-ink-3">Area</dt>
                <dd>{m.metrics.area_delta_pct === null ? "—" : pct(m.metrics.area_delta_pct)}</dd>
                <dt className="text-ink-3">Cycles</dt>
                <dd>{int(m.metrics.cycles)}</dd>
                <dt className="text-ink-3">LUTs / FFs</dt>
                <dd>
                  {int(m.metrics.luts)} / {int(m.metrics.ffs)}
                </dd>
                <dt className="text-ink-3">Fmax</dt>
                <dd>{m.metrics.fmax_mhz === null ? "not measured" : `${mhz(m.metrics.fmax_mhz)} MHz`}</dd>
              </dl>
              {m.metrics.note && <p className="mt-1.5 text-[12px] text-ink-3">{m.metrics.note}</p>}
              <h3 className="mb-1.5 mt-3 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Source</h3>
              <p className="text-ink-2">
                <Link href={`/runs/${m.source.run_id}?node=${m.source.node_id}`} className="num text-signal-ink underline-offset-2 hover:underline">
                  {m.source.run_id} · {m.source.node_id}
                </Link>
                <span className="text-ink-3">
                  {" "}
                  · {m.source.workload} · {m.source.backend} · {m.source.created}
                </span>
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Tools and versions recorded</h3>
            <dl className="grid min-w-0 gap-1">
              {Object.entries(m.tools).map(([k, v]) => (
                <div key={k} className="grid min-w-0 grid-cols-[80px_minmax(0,1fr)] gap-3">
                  <dt className="num text-ink-3">{k}</dt>
                  <dd className="num break-words text-[12px] text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Artifacts (SHA-256 from the manifest)</h3>
            <ul className="divide-y divide-line">
              {m.artifacts.map((a) => (
                <li key={a.path} className="min-w-0 py-1.5 text-[12.5px]">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {isEntryId(m.id) && !a.path.includes("/") ? (
                      <a href={`/library/${m.id}/${a.path}`} className="num min-w-0 truncate text-signal-ink underline-offset-2 hover:underline">
                        {a.path}
                      </a>
                    ) : (
                      <span className="num min-w-0 truncate">{a.path}</span>
                    )}
                    <span className="num shrink-0 text-ink-3">{a.bytes.toLocaleString("en-US")} bytes</span>
                  </div>
                  <div className="num break-all text-[11.5px] text-ink-3">{a.sha256}</div>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[12px] text-ink-3">Some artifacts (for example the proof log) are listed in the manifest but not stored with the web build; open one only if its link works.</p>
          </div>
        </div>
      )}
    </li>
  );
}

/** Stored evidence entries: real manifests built from passing runs, each with its reproduce command (shown, never run here). */
export function StoredEntries() {
  const s = useManifests();
  const [open, setOpen] = useState<string | null>(null);
  if (s.status === "loading")
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading the evidence library">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 rounded-lg border border-line bg-panel" />
        ))}
      </div>
    );
  if (s.status === "failed")
    return (
      <p className="rounded-md bg-red-dim px-3 py-2 text-[13px] text-red" role="alert">
        The evidence library could not be read ({s.message}).
      </p>
    );
  return (
    <section aria-label="Stored evidence entries">
      <h2 className="text-[16px] font-semibold text-ink">Evidence entries</h2>
      <p className="mt-1 max-w-[70ch] text-[13px] leading-snug text-ink-3">Each entry is a stored bundle (spec, RTL, C reference) built from a passing run, with the tool versions and SHA-256 of every artifact. You can re-verify one offline with the command it shows.</p>
      {s.invalid.length > 0 && (
        <p className="mt-2 rounded-md bg-amber-dim px-3 py-2 text-[12.5px] text-amber" role="alert">
          {s.invalid.length} entr{s.invalid.length > 1 ? "ies" : "y"} could not be read or did not match the expected format ({s.invalid.join(", ")}) and {s.invalid.length > 1 ? "are" : "is"} not listed.
        </p>
      )}
      {s.entries.length === 0 ? (
        <div className="mt-3 rounded-lg border border-line bg-panel p-5" role="status">
          <h3 className="text-[14px] font-medium text-ink">No stored entries on this deployment</h3>
          <p className="mt-1 text-[13px] text-ink-3">An entry appears only after a passing run is built into the evidence library.</p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {s.entries.map((m) => (
            <Entry key={m.id} m={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}
