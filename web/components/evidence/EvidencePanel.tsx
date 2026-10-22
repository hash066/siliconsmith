"use client";

import { useState } from "react";
import type { EvidenceRef } from "@/lib/evidence";
import type { ArtifactRecord } from "@/lib/run-state";

function Row({ k, children, wide = false }: { k: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`${wide ? "lg:col-span-2 " : ""}border-b border-line last:border-b-0 grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3 py-1.5 sm:grid-cols-[104px_minmax(0,1fr)]`}>
      <dt className="text-[12px] text-ink-3">{k}</dt>
      <dd className="min-w-0 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone("copied");
    } catch {
      setDone("failed");
    }
    setTimeout(() => setDone("idle"), 1600);
  };
  return (
    <button type="button" onClick={copy} className="h-7 shrink-0 rounded-md border border-line-2 px-2 text-[12px] text-ink-2 transition-colors hover:text-ink">
      {done === "copied" ? "Copied" : done === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

/** The evidence drawer's body: everything that stands behind one number, from the event stream only. */
export function EvidencePanel({ evidence, artifacts, onClear }: { evidence: EvidenceRef | null; artifacts: ArtifactRecord[]; onClear: () => void }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
      <div className="min-w-0">
        {evidence ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 text-[13px] text-ink-2">
                {evidence.label} <span className="num text-[15px] text-ink">{evidence.value}</span>
              </h3>
              <button type="button" onClick={onClear} className="h-7 rounded-md px-2 text-[12px] text-ink-3 hover:text-ink">
                Clear
              </button>
            </div>
            <dl className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-x-6 lg:grid-cols-2">
              <Row k="Tool">{evidence.tool}</Row>
              <Row k="Version">{evidence.version ?? <span className="text-ink-3">Not recorded in this run&apos;s event log</span>}</Row>
              <Row k="Run">
                <span className="num">{evidence.runId}</span>
              </Row>
              <Row k="Node">
                <a href={evidence.runHref} className="num text-signal-ink underline-offset-2 hover:underline">
                  {evidence.nodeId}
                </a>
                <span className="text-ink-3"> · event seq </span>
                <span className="num">{evidence.seqs.join(", ")}</span>
              </Row>
              <Row k="Basis">{evidence.basis}</Row>
              <Row k="Reproduce" wide>
                {evidence.command ? (
                  <div className="flex min-w-0 items-start gap-2">
                    <code className="num min-w-0 flex-1 break-all rounded bg-sunken px-2 py-1 text-[12px] leading-snug text-ink">{evidence.command}</code>
                    <CopyButton text={evidence.command} />
                  </div>
                ) : (
                  <span className="text-ink-3">This stream does not carry enough to build a command</span>
                )}
                <p className="mt-1 text-[12px] text-ink-3">Repeats the search with the same settings. The agent is stochastic, so the numbers can differ.</p>
              </Row>
              <Row k="Record">{evidence.replayPath ? <span className="num break-all">{evidence.replayPath}</span> : <span className="text-ink-3">Live run: no replay file</span>}</Row>
            </dl>
          </>
        ) : (
          <div className="py-2">
            <h3 className="text-[13px] font-medium text-ink">No number selected</h3>
            <p className="mt-1 max-w-[56ch] text-[13px] leading-snug text-ink-3">
              Pick an <span className="font-mono text-[11px] uppercase tracking-[0.08em]">ev</span> tag next to a number to see the tool, run, node and command behind it.
            </p>
          </div>
        )}
      </div>
      <div className="min-w-0 border-line lg:border-l lg:pl-4">
        <h3 className="text-[13px] text-ink-2">Artifacts</h3>
        {artifacts.length === 0 ? (
          <p className="mt-1 text-[13px] leading-snug text-ink-3">This run&apos;s stream records no artifact files, so there are no hashes to show.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {artifacts.map((a) => (
              <li key={a.seq} className="min-w-0 py-1.5 text-[12px]">
                <div className="truncate text-ink">
                  {a.kind} · <span className="num">{a.path}</span>
                </div>
                <div className="num break-all text-ink-3">sha256 {a.sha256}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
