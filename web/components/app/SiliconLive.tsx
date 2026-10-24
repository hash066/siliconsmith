"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { STAGES } from "@/lib/events";
import type { NodeState, RunState } from "@/lib/run-state";
import { usd } from "@/lib/format";
import { CellGlyph } from "../domain/RungMatrix";
import { SILICON_STAGE_WORDS } from "./verdict";
import { RUN_CAP, WORKLOADS, type SiliconLive, type Workload } from "./useSiliconLive";
import { btnGhost, btnPrimary } from "./ui";
import { Ledger } from "./Ledger";
import { BeforeAfter, HardwareView, ProofExplainer, WaveView } from "./SiliconViews";
import { AgentsPanel, TestPlan } from "./SiliconStudio";
import { parseViews } from "@/lib/silicon-views";
import { siliconLedger } from "@/lib/ledger";

/** The node that carries the one proposed instruction: the best scored one, else the latest with a proposal. */
export function mainNode(s: RunState): NodeState | null {
  if (s.best && s.nodes[s.best]?.proposal) return s.nodes[s.best];
  for (let i = s.order.length - 1; i >= 0; i--) {
    const n = s.nodes[s.order[i]];
    if (n?.proposal) return n;
  }
  return null;
}

function Elapsed({ since, running }: { since: number | null; running: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!since) return null;
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span className="num">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

function StageList({ node, running }: { node: NodeState | null; running: boolean }) {
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Proof stages">
      {STAGES.map((st) => {
        const rec = node?.stages[st];
        const status = rec?.status ?? "queued";
        const glyph = status === "pass" ? "pass" : status === "fail" ? "fail" : status === "running" ? "running" : status === "skipped" ? "unknown" : "pending";
        return (
          <li key={st} data-stage={st} data-status={status} className="flex min-w-0 items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2">
            <CellGlyph status={glyph} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{SILICON_STAGE_WORDS[st] ?? st}</span>
            <span className="shrink-0 text-[11.5px] text-ink-3">{status === "pass" ? "done" : status === "fail" ? "failed" : status === "running" ? "running" : status === "skipped" ? "skipped" : running ? "waiting" : "not run"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Picker({ live, blocked }: { live: SiliconLive; blocked: string | null }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-5">
      <div>
        <h3 className="text-[17px] font-semibold text-ink">Make a loop faster with a new instruction</h3>
        <p className="mt-1 text-[13px] leading-snug text-ink-2">Pick a real kernel. The agent proposes one custom RISC-V instruction, writes the hardware, and the verifiers prove it and count the cycles, live.</p>
      </div>
      <div role="radiogroup" aria-label="Kernel" className="flex flex-col gap-2">
        {(Object.keys(WORKLOADS) as Workload[]).map((w) => (
          <button key={w} type="button" role="radio" aria-checked={live.workload === w} onClick={() => live.setWorkload(w)} data-testid={`kernel-${w}`} className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${live.workload === w ? "border-signal-line bg-raised" : "border-line hover:bg-raised/60"}`}>
            <span className="block text-[13.5px] font-medium text-ink">{WORKLOADS[w].title}</span>
            <span className="block text-[12px] text-ink-3">{WORKLOADS[w].blurb}</span>
          </button>
        ))}
      </div>
      <div>
        <button type="button" onClick={() => void live.start(live.workload)} disabled={!!blocked} className={btnPrimary} data-testid="silicon-run-live">
          Run it live
        </button>
        <p className="mt-2 text-[12px] leading-snug text-ink-3">{blocked ?? `Uses demo credits: up to about $${RUN_CAP.usd.toFixed(2)} and ${RUN_CAP.minutes} minutes. You can stop at any time.`}</p>
      </div>
    </div>
  );
}

export function SiliconLivePreview({ live, tab, blocked, recordedHref }: { live: SiliconLive; tab: "preview" | "proof"; blocked: string | null; recordedHref: string }) {
  const { phase, run, error } = live;
  const node = mainNode(run);
  const fileText = (test: (p: string) => boolean) => live.files.find((f) => test(f.path))?.text;
  const views = useMemo(() => parseViews(fileText((p) => p === "views/instruction.json")), [live.files]); // eslint-disable-line react-hooks/exhaustive-deps
  const original = fileText((p) => p.startsWith("src/original/"));
  const patched = fileText((p) => p.startsWith("src/") && !p.startsWith("src/original/"));
  const running = phase === "running";
  if (tab === "proof") {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[12.5px] leading-snug text-ink-2">Every proposed instruction has to pass all of these before it counts. Proved means true for every possible input, not just the ones we tried.</p>
        {phase === "idle" ? <p className="rounded-lg border border-line bg-panel px-3 py-4 text-[13px] text-ink-3" role="status">Nothing has run yet.</p> : <StageList node={node} running={running} />}
        {phase !== "idle" && <Ledger rows={siliconLedger(node, run.toolVersions)} />}
        <ProofExplainer />
        <p className="mt-1 text-[12.5px] text-ink-3">
          Want to see a long, full search instead of one candidate?{" "}
          <Link href={recordedHref} className="text-signal-ink underline underline-offset-2" data-testid="recorded-link">
            See a full recorded search
          </Link>{" "}
          (a 19 minute recording of a real run, opens its own page).
        </p>
      </div>
    );
  }
  if (phase === "idle") return <Picker live={live} blocked={blocked} />;
  const score = node?.score ?? null;
  const prop = node?.proposal ?? null;
  return (
    <div className="@container flex min-w-0 flex-col gap-4 p-4" aria-live="polite" data-phase={phase}>
      <section aria-label="The instruction" className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="hw-label !text-[10.5px]">The new instruction</h3>
          <span className="text-[11.5px] text-ink-3">
            {running ? "Live · " : ""}
            <Elapsed since={live.startedAt} running={running} />
            {run.usage.total.costUsd > 0 ? ` · ${usd(run.usage.total.costUsd)} so far` : ""}
          </span>
        </div>
        {prop ? (
          <>
            <p className="num mt-2 text-[22px] leading-tight text-ink">{prop.mnemonic}</p>
            <p className="mt-0.5 text-[13.5px] text-ink-2">{prop.title}</p>
            {prop.rationale && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-ink-3">{prop.rationale}</p>}
          </>
        ) : (
          <p className="mt-3 text-[13.5px] text-ink-3" role="status">
            {running ? "The agent is reading the kernel and choosing an instruction…" : "No instruction was proposed."}
          </p>
        )}
      </section>

      <AgentsPanel run={run} phase={phase} />

      <section aria-label="Proof stages" className="flex flex-col gap-2">
        <h3 className="hw-label !text-[10.5px]">Proving it</h3>
        <StageList node={node} running={running} />
      </section>

      <dl aria-label="Measured result" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px] [&>div]:bg-panel [&>div]:px-3 [&>div]:py-2.5">
        <div>
          <dt className="text-[11.5px] text-ink-3">Faster by (cycles)</dt>
          <dd className="num text-[22px] leading-tight text-ink">{score && Number.isFinite(score.speedup) ? `${score.speedup.toFixed(2)}×` : running ? "…" : "n/a"}</dd>
        </div>
        <div>
          <dt className="text-[11.5px] text-ink-3">Chip area</dt>
          <dd className="num text-[22px] leading-tight text-ink">{score && Number.isFinite(score.area_delta_pct) ? `${score.area_delta_pct >= 0 ? "+" : ""}${score.area_delta_pct.toFixed(1)}%` : running ? "…" : "n/a"}</dd>
        </div>
      </dl>
      <p className="text-[11.5px] leading-snug text-ink-3">Cycle count measured on the simulated core. Clock speed was not measured, so this is not a wall-clock claim.</p>
      {views && <HardwareView views={views} />}
      {views && views.rows.length > 0 && <WaveView views={views} />}
      {views && views.rows.length > 0 && prop && <TestPlan views={views} mnemonic={prop.mnemonic} />}
      {original && patched && prop && <BeforeAfter before={original} after={patched} mnemonic={prop.mnemonic} />}

      {error && (
        <p className="rounded-lg border border-red/40 bg-red-dim px-3 py-2 text-[12.5px] leading-snug text-ink" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {running ? (
          <button type="button" onClick={live.stop} className={btnGhost} data-testid="silicon-stop">
            Stop
          </button>
        ) : (
          <button type="button" onClick={live.reset} className={btnGhost} data-testid="silicon-again">
            Run another
          </button>
        )}
      </div>
    </div>
  );
}
