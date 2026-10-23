import type { CSSProperties } from "react";
import type { Facts } from "@/lib/facts";
import { Icon, type IconName } from "./icons";
import { Counter } from "./runtime";

type Tile = { icon: IconName; color: string; value: number; decimals?: number; prefix?: string; title: string; text: string };

export function Problem({ facts }: { facts: Facts }) {
  const { silicon, board, matter } = facts;
  const tiles: Tile[] = [
    { icon: "x", color: "var(--hw-bad)", value: silicon.rejected, title: "Candidates rejected", text: `of ${silicon.candidates} proposed CPUs never made it past the ladder.` },
    { icon: "alert", color: "var(--hw-warn)", value: silicon.failedCorrectness, title: "Failed a hard check", text: "candidates broke a compile, test or proof stage." },
    { icon: "board", color: "var(--hw-pcb)", value: board.proposeJudgedDesigns, title: "Board drafts judged", text: "before one passed all five rungs. The first ones did not." },
    { icon: "heat", color: "var(--hw-ember)", value: matter.marginK, decimals: 2, prefix: "+", title: "Kelvin of real gain", text: "best margin over the baseline. Small wins, said plainly." },
  ];
  return (
    <section id="problem" className="mk-section mk-center" aria-labelledby="problem-h">
      <div className="mk-bgfx" aria-hidden="true">
        <div className="mk-glow" style={{ width: 520, height: 520, right: "-10%", top: "30%", background: "var(--hw-bad)", opacity: 0.12 }} />
      </div>
      <div className="mk-wrap" style={{ position: "relative" }}>
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-bad)" } as CSSProperties}>
          <Icon name="alert" size={14} /> The problem
        </span>
        <h2 id="problem-h" className="hw-display mk-h2 mk-reveal">
          Models state hardware facts with <span className="mk-bad">confidence.</span>
        </h2>
        <p className="mk-sub mk-reveal">Confident is not correct. These are the real numbers from our runs.</p>
        <div className="mk-tiles">
          {tiles.map((t, i) => (
            <article key={t.title} className="mk-card mk-tile mk-reveal" style={{ ["--c" as string]: t.color, ["--d" as string]: `${i * 90}ms` } as CSSProperties}>
              <span className="mk-tile-ico">
                <Icon name={t.icon} size={22} />
              </span>
              <span className="mk-tile-num" aria-hidden="true">
                <Counter to={t.value} decimals={t.decimals} prefix={t.prefix} />
              </span>
              <h3>
                <span className="sr-only">{t.decimals ? `${t.prefix ?? ""}${t.value.toFixed(t.decimals)}` : t.value} </span>
                {t.title}
              </h3>
              <p>{t.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
