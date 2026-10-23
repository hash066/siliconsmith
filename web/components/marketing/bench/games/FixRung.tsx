"use client";
import { useState } from "react";
import { toHref } from "@/lib/deeplink";
import { fmtOhms, FIX_START_OHMS, FIX_TEMPLATE, parseBus, PULLUP_CHOICES, rungOf, withPullups, type TemplateResponse } from "../data/board";
import { Btn, Chip, ErrorNote, EvidenceIds, LinkBtn, PlayLabel, Verdict, Waiting, useAction } from "../ui";
import { checkBoard, RungRow, useTemplate } from "./board-common";

export function FixRung() {
  const [remote, retry] = useTemplate(FIX_TEMPLATE);
  if (remote.state === "loading") return <Waiting>Fetching the template from the hosted engine</Waiting>;
  if (remote.state === "error") return <ErrorNote error={remote.error} onRetry={retry} />;
  return <Play tpl={remote.data} />;
}

function Play({ tpl }: { tpl: TemplateResponse }) {
  const [ohms, setOhms] = useState<number | null>(null);
  const [asked, setAsked] = useState<number | null>(null);
  const check = useAction((o: number, signal) => checkBoard(withPullups(tpl.design, o), signal));
  const cb = tpl.design.assumptions.i2c_cb_pf;
  const run = () => {
    if (ohms === null) return;
    setAsked(ohms);
    check.start(ohms);
  };
  const reset = () => {
    setOhms(null);
    setAsked(null);
    check.reset();
  };
  const ready = check.state.state === "ready" ? check.state.data : null;
  const b3 = ready ? rungOf(ready, "B3") : undefined;
  const bus = b3 ? parseBus(b3.findings?.find((f) => f.check === "I2C pull-ups")?.detail ?? b3.detail, b3.status === "pass") : [];
  const pass = b3?.status === "pass";
  const sample = bus[0];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <div>
          <PlayLabel>The situation</PlayLabel>
          <p className="text-sm leading-relaxed text-[var(--hw-ink-2)]">
            The I2C bus to the BME280 sensor now runs in <strong className="text-[var(--hw-ink)]">fast mode (400 kHz)</strong> with {cb} pF of bus capacitance. Both pull-ups (R1 on SDA, R2 on SCL) are {fmtOhms(FIX_START_OHMS)}, too large for fast-mode edges.
            Pick a replacement value for both.
          </p>
          <p className="mt-1 text-xs text-[var(--hw-ink-3)]">
            Real template {tpl.id}, with two edits by this game: bus mode set to fast, pull-ups set to your choice (shipped: standard mode, 4.7 k&#937;).
          </p>
        </div>
        <fieldset className="min-w-0">
          <legend className="hw-label mb-2">Pull-up resistor value</legend>
          <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
            {PULLUP_CHOICES.map((o) => (
              <label
                key={o}
                className={`block min-h-11 cursor-pointer rounded-[var(--hw-radius-sm)] border px-3 py-2.5 text-center text-sm motion-safe:transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--hw-steel)] ${ohms === o ? "border-[var(--hw-ember)] bg-[var(--hw-elevated)] text-[var(--hw-ink)]" : "border-[var(--hw-border)] text-[var(--hw-ink-2)] hover:border-[var(--hw-border-hover)]"}`}
              >
                <input type="radio" name="pullup" className="sr-only" checked={ohms === o} onChange={() => setOhms(o)} />
                <span className="hw-mono">{fmtOhms(o)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="hw-card p-4">
          <p className="hw-label">What happens next</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--hw-ink-2)]">Your value goes into the real design and the hosted B3 check computes rise time and the minimum resistance for this bus.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={ohms === null || check.state.state === "loading"} onClick={run}>
              Check answer
            </Btn>
            <Btn variant="ghost" onClick={reset}>
              Reset preview
            </Btn>
          </div>
        </div>
        {check.state.state === "idle" && <p className="text-sm text-[var(--hw-ink-3)]">{ohms === null ? "No value picked yet." : `${fmtOhms(ohms)} selected. Press Check answer.`}</p>}
        {check.state.state === "loading" && <Waiting>Running the real B3 check for {asked !== null ? fmtOhms(asked) : "your value"}</Waiting>}
        {check.state.state === "error" && <ErrorNote error={check.state.error} onRetry={run} />}
        {ready && b3 && (
          <>
            <Verdict
              tone={pass ? "ok" : "bad"}
              title={pass ? `${asked !== null ? fmtOhms(asked) : "That value"} passes B3 in fast mode.` : `${asked !== null ? fmtOhms(asked) : "That value"} fails B3.`}
            >
              {sample && sample.riseNs !== undefined && (
                <p>
                  Rise time {sample.riseNs} ns against the {sample.limitNs} ns fast-mode limit with {cb} pF{pass ? `; minimum allowed resistance ${sample.minRp} Ω.` : "."}
                </p>
              )}
              {sample && sample.riseNs === undefined && sample.minRp !== undefined && <p>That resistance is below the {sample.minRp} {"Ω"} minimum the bus needs at 3.3 V, so the line cannot be pulled low cleanly.</p>}
              <ul className="space-y-1">
                {bus.map((b) => (
                  <li key={b.line} className="hw-mono break-words text-[11px] text-[var(--hw-ink-3)]">
                    {b.text}
                  </li>
                ))}
              </ul>
              <EvidenceIds ids={(b3.findings?.find((f) => f.check === "I2C pull-ups")?.evidence ?? b3.evidence).slice(0, 8)} />
            </Verdict>
            <RungRow rungs={ready.rungs} />
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <LinkBtn href={toHref({ wb: "board", template: FIX_TEMPLATE })}>Open in the app</LinkBtn>
          <Chip>live checker</Chip>
        </div>
      </div>
    </div>
  );
}
