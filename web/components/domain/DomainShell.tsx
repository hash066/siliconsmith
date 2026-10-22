"use client";

import { PlayerControls, Scrubber } from "../run/Player";
import type { RunController, Snapshot } from "@/lib/controller";
import { sha8 } from "@/lib/format";
import type { ArtifactRecord } from "@/lib/run-state";

export function Panel({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel ${className}`} aria-label={title}>
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <h3 className="text-[13px] font-medium text-ink">{title}</h3>
        {aside}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** Title, one-line finding, the honest-limits notice and the replay controls, shared by the Board and Matter canvases. */
export function DomainHeader({ title, sub, finding, notice, c, snap }: { title: string; sub: string; finding: string; notice: string; c: RunController; snap: Snapshot }) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold leading-tight tracking-[-0.015em] text-ink">{title}</h2>
          <p className="mt-1 text-[13px] text-ink-3">{sub}</p>
        </div>
        <p className="max-w-[560px] text-[14px] leading-snug text-ink xl:text-right" aria-live="polite">
          {finding}
        </p>
      </div>
      <p className="rounded-md border border-line bg-sunken px-3 py-2 text-[12.5px] leading-snug text-ink-2" role="note">
        {notice}
      </p>
      <div className="flex flex-col gap-2">
        <PlayerControls c={c} snap={snap} />
        <Scrubber c={c} snap={snap} />
      </div>
    </>
  );
}

export function ArtifactList({ artifacts }: { artifacts: ArtifactRecord[] }) {
  if (!artifacts.length)
    return <p className="px-4 py-3 text-[13px] text-ink-3">No artifact files recorded yet. Artifacts are listed once the run records them, with their SHA-256.</p>;
  return (
    <ul className="divide-y divide-line">
      {artifacts.map((a) => (
        <li key={a.seq} className="min-w-0 px-4 py-2 text-[12.5px]">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 rounded-[3px] border border-line-2 px-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-2">{a.kind}</span>
            <span className="num min-w-0 truncate text-ink" title={a.path}>
              {a.path.split("/").pop()}
            </span>
            {a.nodeId && <span className="num shrink-0 text-ink-3">{a.nodeId}</span>}
          </div>
          <div className="num mt-0.5 truncate text-[11.5px] text-ink-3" title={a.sha256}>
            sha256 {sha8(a.sha256)}…
          </div>
        </li>
      ))}
    </ul>
  );
}
