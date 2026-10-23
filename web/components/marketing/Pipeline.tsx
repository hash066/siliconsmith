"use client";
import { useState, type CSSProperties } from "react";
import type { Facts } from "@/lib/facts";
import { Icon, type IconName } from "./icons";
import { Counter } from "./runtime";

export function Pipeline({ facts }: { facts: Facts }) {
  const { silicon, board } = facts;
  const nodes: { icon: IconName; color: string; title: string; text: string; detail: string }[] = [
    { icon: "intent", color: "var(--hw-ember)", title: "Intent", text: "Your brief", detail: "A plain request. Assumptions you state are enforced, never overwritten by the model." },
    { icon: "bulb", color: "var(--hw-warn)", title: "Agent proposes", text: "Nemotron drafts", detail: `${silicon.candidates} candidate CPUs were drafted across ${silicon.runs.length} recorded runs. Most were wrong.` },
    { icon: "shield", color: "var(--hw-steel)", title: "Ladder", text: "Verifiers judge", detail: `${silicon.rejected} were rejected, ${silicon.verified} survived. Board and Matter have their own ladders.` },
    { icon: "file", color: "var(--hw-pcb)", title: "Evidence", text: "Why it passed", detail: `Each result cites its source, like ${facts.recorded.boardFault.evidenceId}.` },
    { icon: "box", color: "var(--hw-ok)", title: "Artifacts", text: "RTL, netlist, STL", detail: `Written only for a passing design. A Board design needs all ${board.rungs.length} rungs.` },
  ];
  const [sel, setSel] = useState(2);
  return (
    <section id="pipeline" className="mk-section mk-center" aria-labelledby="pipe-h">
      <div className="mk-wrap">
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-pcb)" } as CSSProperties}>
          <Icon name="flow" size={14} /> The pipeline
        </span>
        <h2 id="pipe-h" className="hw-display mk-h2 mk-reveal">
          From a sentence to a <span className="mk-grad">proven part</span>
        </h2>
        <p className="mk-sub mk-reveal">Tap a stage. The numbers are from the recorded runs.</p>
        <div className="mk-pipe mk-reveal" role="group" aria-label="Pipeline stages">
          {nodes.map((n, i) => (
            <div className="mk-pipe-cell" key={n.title}>
              <button type="button" className="mk-node" style={{ ["--c" as string]: n.color } as CSSProperties} aria-pressed={sel === i} onClick={() => setSel(i)}>
                <span className="ico">
                  <Icon name={n.icon} size={20} />
                </span>
                <h3>{n.title}</h3>
                <p>{n.text}</p>
              </button>
              {i < nodes.length - 1 && <span className="mk-edge" style={{ ["--d" as string]: `${i * 0.5}s` } as CSSProperties} aria-hidden="true" />}
            </div>
          ))}
        </div>
        <p className="mk-pipe-note" role="status" aria-live="polite">
          <strong style={{ color: nodes[sel].color }}>{nodes[sel].title}.</strong> {nodes[sel].detail}
        </p>
        <div className="mk-trio mk-reveal">
          <div>
            <b>
              <Counter to={silicon.candidates} />
            </b>
            <span>candidates proposed</span>
          </div>
          <div>
            <b className="mk-bad">
              <Counter to={silicon.rejected} />
            </b>
            <span>rejected</span>
          </div>
          <div>
            <b style={{ color: "var(--hw-ok)" }}>
              <Counter to={silicon.verified} />
            </b>
            <span>survived the ladder</span>
          </div>
        </div>
      </div>
    </section>
  );
}
