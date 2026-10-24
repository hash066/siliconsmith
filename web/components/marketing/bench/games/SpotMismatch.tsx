"use client";
import { useMemo, useState } from "react";
import { toHref } from "@/lib/deeplink";
import { describeError } from "../api";
import { failedEvidence, findMismatches, gradeSpot, headerLines, MISMATCH_TEMPLATE, netLines, rungOf, type TemplateResponse } from "../data/board";
import { Btn, Chip, ErrorNote, EvidenceIds, LineList, LinkBtn, PlayLabel, Verdict, Waiting, useAction, type LineItem } from "../ui";
import { checkBoard, RungRow, useTemplate } from "./board-common";

export function SpotMismatch() {
  const [remote, retry] = useTemplate(MISMATCH_TEMPLATE);
  if (remote.state === "loading") return <Waiting>Fetching the template from the hosted engine</Waiting>;
  if (remote.state === "error") return <ErrorNote error={remote.error} onRetry={retry} />;
  return <Play tpl={remote.data} />;
}

function Play({ tpl }: { tpl: TemplateResponse }) {
  const header = useMemo(() => headerLines(tpl.header), [tpl.header]);
  const nets = useMemo(() => netLines(tpl.design), [tpl.design]);
  const mismatches = useMemo(() => findMismatches(header, nets), [header, nets]);
  const [sel, setSel] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const check = useAction((_: string, signal) => checkBoard(tpl.design, signal));
  const grade = asked ? gradeSpot(asked, mismatches) : null;
  const done = check.state.state === "ready" || check.state.state === "error";
  const m = mismatches[0];

  const mark = (id: string) => (done && m?.rowIds.includes(id) ? "hit" : done && id === asked ? "wrong" : undefined);
  const hItems: LineItem[] = header.map((h) => ({ id: h.id, label: `Firmware header: ${h.text}`, mark: mark(h.id), node: <span className="min-w-0 break-all">{h.text}</span> }));
  const nItems: LineItem[] = nets.map((n) => ({ id: n.id, label: `Netlist net ${n.net}: ${n.text.replace(/\s+/g, " ")}`, mark: mark(n.id), node: <span className="min-w-0 whitespace-pre-wrap break-all">{n.text}</span> }));

  const run = () => {
    if (!sel) return;
    setAsked(sel);
    check.start(sel);
  };
  const reset = () => {
    setSel(null);
    setAsked(null);
    check.reset();
  };

  const b4 = check.state.state === "ready" ? rungOf(check.state.data, "B4") : undefined;
  const found = grade === "found";

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <PlayLabel>Firmware says one thing, the board says another. Click the wrong line.</PlayLabel>
        <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2">
          <div className="min-w-0 rounded-[var(--hw-radius-sm)] border border-[var(--hw-border)] bg-[var(--hw-bg)] p-2">
            <p className="hw-mono px-2 pb-1 text-[11px] text-[var(--hw-ink-3)]">firmware pin header (C)</p>
            <LineList items={hItems} selected={sel} onSelect={(id) => { setSel(id); }} label="Firmware pin header lines" disabled={check.state.state === "loading"} />
          </div>
          <div className="min-w-0 rounded-[var(--hw-radius-sm)] border border-[var(--hw-border)] bg-[var(--hw-bg)] p-2">
            <p className="hw-mono px-2 pb-1 text-[11px] text-[var(--hw-ink-3)]">netlist: net, then its pins</p>
            <LineList items={nItems} selected={sel} onSelect={(id) => { setSel(id); }} label="Netlist lines" disabled={check.state.state === "loading"} />
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--hw-ink-3)]">Real template {tpl.id}: {tpl.title}. Arrow keys move within a list.</p>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="hw-card p-4">
          <p className="hw-label">What happens next</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--hw-ink-2)]">Pick the line you think is wrong. The hosted checker then runs its five rungs on this exact design and has the final say.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={!sel || check.state.state === "loading"} onClick={run}>
              Check answer
            </Btn>
            <Btn variant="ghost" onClick={reset}>
              Reset preview
            </Btn>
          </div>
        </div>

        {check.state.state === "idle" && <p className="text-sm text-[var(--hw-ink-3)]">{sel ? "Line selected. Press Check answer." : "No line picked yet."}</p>}
        {check.state.state === "loading" && <Waiting>Running the real B1 to B5 checks</Waiting>}
        {check.state.state === "error" && (
          <>
            <Verdict tone={found ? "ok" : "warn"} title={found ? "That is the line, by a local comparison." : "That is not the mismatched line, by a local comparison."}>
              {m && <p>The firmware header puts {m.fn} on GPIO{m.firmwarePin}; the netlist wires it to {m.netlistPin}.</p>}
              <p>The hosted checker could not confirm it: {describeError(check.state.error)}</p>
            </Verdict>
            <Btn variant="ghost" onClick={run}>
              Try the check again
            </Btn>
          </>
        )}
        {check.state.state === "ready" && b4 && (
          <>
            <Verdict tone={b4.status === "fail" && found ? "ok" : b4.status === "fail" ? "warn" : "info"} title={found ? "Found it. The real checker agrees: rung B4 fails." : b4.status === "fail" ? "Not that line, but the checker does fail B4 on this design." : "The checker did not fail B4 for this design."}>
              <p>
                {m ? `Firmware says GPIO${m.firmwarePin} for ${m.fn}; the netlist wires ${m.netlistPin}. ` : ""}
                Checker, B4 ({b4.label ?? "Firmware matches the netlist"}): {b4.detail}
              </p>
              <EvidenceIds ids={failedEvidence(b4)} />
            </Verdict>
            <RungRow rungs={check.state.data.rungs} />
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <LinkBtn href={toHref({ wb: "board", template: MISMATCH_TEMPLATE })}>Open in the app</LinkBtn>
          <Chip>live checker</Chip>
        </div>
      </div>
    </div>
  );
}
