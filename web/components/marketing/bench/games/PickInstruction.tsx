"use client";
import { useMemo, useState } from "react";
import { toHref } from "@/lib/deeplink";
import { linesOf } from "../data/kernel";
import { gradePick, rankCandidates, SILICON_RUN, topHotspot, type Candidate, type SiliconData } from "../data/silicon";
import { Btn, Chip, ErrorNote, LinkBtn, PlayLabel, Verdict, Waiting, pct, x2, type Tone } from "../ui";
import { useSilicon } from "./silicon-source";

const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();

function outcomeText(c: Candidate): string {
  if (c.outcome.kind === "scored") return `verified, ${x2(c.outcome.speedup)}, +${c.outcome.areaDeltaPct}% area`;
  if (c.outcome.kind === "pruned") return "pruned";
  return "no recorded outcome";
}

export function PickInstruction() {
  const [remote, retry] = useSilicon();
  if (remote.state === "loading") return <Waiting>Loading the recorded run {SILICON_RUN}</Waiting>;
  if (remote.state === "error") return <ErrorNote error={remote.error} onRetry={retry} />;
  return <Play data={remote.data} />;
}

function Play({ data }: { data: SiliconData }) {
  const [pick, setPick] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const top = topHotspot(data.hotspots);
  const loop = linesOf(top.file as "tm_dot.h", top.lineStart, top.lineEnd);
  const chosen = data.candidates.find((c) => c.nodeId === pick) ?? null;
  const winner = data.candidates.find((c) => c.onWinningLine);
  const ranked = useMemo(() => rankCandidates(data.candidates), [data.candidates]);
  const grade = chosen ? gradePick(chosen) : null;

  const tone: Tone = grade === "winner" ? "ok" : grade === "verified" ? "warn" : "bad";
  let title = "";
  if (chosen && grade) {
    title =
      grade === "winner" ? `Yes: ${chosen.mnemonic} won this run.` : grade === "verified" ? `${chosen.mnemonic} worked, but it was not the winner.` : grade === "pruned" ? `${chosen.mnemonic} was pruned.` : `${chosen.mnemonic} has no recorded outcome.`;
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <div>
          <PlayLabel>
            The hot loop · {top.fn} · {pct(top.pct)} of {data.baseline.cycles.toLocaleString("en-US")} baseline cycles
          </PlayLabel>
          <pre className="hw-mono overflow-x-auto rounded-[var(--hw-radius-sm)] border border-[var(--hw-border)] bg-[var(--hw-bg)] p-3 text-[12px] leading-5 text-[var(--hw-ink-2)]" tabIndex={0} aria-label={`Source of ${top.fn}, lines ${top.lineStart} to ${top.lineEnd} of ${top.file}`}>
            {loop.map((l) => `${String(l.line).padStart(3)}  ${l.text}`).join("\n")}
          </pre>
          <p className="mt-1 text-xs text-[var(--hw-ink-3)]">
            Real TinyMaix kernel ({top.file}, lines {top.lineStart}-{top.lineEnd}), profiled on a PicoRV32 core.
          </p>
        </div>
        <fieldset className="min-w-0">
          <legend className="hw-label mb-2">The agent proposed {data.candidates.length} instructions. Which one wins?</legend>
          <div className="grid grid-cols-1 gap-2 min-[520px]:grid-cols-2">
            {data.candidates.map((c) => {
              const on = pick === c.nodeId;
              return (
                <label
                  key={c.nodeId}
                  className={`relative block min-w-0 cursor-pointer rounded-[var(--hw-radius-sm)] border p-3 motion-safe:transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--hw-steel)] ${on ? "border-[var(--hw-ember)] bg-[var(--hw-elevated)]" : "border-[var(--hw-border)] hover:border-[var(--hw-border-hover)]"}`}
                >
                  <input type="radio" name="pick-instruction" className="sr-only" checked={on} onChange={() => { setPick(c.nodeId); setChecked(false); }} />
                  <span className="hw-mono block break-words text-sm font-semibold text-[var(--hw-ink)]">{c.mnemonic}</span>
                  <span className="mt-1 block text-xs leading-snug text-[var(--hw-ink-2)]">{c.title}</span>
                  <span className="hw-mono mt-2 block text-[10px] uppercase tracking-wider text-[var(--hw-ink-3)]">
                    {checked ? outcomeText(c) : c.estSpeedup ? `agent's own estimate ${c.estSpeedup}x` : "no estimate"}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="hw-card p-4">
          <p className="hw-label">What happens next</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--hw-ink-2)]">Pick the instruction you think survives the verifiers and scores best. Then see what the recorded run actually measured.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={!chosen || checked} onClick={() => setChecked(true)}>
              Check answer
            </Btn>
            <Btn variant="ghost" onClick={() => { setPick(null); setChecked(false); }}>
              Reset preview
            </Btn>
          </div>
        </div>

        {!checked && <p className="text-sm text-[var(--hw-ink-3)]">{chosen ? `Selected ${chosen.mnemonic}. Press Check answer.` : "Nothing picked yet."}</p>}

        {checked && chosen && (
          <>
            <Verdict tone={tone} title={title}>
              {chosen.outcome.kind === "scored" && (
                <p>
                  Measured on the real core: {x2(chosen.outcome.speedup)} faster ({chosen.outcome.cycles.toLocaleString("en-US")} cycles vs {data.baseline.cycles.toLocaleString("en-US")}), {chosen.outcome.areaDeltaPct}% more area, all verification rungs passed.
                  {chosen.estSpeedup ? ` The agent had estimated ${chosen.estSpeedup}x.` : ""}
                  {chosen.bestDescendant ? ` Polishing it reached ${x2(chosen.bestDescendant.speedup)} (${chosen.bestDescendant.nodeId}).` : ""}
                </p>
              )}
              {chosen.outcome.kind === "pruned" && (
                <>
                  <p>{chosen.outcome.short}</p>
                  <p className="hw-mono break-words text-[11px] text-[var(--hw-ink-3)]">{chosen.outcome.reason.split("\n")[0].slice(0, 220)}</p>
                </>
              )}
              {grade === "winner" && <p>Why: {firstSentence(chosen.rationale)}</p>}
              {grade !== "winner" && winner && (
                <p>
                  The winner was {winner.mnemonic}
                  {winner.outcome.kind === "scored" ? `: ${x2(winner.outcome.speedup)} at +${winner.outcome.areaDeltaPct}% area` : ""}
                  {winner.bestDescendant ? `, ${x2(winner.bestDescendant.speedup)} after polish` : ""}.
                </p>
              )}
            </Verdict>
            <div>
              <PlayLabel>All six, as the run recorded them (run {data.runId})</PlayLabel>
              <ul className="space-y-1 text-sm">
                {ranked.map((c) => (
                  <li key={c.nodeId} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-[var(--hw-border)] py-1">
                    <span className="hw-mono min-w-0 break-words text-[var(--hw-ink)]">{c.mnemonic}{c.nodeId === chosen.nodeId ? " (yours)" : ""}</span>
                    <span className="shrink-0 text-xs text-[var(--hw-ink-3)]">{c.outcome.kind === "scored" ? `${x2(c.outcome.speedup)} · +${c.outcome.areaDeltaPct}%` : c.outcome.kind}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <LinkBtn href={toHref({ wb: "silicon", run: SILICON_RUN })}>Open in the app</LinkBtn>
          <Chip raw>run {data.runId}</Chip>
        </div>
      </div>
    </div>
  );
}
