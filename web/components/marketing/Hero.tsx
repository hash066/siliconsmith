"use client";
import Link from "next/link";
import { useEffect, useRef, type CSSProperties } from "react";
import { BRAND } from "@/lib/brand";
import { Icon } from "./icons";
import { Counter, useReducedMotion } from "./runtime";

export interface HeroProps {
  rtlName: string;
  rtl: string;
  ladder: { passed: number; total: number; skipped: string[] };
  board: { template: string; passed: number; of: number; failedRung: string };
  matter: { peakC: number; baselineC: number };
  stats: { value: number; decimals: number; prefix?: string; suffix?: string; label: string }[];
}

const KW = /\b(module|endmodule|input|output|wire|assign|signed)\b/g;
function Hl({ line }: { line: string }) {
  const parts = line.split(KW);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}
      {"\n"}
    </>
  );
}

function Plate({ peak }: { peak: number }) {
  // Decorative thumbnail of a finned spreader on a chip hot spot. Not a simulation result: the numbers beside it are.
  return (
    <svg viewBox="0 0 200 110" width="100%" role="img" aria-label={`Heat spreader thumbnail, peak ${peak.toFixed(2)} degrees Celsius`}>
      <defs>
        <radialGradient id="mk-heat" cx="50%" cy="50%" r="60%">
          <stop offset="0" stopColor="#ff6b5e" />
          <stop offset="0.35" stopColor="#ff7a3d" />
          <stop offset="0.7" stopColor="#f2c14e" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5b8def" stopOpacity="0.35" />
        </radialGradient>
      </defs>
      <rect x="6" y="6" width="188" height="98" rx="10" fill="url(#mk-heat)" opacity="0.9" />
      {Array.from({ length: 9 }).map((_, i) => (
        <rect key={i} x={20 + i * 19} y="14" width="5" height="82" rx="2.5" fill="var(--hw-bg)" opacity="0.55" />
      ))}
      <rect x="78" y="38" width="44" height="34" rx="6" fill="var(--hw-bg)" opacity="0.85" />
      <rect x="86" y="46" width="28" height="18" rx="3" fill="#ff6b5e" />
    </svg>
  );
}

export function Hero({ rtlName, rtl, ladder, board, matter, stats }: HeroProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const code = rtl.split("\n").slice(0, 11);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduce) return;
    const layers = [...root.querySelectorAll<HTMLElement>("[data-depth]")];
    let mx = 0;
    let my = 0;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const sy = Math.min(window.scrollY, 900);
      for (const el of layers) {
        const d = Number(el.dataset.depth);
        el.style.transform = `translate3d(${mx * d * 26}px, ${my * d * 18 - sy * d * 0.14}px, 0)`;
      }
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const move = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
      queue();
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", queue, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", queue);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  const rungs = ["B1", "B2", "B3", "B4", "B5"];

  return (
    <section id="top" className="mk-hero" aria-label="Hardwright">
      <div className="mk-bgfx" aria-hidden="true">
        <div className="hw-grid-bg" style={{ position: "absolute", inset: 0, maskImage: "linear-gradient(#000 40%, transparent)", WebkitMaskImage: "linear-gradient(#000 40%, transparent)" }} />
        <div className="mk-glow" style={{ width: 560, height: 560, right: "-8%", top: "4%", background: "var(--hw-ember)" }} />
        <div className="mk-glow" style={{ width: 460, height: 460, left: "-12%", bottom: "-8%", background: "var(--hw-steel)", opacity: 0.16 }} />
      </div>
      <div className="mk-wrap" ref={rootRef} style={{ position: "relative", width: "100%" }}>
        <div className="mk-hero-grid">
          <div style={{ minWidth: 0 }}>
            <span className="mk-chip mk-eyebrow mk-reveal">
              <Icon name="zap" size={14} /> Agents + verifiers
            </span>
            <h1 className="hw-display mk-h1 mk-reveal" style={{ ["--d" as string]: "80ms" } as CSSProperties}>
              Design
              <br />
              hardware.
              <br />
              <span className="mk-grad">Prove it.</span>
            </h1>
            <p className="mk-sub mk-reveal" style={{ ["--d" as string]: "200ms" } as CSSProperties}>
              {BRAND.sub}
            </p>
            <div className="mk-reveal" style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 12, ["--d" as string]: "300ms" } as CSSProperties}>
              <Link href="/app" className="mk-btn mk-btn-primary">
                Launch App <Icon name="arrow" size={16} />
              </Link>
              <a href="#demo" className="mk-btn">
                <Icon name="play" size={14} /> Watch a recorded session
              </a>
            </div>
            <dl className="mk-stats mk-reveal" style={{ ["--d" as string]: "400ms" } as CSSProperties}>
              {stats.map((s) => (
                <div className="mk-stat" key={s.label}>
                  <dd style={{ margin: 0 }}>
                    <b>
                      <Counter to={s.value} decimals={s.decimals} prefix={s.prefix} suffix={s.suffix} />
                    </b>
                  </dd>
                  <dt>{s.label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div className="mk-hero-cards" aria-label="Examples of what the verifiers decide">
            <div data-depth="0.9" className="mk-par" style={{ top: 0, right: 0, width: "min(100%, 380px)" }}>
              <div className="mk-glass mk-fcard mk-float" style={{ ["--fd" as string]: "0s" } as CSSProperties}>
                <div className="mk-fcard-head">
                  <span className="mk-dots" aria-hidden="true">
                    <i style={{ background: "#ff6b5e" }} />
                    <i style={{ background: "#f2c14e" }} />
                    <i style={{ background: "#7bd88f" }} />
                  </span>
                  <span className="mk-mono">{rtlName}</span>
                  <span className="mk-chip mk-chip-sm" style={{ ["--chip" as string]: "var(--hw-ok)", marginLeft: "auto" } as CSSProperties}>
                    <Icon name="check" size={12} /> {ladder.passed} of {ladder.total} rungs pass
                  </span>
                </div>
                <pre className="mk-code mk-mono" aria-label={`Stored RTL of ${rtlName}`}>
                  {code.map((l, i) => (
                    <Hl key={i} line={l} />
                  ))}
                </pre>
              </div>
            </div>

            <div data-depth="1.5" className="mk-par" style={{ top: 250, left: 0, width: "min(100%, 250px)" }}>
              <div className="mk-glass mk-fcard mk-float" style={{ ["--fd" as string]: "-2.2s", padding: 16 } as CSSProperties}>
                <p className="hw-label" style={{ color: "var(--hw-pcb)" }}>
                  Board check
                </p>
                <p className="mk-mono" style={{ marginTop: 6, fontSize: 12.5, color: "var(--hw-ink-2)", overflowWrap: "anywhere" }}>
                  {board.template}
                </p>
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {rungs.map((r) => (
                    <span key={r} className="mk-rung mk-mono" data-s={r === board.failedRung ? "fail" : "pass"}>
                      {r === board.failedRung ? <Icon name="x" size={12} /> : <Icon name="check" size={12} />}
                      {r}
                    </span>
                  ))}
                </div>
                <p style={{ marginTop: 12, fontSize: 13, color: "var(--hw-ink-2)" }}>
                  {board.passed} of {board.of} pass. Firmware and netlist disagree on a pin.
                </p>
              </div>
            </div>

            <div data-depth="0.5" className="mk-par" style={{ top: 360, right: 0, width: "min(100%, 230px)" }}>
              <div className="mk-glass mk-fcard mk-float" style={{ ["--fd" as string]: "-4.4s", padding: 14 } as CSSProperties}>
                <p className="hw-label" style={{ color: "var(--hw-ember)" }}>
                  Matter · heat spreader
                </p>
                <div style={{ marginTop: 8 }}>
                  <Plate peak={matter.peakC} />
                </div>
                <p className="mk-mono" style={{ marginTop: 8, fontSize: 12, color: "var(--hw-ink-2)" }}>
                  {matter.peakC.toFixed(2)} °C, baseline {matter.baselineC.toFixed(2)} °C
                </p>
              </div>
            </div>
          </div>
        </div>
        <a href="#problem" className="mk-scroll" style={{ display: "flex", margin: "36px auto 0", width: "fit-content" }}>
          <i aria-hidden="true" />
          Scroll to explore
        </a>
      </div>
    </section>
  );
}
