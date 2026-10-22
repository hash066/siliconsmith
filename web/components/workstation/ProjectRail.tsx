"use client";

import Link from "next/link";
import type { RunState } from "@/lib/run-state";

export interface RunIndexEntry {
  id: string;
  title: string;
  backend: string;
  /** From the replay's own run.started (absent = silicon). */
  domain: string;
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-b-0" aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const Roadmap = () => <span className="rounded-full border border-line-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">Roadmap</span>;

/** Left rail: Intent, Runs, Library, Templates. Intent and Runs are real; Library and Templates are honest empty states. */
export function ProjectRail({ runs, runId, onPickRun, state }: { runs: RunIndexEntry[]; runId: string; onPickRun: (id: string) => void; state: RunState | null }) {
  const w = state?.workload;
  const hot = state?.baseline?.hotspots[0];
  const repo = w?.source_repo?.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  return (
    <nav aria-label="Project" className="flex min-w-0 flex-col">
      <Section title="Intent">
        {w ? (
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-1.5 text-[13px]">
            <dt className="sr-only">Workload</dt>
            <dd className="break-words text-ink">{w.title}</dd>
            {(repo || w.source_path) && (
              <>
                <dt className="sr-only">Source</dt>
                <dd className="num break-all text-[12px] text-ink-3">{[repo, w.source_path].filter(Boolean).join(" · ")}</dd>
              </>
            )}
            {state?.domain === "silicon" && hot && (
              <>
                <dt className="sr-only">Hot spot</dt>
                <dd className="text-[12px] text-ink-3">
                  Hot spot <span className="num text-ink-2">{hot.symbol}</span> · {hot.pct.toFixed(1)}% of cycles
                </dd>
              </>
            )}
            {state?.domain === "silicon" && state?.config && (
              <>
                <dt className="sr-only">Budget</dt>
                <dd className="text-[12px] text-ink-3">Area budget {state.config.area_budget_pct.toFixed(1)}% LUT-eq</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-[13px] text-ink-3">Reading the run&apos;s first events…</p>
        )}
      </Section>

      <Section title="Runs" aside={<span className="num text-[12px] text-ink-3">{runs.length} recorded</span>}>
        <ul className="-mx-2 flex flex-col">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPickRun(r.id)}
                aria-current={r.id === runId ? "true" : undefined}
                className={`block w-full min-w-0 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ${r.id === runId ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised/60 hover:text-ink"}`}
              >
                <span className="num block truncate text-[12.5px]">{r.id}</span>
                <span className="block truncate text-[12px] text-ink-3">
                  {r.domain} · {r.title} · {r.backend}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-snug text-ink-3">Recorded replays of real engine runs.</p>
      </Section>

      <Section title="Library">
        <Link href="/workstation/library" className="text-[13px] text-signal-ink underline-offset-2 hover:underline">
          Verified instructions
        </Link>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">Every instruction that passed the whole ladder in a recorded run, with its evidence.</p>
      </Section>

      <Section title="Templates">
        <Link href="/workstation/templates" className="text-[13px] text-signal-ink underline-offset-2 hover:underline">
          Templates
        </Link>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">Starting points that link to a recorded run.</p>
      </Section>
    </nav>
  );
}
