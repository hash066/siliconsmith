"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReplayOptions } from "@/lib/controller";
import { buildEvidence, type EvidenceMetric, type EvidenceRef } from "@/lib/evidence";
import { useMediaQuery, useRunSource, useSnapshot } from "@/lib/hooks";
import { initialRunState } from "@/lib/run-state";
import { RunCanvas, useRunFocus } from "../run/RunConsole";
import { Block, btnPrimary, ScopeRow } from "./ui";

export interface RunIndexEntry {
  id: string;
  title: string;
  backend: string;
  domain: string;
}

/** The recorded Silicon runs shown in the app. Other domains' replays (if any are installed) belong to their own workbench. */
export const SILICON_RUNS = ["r_w1_contree3", "r_w1_final", "r_w2_final3", "r_w1_v3", "r_m4_second"] as const;
export const DEFAULT_RUN = SILICON_RUNS[0];
const EMPTY = initialRunState();

function replayOptions(): ReplayOptions {
  if (typeof window === "undefined") return { autoplay: true, speed: 8, start: 0 };
  const q = new URLSearchParams(window.location.search);
  const t = q.get("t");
  const speed = Number(q.get("speed"));
  return { autoplay: t !== "end", speed: [1, 2, 4, 8, 16].includes(speed) ? speed : 8, start: t === "end" ? "end" : t && Number.isFinite(Number(t)) ? Number(t) * 1000 : 0 };
}

export function useSiliconBench(runId: string) {
  const [opts] = useState(replayOptions);
  const src = useRunSource(runId, opts);
  const controller = src.status === "ready" ? src.controller : null;
  const snap = useSnapshot(controller);
  const s = snap?.state ?? EMPTY;
  const wide = useMediaQuery("(min-width: 1024px)");
  const focus = useRunFocus(s, { wide, initialNode: null, syncUrl: false });
  const verified = useMemo(() => Object.values(s.nodes).filter((n) => n.parentId !== null && n.score?.feasible).length, [s.nodes]);
  return { runId, src, controller, snap, s, focus, verified };
}
export type SiliconBench = ReturnType<typeof useSiliconBench>;

export function SiliconScope() {
  return (
    <ScopeRow summary="Recorded replays of real engine runs; nothing re-runs in your browser">
      <ul className="list-disc space-y-1 pl-4">
        <li>These are recordings of real SiliconSmith engine runs, replayed event by event. Nothing is re-simulated in your browser, and the Agent does not start new Silicon runs here.</li>
        <li>Every number is what the engine recorded for that one workload. It is not a claim about other code, and the evidence chip shows how to reproduce it.</li>
        <li>A candidate counts as verified only after it passes the whole ladder; faster candidates with an incomplete proof are shown as not eligible.</li>
      </ul>
    </ScopeRow>
  );
}

export function SiliconInputs({ runs, b, onPick }: { runs: RunIndexEntry[]; b: SiliconBench; onPick: (id: string) => void }) {
  const w = b.s.workload;
  const hot = b.s.baseline?.hotspots[0];
  const repo = w?.source_repo?.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  return (
    <div className="flex min-h-full flex-col gap-3 p-3">
      <Block title="Brief: the workload" data-step="brief" tabIndex={-1}>
        <div className="p-3 text-[13px]">
          {w ? (
            <dl className="grid grid-cols-[minmax(0,1fr)] gap-1">
              <dt className="sr-only">Workload</dt>
              <dd className="break-words text-ink">{w.title}</dd>
              {(repo || w.source_path) && (
                <>
                  <dt className="sr-only">Source</dt>
                  <dd className="num break-all text-[11.5px] text-ink-3">{[repo, w.source_path].filter(Boolean).join(" · ")}</dd>
                </>
              )}
              {hot && (
                <>
                  <dt className="sr-only">Hot spot</dt>
                  <dd className="text-[12px] text-ink-3">
                    Hot spot <span className="num text-ink-2">{hot.symbol}</span> · {hot.pct.toFixed(1)}% of cycles
                  </dd>
                </>
              )}
              {b.s.config && (
                <>
                  <dt className="sr-only">Budget</dt>
                  <dd className="text-[12px] text-ink-3">Area budget {b.s.config.area_budget_pct.toFixed(1)}% LUT-eq</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-ink-3" role="status">
              Reading the run&apos;s first events…
            </p>
          )}
        </div>
      </Block>
      <Block title="Recorded runs" aside={<span className="num text-[11px] text-ink-3">{runs.length} real</span>}>
        {runs.length === 0 ? (
          <p className="p-3 text-[13px] text-ink-3" role="status">
            No recorded runs are installed in this deployment.
          </p>
        ) : (
          <ul className="flex flex-col p-1.5">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r.id)}
                  aria-current={r.id === b.runId ? "true" : undefined}
                  data-testid={`run-${r.id}`}
                  className={`block w-full min-w-0 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 ${r.id === b.runId ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised/60 hover:text-ink"}`}
                >
                  <span className="num block truncate text-[12.5px]">{r.id}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">
                    {r.title} · {r.backend}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <SiliconScope />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading the run">
      <div className="h-6 w-2/3 animate-pulse rounded bg-raised" />
      <div className="h-20 animate-pulse rounded-lg bg-raised" />
      <div className="h-72 animate-pulse rounded-lg bg-raised" />
    </div>
  );
}

export function SiliconCanvasView({ b, onEvidence }: { b: SiliconBench; onEvidence: (r: EvidenceRef) => void }) {
  const { src, snap, controller, s, focus, runId } = b;
  const openMetric = (metric: EvidenceMetric) => {
    if (!s.best) return;
    const e = buildEvidence(s, s.best, metric, snap?.mode ?? "replay");
    if (e) onEvidence(e);
  };
  if (src.status === "loading") return <Skeleton />;
  if (src.status === "not-found")
    return (
      <section className="m-4 max-w-md" role="alert">
        <h2 className="text-[16px] font-semibold text-ink">Run {runId} is not available</h2>
        <p className="mt-1.5 text-[13px] text-ink-2">{src.reason}</p>
      </section>
    );
  if (!snap || !controller) return <Skeleton />;
  return (
    <div className="flex min-w-0 flex-col gap-3 p-3" data-step="verify" tabIndex={-1}>
      <RunCanvas embedded c={controller} snap={snap} focus={focus} reportHref={`/runs/${runId}/report`} onEvidence={openMetric} />
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2" data-step="export" tabIndex={-1}>
        <span className="hw-label !text-[10.5px]">Export</span>
        <span className="text-[12.5px] text-ink-3">{s.status === "completed" ? "The full report with every claim and its evidence." : "The report is available once the replay completes."}</span>
        <Link href={`/runs/${runId}/report`} className={`${btnPrimary} ml-auto !h-8 ${s.status === "completed" ? "" : "pointer-events-none opacity-40"}`} aria-disabled={s.status !== "completed"}>
          Open the report
        </Link>
      </div>
    </div>
  );
}
