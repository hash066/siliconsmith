"use client";
// The Bench: five playable games on the landing page. Every fact in them comes from a recorded run or the hosted engine.
import { useRef, useState, type KeyboardEvent } from "react";
import { WORKBENCHES, type WorkbenchId } from "@/lib/brand";
import { FixRung } from "./games/FixRung";
import { HotLoopHunt } from "./games/HotLoopHunt";
import { PickInstruction } from "./games/PickInstruction";
import { ShapeSpreader } from "./games/ShapeSpreader";
import { SpotMismatch } from "./games/SpotMismatch";
import { Chip, FOCUS } from "./ui";

interface Mode {
  id: string;
  wb: WorkbenchId;
  kicker: string;
  title: string;
  blurb: string;
  source: "replay" | "live";
  Game: () => React.ReactNode;
}

const MODES: Mode[] = [
  { id: "pick", wb: "silicon", kicker: "Pick the instruction", title: "Which custom instruction wins?", blurb: "Six real proposals for the TinyMaix hot loop. Pick one, see what the verifiers measured.", source: "replay", Game: PickInstruction },
  { id: "mismatch", wb: "board", kicker: "Spot the mismatch", title: "Firmware vs netlist", blurb: "One pin disagrees between the C header and the board. Click it; the real checker rules.", source: "live", Game: SpotMismatch },
  { id: "spreader", wb: "matter", kicker: "Shape the spreader", title: "Fins against a hot chip", blurb: "Set fins, length and material. The validated solver says if you beat plain fins.", source: "live", Game: ShapeSpreader },
  { id: "hunt", wb: "silicon", kicker: "Hot-loop hunt", title: "Where do the cycles go?", blurb: "Click the line of the real kernel that holds the most cycles.", source: "replay", Game: HotLoopHunt },
  { id: "rung", wb: "board", kicker: "Fix the rung", title: "Too big a pull-up", blurb: "An I2C pull-up is too large for fast mode. Choose a value; the real B3 check answers.", source: "live", Game: FixRung },
];

const CHIPS = ["Five compact reps", "Real engines and real runs, no mock data", "Explanation first", "Mouse, touch and keyboard"];

export function Bench() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const mode = MODES[active];
  const accent = WORKBENCHES[mode.wb].accent;

  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % MODES.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i + MODES.length - 1) % MODES.length : e.key === "Home" ? 0 : e.key === "End" ? MODES.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    setActive(to);
    tabs.current[to]?.focus();
  };

  return (
    <section id="bench" aria-labelledby="bench-title" className="relative mx-auto w-full max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6">
      <header className="mx-auto max-w-3xl text-center">
        <p className="hw-label">Interactive</p>
        <h2 id="bench-title" className="hw-display mt-3 text-4xl sm:text-5xl">
          The <span className="hw-gradient-text">Bench</span>
        </h2>
        <p className="mt-4 text-base leading-relaxed text-[var(--hw-ink-2)] sm:text-lg">Five short games with the real thing behind them. Guess first, then watch the deterministic verifiers decide.</p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2">
          {CHIPS.map((c) => (
            <li key={c} className="hw-glass rounded-full px-3.5 py-1.5 text-xs text-[var(--hw-ink-2)]">
              {c}
            </li>
          ))}
        </ul>
      </header>

      <div role="tablist" aria-label="Bench games" className="mt-10 grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 lg:grid-cols-5">
        {MODES.map((m, i) => {
          const on = i === active;
          const c = WORKBENCHES[m.wb].accent;
          return (
            <button
              key={m.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              id={`bench-tab-${m.id}`}
              aria-selected={on}
              aria-controls="bench-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={`hw-card relative flex min-w-0 flex-col gap-2 p-4 text-left motion-safe:transition-[transform,border-color,background-color] motion-safe:duration-200 hover:border-[var(--hw-border-hover)] motion-safe:hover:-translate-y-0.5 ${FOCUS} ${on ? "bg-[var(--hw-elevated)]" : ""}`}
              style={on ? { borderColor: c, boxShadow: `0 0 0 1px ${c}` } : undefined}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="hw-label min-w-0 break-words" style={{ color: c }}>
                  {WORKBENCHES[m.wb].name}
                </span>
                <Chip>{m.source === "live" ? "Live engine" : "Recorded run"}</Chip>
              </span>
              <span className="text-base font-semibold leading-snug text-[var(--hw-ink)]">{m.kicker}</span>
              <span className="text-sm leading-snug text-[var(--hw-ink-3)]">{m.blurb}</span>
            </button>
          );
        })}
      </div>

      <div id="bench-panel" role="tabpanel" aria-labelledby={`bench-tab-${mode.id}`} className="hw-card mt-4 min-w-0 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--hw-border)] pb-4">
          <div className="min-w-0">
            <p className="hw-label" style={{ color: accent }}>
              Active mode · {WORKBENCHES[mode.wb].name}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-[var(--hw-ink)] sm:text-2xl">{mode.title}</h3>
          </div>
          <Chip>{mode.source === "live" ? "Hosted engine, live" : "Recorded run, real data"}</Chip>
        </div>
        <div className="mt-5 min-w-0" key={mode.id}>
          <mode.Game />
        </div>
      </div>
    </section>
  );
}
