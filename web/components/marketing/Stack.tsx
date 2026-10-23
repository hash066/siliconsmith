"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "./icons";
import { useReducedMotion } from "./runtime";

const LAYERS: { icon: IconName; color: string; name: string; title: string; text: string; tech: string[] }[] = [
  { icon: "code", color: "var(--hw-ember)", name: "Interface", title: "The workstation", text: "Workbenches, canvas and agent in one window.", tech: ["Next.js", "React", "TypeScript", "Vercel"] },
  { icon: "chip", color: "var(--hw-warn)", name: "Agents", title: "Nemotron on Token Factory", text: "Ultra architects, Super builds, Nano triages.", tech: ["Nemotron Ultra", "Nemotron Super", "Nemotron Nano", "Nebius Token Factory"] },
  { icon: "shield", color: "var(--hw-steel)", name: "Verifiers", title: "Checkers the model cannot argue with", text: "Plain deterministic code decides what is true.", tech: ["Verilator", "Yosys", "SymbiYosys", "SciPy", "FEM solver", "Board rules"] },
  { icon: "box", color: "var(--hw-pcb)", name: "Isolation", title: "One sandbox per candidate", text: "Untrusted builds never share a workspace.", tech: ["Token Factory Sandboxes"] },
];

export function Stack() {
  const [prog, setProg] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = () => {
      const r = el.getBoundingClientRect();
      const k = (window.innerHeight * 0.65 - r.top) / r.height;
      setProg(Math.max(0, Math.min(1, k)));
    };
    f();
    window.addEventListener("scroll", f, { passive: true });
    window.addEventListener("resize", f);
    return () => {
      window.removeEventListener("scroll", f);
      window.removeEventListener("resize", f);
    };
  }, []);
  return (
    <section id="stack" className="mk-section mk-center" aria-labelledby="stack-h">
      <div className="mk-wrap" style={{ maxWidth: 900 }}>
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-steel)" } as CSSProperties}>
          <Icon name="layers" size={14} /> System architecture
        </span>
        <h2 id="stack-h" className="hw-display mk-h2 mk-reveal">
          Not just a stack. <span className="mk-grad">A proof engine in layers.</span>
        </h2>
        <p className="mk-sub mk-reveal">Every layer has one job: keep the model honest.</p>
        <div className="mk-layers" ref={ref}>
          <div className="mk-spine" aria-hidden="true">
            <i style={{ ["--prog" as string]: reduce ? 1 : prog } as CSSProperties} />
          </div>
          {LAYERS.map((l, i) => (
            <article key={l.name} className="mk-card mk-layer mk-reveal" style={{ ["--c" as string]: l.color } as CSSProperties}>
              <p className="hw-label">Layer {String(i + 1).padStart(2, "0")}</p>
              <h3>
                {l.name}: {l.title}
              </h3>
              <p>{l.text}</p>
              <div className="chips">
                {l.tech.map((t) => (
                  <span key={t} className="mk-tech" style={{ ["--c" as string]: l.color } as CSSProperties}>
                    {t}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
