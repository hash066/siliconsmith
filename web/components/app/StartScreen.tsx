"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { BRAND, WORKBENCHES } from "@/lib/brand";
import { ThemeToggle } from "../site/Brand";
import type { CreditsView } from "./credits";
import { CreditsPill, Mark } from "./CreditsPill";
import { EXAMPLES, resolveWorkbench, type Chip, type Example } from "./route";
import { IconArrowUp, WB_ICON } from "./ui";

const CHIPS: Array<[Chip, string]> = [["auto", "Auto"], ["matter", "Matter"], ["board", "Board"], ["silicon", "Silicon"]];

export interface StartPick {
  text: string;
  chip: Chip;
  example?: Example;
}

/** Screen 1: one question, one box, three real examples. No sidebar, no tour over a dense UI. */
export function StartScreen({ credits, onStart, initialChip = "auto", leading }: { credits: CreditsView; onStart: (p: StartPick) => void; initialChip?: Chip; leading?: ReactNode }) {
  const [text, setText] = useState("");
  const [chip, setChip] = useState<Chip>(initialChip);
  const area = useRef<HTMLTextAreaElement>(null);
  const hint = text.trim() ? resolveWorkbench(text, chip) : null;
  const submit = () => {
    const t = text.trim();
    if (t) onStart({ text: t, chip });
  };
  return (
    <div className="hw-app hw-grid-bg flex min-h-dvh flex-col" data-wb={hint?.wb ?? "matter"} data-testid="start">
      <header className="flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6">
        {leading}
        <Link href="/" className="flex items-center gap-2 text-ink" aria-label={`${BRAND.name} home`}>
          <Mark />
          <span className="hw-display text-[15px]">{BRAND.name}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/#how" className="hidden h-9 items-center rounded-lg px-3 text-[13px] text-ink-2 hover:text-ink sm:flex">
            How it works
          </Link>
          <CreditsPill credits={credits} />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center justify-center px-4 pb-16 pt-4 sm:px-6">
        <h1 className="hw-display text-center text-[clamp(28px,6vw,48px)]">
          What do you want to <span className="hw-gradient-text">make</span>?
        </h1>
        <p className="mt-3 text-center text-[14.5px] text-ink-2">Describe it in plain words. Checkers the AI cannot argue with decide what is true.</p>
        <form
          className="mt-7 w-full rounded-2xl border border-line bg-panel p-2 shadow-[var(--hw-shadow)] focus-within:border-[var(--wb)]"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="start-prompt" className="sr-only">
            What do you want to make?
          </label>
          <textarea
            id="start-prompt"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            maxLength={1000}
            placeholder="A heat sink for a 5 W chip, a sensor board, a faster loop…"
            className="block w-full resize-none rounded-xl bg-transparent px-3 py-2.5 text-[15px] leading-snug text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <div className="flex items-center gap-2 px-1 pb-1">
            <div role="radiogroup" aria-label="Workbench" className="flex min-w-0 flex-wrap gap-1">
              {CHIPS.map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={chip === id} onClick={() => setChip(id)} data-testid={`chip-${id}`} className={`h-8 rounded-full border px-3 text-[12.5px] transition-colors ${chip === id ? "border-signal-line bg-raised text-ink" : "border-line text-ink-3 hover:text-ink"}`}>
                  {label}
                </button>
              ))}
            </div>
            <button type="submit" disabled={!text.trim()} aria-label="Start" data-testid="start-send" className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-signal text-on-signal transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35">
              <IconArrowUp />
            </button>
          </div>
        </form>
        <p className="mt-2 h-4 text-[12px] text-ink-3" aria-live="polite">
          {hint ? (hint.picked === "chip" ? `Using ${WORKBENCHES[hint.wb].name}.` : hint.picked === "wording" ? `Picked ${WORKBENCHES[hint.wb].name} from your wording. You can change it next.` : `No clear match, starting with ${WORKBENCHES[hint.wb].name}. You can change it next.`) : ""}
        </p>

        <section aria-label="Examples" className="mt-6 grid w-full grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
          {EXAMPLES.map((ex) => {
            const Icon = WB_ICON[ex.wb];
            return (
              <button key={ex.id} type="button" onClick={() => onStart({ text: ex.prompt, chip: ex.wb, example: ex })} data-testid={`example-${ex.id}`} className="group flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-panel p-3.5 text-left transition-colors hover:border-line-2 hover:bg-raised">
                <span className="flex items-center gap-2 text-[12px]" style={{ color: WORKBENCHES[ex.wb].accent }}>
                  <Icon size={16} />
                  {ex.title}
                </span>
                <span className="line-clamp-3 text-[13px] leading-snug text-ink-2 group-hover:text-ink">{ex.prompt}</span>
              </button>
            );
          })}
        </section>
        <p className="mt-6 text-center text-[11.5px] leading-snug text-ink-3">Demo credits, not money. Board checks and Matter simulations are free and never use AI credits.</p>
      </main>
    </div>
  );
}
