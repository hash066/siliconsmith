"use client";
import { useState } from "react";
import { toHref } from "@/lib/deeplink";
import { KERNEL_LINES } from "../data/kernel";
import { hotspotAt, scoreHunt, SILICON_RUN, type SiliconData } from "../data/silicon";
import { Btn, Chip, ErrorNote, LinkBtn, LineList, PlayLabel, Verdict, Waiting, pct, type LineItem, type Tone } from "../ui";
import { useSilicon } from "./silicon-source";

const idOf = (file: string, line: number) => `${file}:${line}`;

export function HotLoopHunt() {
  const [remote, retry] = useSilicon();
  if (remote.state === "loading") return <Waiting>Loading the recorded profile</Waiting>;
  if (remote.state === "error") return <ErrorNote error={remote.error} onRetry={retry} />;
  return <Play data={remote.data} />;
}

function Play({ data }: { data: SiliconData }) {
  const [sel, setSel] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const picked = sel ? KERNEL_LINES.find((l) => idOf(l.file, l.line) === sel) : undefined;
  const result = picked && checked ? scoreHunt(data.hotspots, picked.file, picked.line) : null;
  const sorted = [...data.hotspots].sort((a, b) => b.pct - a.pct);

  const items: LineItem[] = KERNEL_LINES.map((l) => {
    const h = checked ? hotspotAt(data.hotspots, l.file, l.line) : undefined;
    const isTop = h && h === result?.top;
    return {
      id: idOf(l.file, l.line),
      label: `${l.file} line ${l.line}: ${l.text || "blank"}`,
      mark: !checked ? undefined : isTop ? "hit" : h ? "other" : undefined,
      node: (
        <>
          <span className="w-9 shrink-0 select-none text-right text-[var(--hw-ink-3)]">{l.line}</span>
          <span className="min-w-0 whitespace-pre-wrap break-all">{l.text || " "}</span>
        </>
      ),
    };
  });
  // two files, one list each, so each keeps its own header and the arrow keys stay within a file
  const byFile = (f: string) => items.filter((_, i) => KERNEL_LINES[i].file === f);

  const tone: Tone = result?.grade === "top" ? "ok" : result?.grade === "other" ? "warn" : "bad";
  const reveal = () => setChecked(true);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <PlayLabel>Click the line that holds the most cycles</PlayLabel>
        <div className="space-y-3 rounded-[var(--hw-radius-sm)] border border-[var(--hw-border)] bg-[var(--hw-bg)] p-2">
          {(["tm_dot.h", "main.c"] as const).map((f) => (
            <div key={f}>
              <p className="hw-mono px-2 pb-1 text-[11px] text-[var(--hw-ink-3)]">{f}</p>
              <LineList items={byFile(f)} selected={sel} onSelect={(id) => { setSel(id); setChecked(false); }} label={`Source lines of ${f}`} />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--hw-ink-3)]">Real TinyMaix int8 fully-connected layer. Arrow keys move between lines.</p>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="hw-card p-4">
          <p className="hw-label">What happens next</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--hw-ink-2)]">Pick one source line. It is scored against the cycle profile the engine measured for this kernel, not against a guess.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={!picked || checked} onClick={reveal}>
              Check answer
            </Btn>
            <Btn variant="ghost" onClick={() => { setSel(null); setChecked(false); }}>
              Reset preview
            </Btn>
          </div>
        </div>

        {!checked && <p className="text-sm text-[var(--hw-ink-3)]">{picked ? `Selected ${picked.file} line ${picked.line}. Press Check answer.` : "No line picked yet."}</p>}

        {result && picked && (
          <>
            <Verdict
              tone={tone}
              title={result.grade === "top" ? `Yes: ${result.top.fn} holds ${pct(result.top.pct)} of the cycles.` : result.grade === "other" ? `Not quite: that line is in ${result.hit!.fn}, ${pct(result.hit!.pct)} of the cycles.` : "That line is not in any recorded hotspot."}
            >
              <p>
                {result.grade === "top"
                  ? `Lines ${result.top.lineStart}-${result.top.lineEnd} of ${result.top.file} are the unrolled multiply-accumulate: ${result.top.fetches.toLocaleString("en-US")} instruction fetches of the run.`
                  : `The hottest range is ${result.top.fn}, lines ${result.top.lineStart}-${result.top.lineEnd} of ${result.top.file}: ${pct(result.top.pct)} of the cycles (${result.top.fetches.toLocaleString("en-US")} fetches), highlighted in the code.`}
              </p>
              {result.grade === "none" && <p>The profile records {data.hotspots.length} ranges; a line outside all of them did not show up as a hotspot.</p>}
            </Verdict>
            <div>
              <PlayLabel>Profile of the baseline run, by function</PlayLabel>
              <ul className="space-y-2">
                {sorted.map((h) => (
                  <li key={h.fn} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="hw-mono min-w-0 break-words text-[var(--hw-ink)]">
                        {h.fn} <span className="text-[var(--hw-ink-3)]">{h.file}:{h.lineStart}-{h.lineEnd}</span>
                      </span>
                      <span className="hw-mono shrink-0 text-[var(--hw-ink-2)]">{pct(h.pct)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--hw-elevated)]" aria-hidden>
                      <div className="h-full rounded-full bg-[var(--hw-ember)]" style={{ width: `${Math.max(h.pct, 0.6)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <LinkBtn href={toHref({ wb: "silicon", run: SILICON_RUN })}>Open in the app</LinkBtn>
          <Chip>{data.baseline.cycles.toLocaleString("en-US")} baseline cycles</Chip>
        </div>
      </div>
    </div>
  );
}
