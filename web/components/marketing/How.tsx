import type { CSSProperties } from "react";
import type { Facts } from "@/lib/facts";
import { Icon } from "./icons";

export function How({ facts }: { facts: Facts }) {
  const steps = [
    { title: "Brief", text: "Say what you want: a faster loop, a board that boots, a plate that runs cooler.", chips: ["Silicon", "Board", "Matter"], color: "var(--hw-ember)" },
    { title: "Propose", text: "Nemotron agents draft designs. Many of them are wrong, and that is expected.", chips: [...facts.silicon.models].reverse().map((m) => m.replace("nemotron-", "Nemotron ")), color: "var(--hw-warn)" },
    { title: "Verify", text: "Deterministic checkers judge every draft, cheap checks first.", chips: ["Silicon L1 to L6", `Board ${facts.board.rungs[0]} to ${facts.board.rungs.at(-1)}`, "Matter M1 to M5"], color: "var(--hw-steel)" },
    { title: "Evidence", text: "Each pass or fail carries the rule, the source and what is not claimed.", chips: [facts.recorded.boardFault.evidenceId], color: "var(--hw-pcb)" },
    { title: "Export", text: "Keep what survived: RTL, netlist, pin header, STL, a pull request.", chips: ["RTL", "KiCad netlist", "STL", "Pull request"], color: "var(--hw-ok)" },
  ];
  return (
    <section id="how" className="mk-section mk-center" aria-labelledby="how-h">
      <div className="mk-wrap" style={{ maxWidth: 860 }}>
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-ok)" } as CSSProperties}>
          <Icon name="steps" size={14} /> How it works
        </span>
        <h2 id="how-h" className="hw-display mk-h2 mk-reveal">
          Five steps. <span className="mk-grad">No trust required.</span>
        </h2>
        <ol className="mk-steps" style={{ listStyle: "none", padding: 0, marginInline: 0 }}>
          {steps.map((s, i) => (
            <li key={s.title} className="mk-step mk-reveal" style={{ ["--c" as string]: s.color, ["--d" as string]: `${i * 60}ms` } as CSSProperties}>
              <span className="num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="mk-card mk-step-body">
                <h3>{s.title}</h3>
                <p>{s.text}</p>
                <div className="chips">
                  {s.chips.map((c) => (
                    <span key={c} className="mk-chip mk-chip-sm mk-mono" style={{ ["--chip" as string]: s.color, whiteSpace: "normal", overflowWrap: "anywhere", height: "auto", minHeight: 24, paddingBlock: 3 } as CSSProperties}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
