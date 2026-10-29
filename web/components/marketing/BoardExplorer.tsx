"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { bodyOf, lookOf } from "@/lib/board3d";
import { presentRefs, STOPS, tiltOf } from "@/lib/board-explorer";
import type { BoardGeometry } from "@/lib/layout";
import { Icon } from "./icons";
import { useReducedMotion } from "./runtime";

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** A real routed board you can explore: pick a part, see what it does. The picture is the board KiCad routed and checked. */
export function BoardExplorer() {
  const [geom, setGeom] = useState<BoardGeometry | null>(null);
  const [stats, setStats] = useState<{ added: number; tracks: number; routed: boolean; drcErrors: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState(0);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const reduce = useReducedMotion();

  useEffect(() => {
    let dead = false;
    fetch("/boards/clean_sensor/board.json")
      .then((r) => (r.ok ? (r.json() as Promise<BoardGeometry>) : Promise.reject(new Error(String(r.status)))))
      .then((g) => !dead && setGeom(g))
      .catch(() => !dead && setFailed(true));
    fetch("/boards/clean_sensor/summary.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: { stats: { added_parts: number; tracks: number; fully_routed: boolean }; drc: { errors: number } }) => !dead && setStats({ added: s.stats.added_parts, tracks: s.stats.tracks, routed: s.stats.fully_routed, drcErrors: s.drc.errors }))
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, []);

  const bodies = useMemo(() => (geom ? geom.footprints.map((fp) => ({ ref: fp.ref, b: bodyOf(fp), look: lookOf(fp) })) : []), [geom]);
  const stop = STOPS[sel];
  const lit = useMemo(() => new Set(geom ? presentRefs(stop, geom.footprints.map((f) => f.ref)) : []), [geom, stop]);
  const anchor = (i: number) => {
    const refs = presentRefs(STOPS[i], bodies.map((b) => b.ref));
    const bs = bodies.filter((b) => refs.includes(b.ref)).map((b) => b.b);
    if (!bs.length) return null;
    return { x: (Math.min(...bs.map((b) => b.x0)) + Math.max(...bs.map((b) => b.x1))) / 2, y: (Math.min(...bs.map((b) => b.y0)) + Math.max(...bs.map((b) => b.y1))) / 2 };
  };
  const pad = 2;

  return (
    <section id="explore" className="mk-section mk-center" aria-labelledby="explore-h">
      <div className="mk-wrap" style={{ maxWidth: 1040 }}>
        <span className="mk-chip mk-eyebrow mk-reveal" style={{ ["--chip" as string]: "var(--hw-pcb)" } as CSSProperties}>
          <Icon name="grid" size={14} /> Explore a real board
        </span>
        <h2 id="explore-h" className="hw-display mk-h2 mk-reveal">
          Every part, <span className="mk-grad">and why it is there</span>
        </h2>
        <p className="mk-sub mk-reveal">This is a board Hardwright placed, routed and checked with KiCad. Pick a part.</p>

        <div className="mk-reveal" style={{ display: "grid", gap: 20, marginTop: 36, textAlign: "left", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
          <div
            style={{ perspective: 1100 }}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setTilt(tiltOf((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, reduce));
            }}
            onPointerLeave={() => setTilt({ rx: 0, ry: 0 })}
          >
            <div
              style={{ transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`, transition: "transform 160ms ease-out", transformStyle: "preserve-3d", borderRadius: 20, padding: 14, background: "radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, var(--hw-pcb) 14%, var(--hw-surface)), var(--hw-surface))", border: "1px solid var(--hw-border)", boxShadow: "var(--hw-shadow)" }}
            >
              {geom ? (
                <svg viewBox={`${-pad} ${-pad} ${geom.width + 2 * pad} ${geom.height + 2 * pad}`} role="img" aria-label={`The reference sensor board, ${geom.width} by ${geom.height} millimetres, with ${geom.footprints.length} parts. The ${stop.label.toLowerCase()} is highlighted.`} style={{ display: "block", width: "100%", height: "auto" }} data-testid="explorer-board">
                  <defs>
                    <filter id="ex-glow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="0.9" result="b" />
                      <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <rect x={0} y={0} width={geom.width} height={geom.height} rx={1.2} fill="#0d3b2c" stroke="#e6d36a" strokeWidth={0.25} />
                  {geom.tracks.map((t, i) => (
                    <line key={i} x1={t.x0} y1={t.y0} x2={t.x1} y2={t.y1} stroke={t.layer === "F" ? "#d9534f" : "#4f86d6"} strokeWidth={t.w} strokeLinecap="round" opacity={0.55} />
                  ))}
                  {bodies.map(({ ref, b, look }) => {
                    const on = lit.has(ref);
                    return (
                      <rect key={ref} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={0.4} fill={rgb(look.colour)} fillOpacity={on ? 0.95 : 0.28} stroke={on ? "#ffb347" : "none"} strokeWidth={0.35} filter={on ? "url(#ex-glow)" : undefined} style={{ transition: "fill-opacity 200ms" }} />
                    );
                  })}
                  {geom.footprints.flatMap((fp) => fp.pads.map((p, i) => (p.npth ? null : <rect key={`${fp.ref}${i}`} x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} fill="#d9b45a" opacity={lit.has(fp.ref) ? 1 : 0.45} />)))}
                  {STOPS.map((s, i) => {
                    const a = anchor(i);
                    if (!a) return null;
                    const on = i === sel;
                    return (
                      <g key={s.id} transform={`translate(${a.x} ${a.y})`} onClick={() => setSel(i)} style={{ cursor: "pointer" }}>
                        <circle r={on ? 2.1 : 1.6} fill={on ? "#ffb347" : "#101417"} stroke={on ? "#fff" : "#ffb347"} strokeWidth={0.28} />
                        <text textAnchor="middle" dy={0.62} fontSize={1.9} fontWeight={700} fill={on ? "#101417" : "#ffb347"} fontFamily="var(--font-code), monospace">
                          {i + 1}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <p role="status" style={{ minHeight: 280, display: "grid", placeItems: "center", color: "var(--hw-ink-3)", fontSize: 13 }}>
                  {failed ? "The board picture could not be loaded." : "Loading the routed board…"}
                </p>
              )}
            </div>
          </div>

          <div>
            <ul role="tablist" aria-label="Parts of the board" style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
              {STOPS.map((s, i) => (
                <li key={s.id}>
                  <button type="button" role="tab" aria-selected={i === sel} className="mk-tab" data-stop={s.id} onClick={() => setSel(i)} style={{ letterSpacing: "0.06em", fontSize: 11.5 }}>
                    {geom && <span aria-hidden="true" style={{ color: "var(--hw-ember)", marginRight: 6 }}>{i + 1}</span>}
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
            <div role="tabpanel" aria-live="polite" style={{ marginTop: 16, padding: 20, borderRadius: 16, border: "1px solid var(--hw-border)", background: "color-mix(in srgb, var(--hw-surface) 92%, transparent)" }} data-testid="explorer-card">
              <p className="mk-mono" style={{ fontSize: 11.5, color: "var(--hw-ember)", letterSpacing: "0.08em" }}>
                {stop.refs.join(" · ")}
              </p>
              <h3 style={{ marginTop: 6, fontSize: 20, fontWeight: 600, color: "var(--hw-ink)" }}>{stop.title}</h3>
              <p style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.55, color: "var(--hw-ink-2)" }}>{stop.text}</p>
            </div>
            <p style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.5, color: "var(--hw-ink-3)" }}>
              {geom && stats ? `Real geometry: ${geom.footprints.length} parts (${stats.added} added by the layout), ${stats.tracks} copper tracks, ${stats.routed ? "fully routed" : "not fully routed"}, ${stats.drcErrors} KiCad design-rule errors. ` : ""}Part names marked placeholder in the parts list are stand-ins for real parts. Open the Board workbench to make one for your own design.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
