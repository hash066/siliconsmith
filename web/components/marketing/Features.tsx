"use client";
import { useState, type CSSProperties } from "react";
import type { Facts } from "@/lib/facts";
import { Icon, type IconName } from "./icons";

export function Features({ facts }: { facts: Facts }) {
  const [open, setOpen] = useState<number | null>(null);
  const { silicon, board, matter, library } = facts;
  const cards: { icon: IconName; color: string; title: string; text: string; more: string }[] = [
    { icon: "shield", color: "var(--hw-ok)", title: "Verification ladders", text: "Cheap checks first, strict ones last. Unknown never counts as pass.", more: `Silicon runs L1 to L6, Board ${board.rungs[0]} to ${board.rungs.at(-1)}, Matter ${matter.rungs[0]} to ${matter.rungs.at(-1)}. A skipped rung is shown as skipped.` },
    { icon: "code", color: "var(--hw-steel)", title: "Custom RISC-V instructions", text: "The agent invents an instruction for your hot loop and builds the CPU.", more: `Best recorded: ${(silicon.best.wallSpeedup ?? silicon.best.speedup).toFixed(2)}× wall-clock in run ${silicon.best.id}, ${silicon.best.mnemonics.join(" + ")}.` },
    { icon: "scale", color: "var(--hw-steel)", title: "Formal equivalence", text: "A solver proves the RTL equals its spec for every input.", more: "A Yosys SAT miter checks every input of a stored instruction against an independent spec." },
    { icon: "board", color: "var(--hw-pcb)", title: "Board vs firmware", text: "Pins, voltages, buses and strapping pins checked against part facts.", more: `${board.faultsDetected} of ${board.faultsCatalogued} catalogued faults are detected, plus ${board.structuralFaults} structural ones. Netlist level only: no layout, no EMC.` },
    { icon: "heat", color: "var(--hw-ember)", title: "Heat on a validated solver", text: "A spreader is simulated, then confirmed by a second solver.", more: `Agent beat the equal-material baseline in ${matter.agentBeatsBaseline.wins} of ${matter.agentBeatsBaseline.of} runs. Solver validation: ${matter.solverValidation}.` },
    { icon: "chip", color: "var(--hw-warn)", title: "Nemotron, and only Nemotron", text: "Ultra, Super and Nano each get the job they fit.", more: `The recorded runs made ${silicon.llmCalls} model calls across ${silicon.models.length} Nemotron tiers on Nebius Token Factory.` },
    { icon: "box", color: "var(--hw-steel)", title: "Isolated sandboxes", text: "Every candidate is built and tested in its own workspace.", more: `${silicon.candidates} candidates were each built apart, so one bad draft cannot touch another.` },
    { icon: "file", color: "var(--hw-pcb)", title: "Evidence on every claim", text: "Rule, source and what is not claimed, one click away.", more: `A personal library of verified instructions backs this: ${library.entries.length} entries, each with a reproduce command.` },
    { icon: "git", color: "var(--hw-ok)", title: "Artifacts you can use", text: "Verilog, a KiCad netlist, a pin header, an STL, a pull request.", more: "Exports are written only for a passing design." },
  ];
  return (
    <section id="features" className="mk-section mk-center" aria-labelledby="features-h">
      <div className="mk-wrap">
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-steel)" } as CSSProperties}>
          <Icon name="grid" size={14} /> Capabilities
        </span>
        <h2 id="features-h" className="hw-display mk-h2 mk-reveal">
          Everything you need to <span className="mk-grad">trust a design</span>
        </h2>
        <div className="mk-feats">
          {cards.map((c, i) => (
            <article key={c.title} className="mk-card mk-feat mk-reveal" style={{ ["--c" as string]: c.color, ["--d" as string]: `${(i % 3) * 80}ms` } as CSSProperties}>
              <span className="n mk-mono" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="mk-tile-ico" style={{ ["--c" as string]: c.color } as CSSProperties}>
                <Icon name={c.icon} size={22} />
              </span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
              <button type="button" className="mk-more" aria-expanded={open === i} aria-controls={`feat-${i}`} onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? "Less" : "Learn more"} <Icon name="arrow" size={14} />
              </button>
              <div id={`feat-${i}`} className="mk-feat-detail" data-open={open === i ? 1 : 0}>
                <div>
                  <p>{c.more}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
