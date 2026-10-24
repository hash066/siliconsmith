"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { boundsOf, type BoardGeometry, type FootprintGeom, type Marker, type PadGeom } from "@/lib/layout";

// Colours follow what people expect from KiCad's board view: green mask, red top copper, blue bottom copper, gold pads, cream silkscreen.
const C = {
  mask: "#0d3b2c",
  maskLine: "#e6d36a",
  top: "#d9534f",
  bottom: "#4f86d6",
  pad: "#d9b45a",
  hole: "#10151a",
  silk: "#efe9b8",
  fail: "#ff4d4d",
  wired: "#5fd38d",
  warn: "#ffb020",
};

type LayerKey = "top" | "bottom" | "pour" | "silk" | "labels";
const LAYER_LABEL: Record<LayerKey, string> = { top: "Top copper", bottom: "Bottom copper", pour: "Ground pour", silk: "Silkscreen", labels: "Part names" };

function pathOf(pts: number[][]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("") + "Z";
}

function Pad({ p, hot, dim, onHover }: { p: PadGeom; hot: boolean; dim: boolean; onHover: (net: string | null) => void }) {
  const common = { fill: p.npth ? C.hole : C.pad, opacity: dim ? 0.35 : 1, stroke: hot ? "#fff" : "none", strokeWidth: 0.12, onMouseEnter: () => onHover(p.net || null), onMouseLeave: () => onHover(null) };
  const shape =
    p.shape === "circle" || (p.shape === "oval" && Math.abs(p.w - p.h) < 0.01) ? (
      <circle cx={0} cy={0} r={Math.min(p.w, p.h) / 2} {...common} />
    ) : p.shape === "oval" ? (
      <rect x={-p.w / 2} y={-p.h / 2} width={p.w} height={p.h} rx={Math.min(p.w, p.h) / 2} {...common} />
    ) : (
      <rect x={-p.w / 2} y={-p.h / 2} width={p.w} height={p.h} rx={p.shape === "roundrect" ? Math.min(p.w, p.h) * 0.25 : 0} {...common} />
    );
  return (
    <g transform={`translate(${p.x} ${p.y}) rotate(${-p.rot})`}>
      {shape}
      {p.drill > 0 && <circle cx={0} cy={0} r={p.drill / 2} fill={C.hole} />}
    </g>
  );
}

function Graphic({ g }: { g: FootprintGeom["graphics"][number] }) {
  if (g.layer === "crt") return null;
  const s = { stroke: C.silk, strokeWidth: 0.12, fill: "none", strokeLinecap: "round" as const };
  if (g.k === "line") return <line x1={g.p[0]} y1={g.p[1]} x2={g.p[2]} y2={g.p[3]} {...s} />;
  if (g.k === "rect") return <rect x={Math.min(g.p[0], g.p[2])} y={Math.min(g.p[1], g.p[3])} width={Math.abs(g.p[2] - g.p[0])} height={Math.abs(g.p[3] - g.p[1])} {...s} />;
  if (g.k === "circle") return <circle cx={g.p[0]} cy={g.p[1]} r={g.p[2]} {...s} />;
  if (g.k === "arc") {
    // three points on the arc: a quadratic approximation is close enough for silkscreen
    const [x0, y0, xm, ym, x1, y1] = g.p;
    return <path d={`M${x0} ${y0} Q${2 * xm - (x0 + x1) / 2} ${2 * ym - (y0 + y1) / 2} ${x1} ${y1}`} {...s} />;
  }
  return null;
}

export interface PcbViewProps {
  geom: BoardGeometry;
  markers: Marker[];
  /** A marker to zoom to (set when the visitor clicks a failing check or a marker). */
  focus?: Marker | null;
  onFocusMarker?: (m: Marker | null) => void;
  /** A point on the board (mm) to zoom to, for example a design-rule finding. */
  focusAt?: { x: number; y: number } | null;
}

/** The board as KiCad made it, drawn from its exported geometry: layers, ground pour, net highlight on hover, check markers on the pads. */
export function PcbView({ geom, markers, focus, onFocusMarker, focusAt }: PcbViewProps) {
  const b = useMemo(() => boundsOf(geom), [geom]);
  const pad = 2;
  const full = useMemo(() => ({ x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad }), [b]);
  const [view, setView] = useState(full);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ top: true, bottom: true, pour: true, silk: true, labels: true });
  const [net, setNet] = useState<string | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  useEffect(() => setView(full), [full]);

  useEffect(() => {
    if (!focusAt) return;
    const w = 12;
    const h = w * (full.h / full.w);
    setView({ x: focusAt.x - w / 2, y: focusAt.y - h / 2, w, h });
  }, [focusAt, full]);

  // zoom to a marker's pad
  useEffect(() => {
    if (!focus) return;
    const fp = geom.footprints.find((f) => f.ref === focus.ref);
    const p = fp?.pads.find((q) => q.name === focus.pad);
    if (!p) return;
    const w = 14;
    const h = w * (full.h / full.w);
    setView({ x: p.x - w / 2, y: p.y - h / 2, w, h });
  }, [focus, geom, full]);

  const zoom = (f: number, cx?: number, cy?: number) =>
    setView((v) => {
      const nw = Math.min(full.w * 1.2, Math.max(4, v.w * f));
      const nh = nw * (full.h / full.w);
      const px = cx ?? v.x + v.w / 2;
      const py = cy ?? v.y + v.h / 2;
      return { x: px - ((px - v.x) / v.w) * nw, y: py - ((py - v.y) / v.h) * nh, w: nw, h: nh };
    });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scrolling still scrolls the page; Ctrl or ⌘ with the wheel (or a pinch) zooms
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const px = v.x + ((e.clientX - r.left) / r.width) * v.w;
        const py = v.y + ((e.clientY - r.top) / r.height) * v.h;
        const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const nw = Math.min(full.w * 1.2, Math.max(4, v.w * f));
        const nh = nw * (full.h / full.w);
        return { x: px - ((px - v.x) / v.w) * nw, y: py - ((py - v.y) / v.h) * nh, w: nw, h: nh };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [full]);

  const flagged = useMemo(() => {
    const m = new Map<string, Marker>();
    for (const k of markers) m.set(`${k.ref}:${k.pad}`, k);
    return m;
  }, [markers]);
  const hot = (n: string) => net !== null && n === net;
  const dimOthers = net !== null;
  const gnd = (n: string) => n === "GND";

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Board layers">
        {(Object.keys(LAYER_LABEL) as LayerKey[]).map((k) => (
          <label key={k} className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] ${layers[k] ? "border-signal-line bg-raised text-ink" : "border-line text-ink-3"}`}>
            <input type="checkbox" className="sr-only" checked={layers[k]} onChange={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} />
            <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${layers[k] ? "bg-signal" : "border border-line-2"}`} />
            {LAYER_LABEL[k]}
          </label>
        ))}
        <span className="ml-auto inline-flex gap-1">
          <button type="button" onClick={() => zoom(1 / 1.4)} aria-label="Zoom in" className="h-8 w-8 rounded-lg border border-line text-[15px] text-ink-2 hover:text-ink">
            +
          </button>
          <button type="button" onClick={() => zoom(1.4)} aria-label="Zoom out" className="h-8 w-8 rounded-lg border border-line text-[15px] text-ink-2 hover:text-ink">
            −
          </button>
          <button
            type="button"
            onClick={() => {
              setView(full);
              onFocusMarker?.(null);
            }}
            className="h-8 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 hover:text-ink"
          >
            Reset view
          </button>
        </span>
      </div>
      <svg
        ref={box}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="block h-auto w-full touch-none select-none rounded-xl border border-line bg-[#0a1f19]"
        style={{ aspectRatio: `${full.w} / ${full.h}`, cursor: drag.current ? "grabbing" : "grab" }}
        role="img"
        aria-label={`Routed ${geom.width} by ${geom.height} millimetre board with ${geom.footprints.length} parts. ${markers.length ? `${markers.length} marker(s) on pads.` : "No check markers."}`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !box.current) return;
          const r = box.current.getBoundingClientRect();
          setView((v) => ({ ...v, x: d.vx - ((e.clientX - d.x) / r.width) * v.w, y: d.vy - ((e.clientY - d.y) / r.height) * v.h }));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <defs>
          <pattern id="ko" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="1" stroke={C.fail} strokeWidth="0.12" opacity="0.5" />
          </pattern>
        </defs>
        {/* board */}
        <rect x={0} y={0} width={geom.width} height={geom.height} fill={C.mask} />
        {geom.keepouts.map((k, i) => (
          <rect key={i} x={k[0]} y={k[1]} width={k[2] - k[0]} height={k[3] - k[1]} fill="url(#ko)" opacity={0.7} />
        ))}
        {/* bottom copper */}
        {layers.bottom && (
          <g opacity={layers.top ? 0.7 : 1}>
            {layers.pour && geom.zones.filter((z) => z.layer === "B").map((z, i) => <path key={i} d={pathOf(z.outline) + z.holes.map(pathOf).join("")} fillRule="evenodd" fill={C.bottom} opacity={dimOthers ? 0.04 : 0.11} />)}
            {geom.tracks.filter((t) => t.layer === "B").map((t, i) => (
              <line key={i} x1={t.x0} y1={t.y0} x2={t.x1} y2={t.y1} stroke={C.bottom} strokeWidth={t.w} strokeLinecap="round" opacity={dimOthers && !hot(t.net) ? 0.25 : 1} onMouseEnter={() => setNet(t.net)} onMouseLeave={() => setNet(null)} />
            ))}
          </g>
        )}
        {/* top copper */}
        {layers.top && (
          <g>
            {layers.pour && geom.zones.filter((z) => z.layer === "F").map((z, i) => <path key={i} d={pathOf(z.outline) + z.holes.map(pathOf).join("")} fillRule="evenodd" fill={C.top} opacity={dimOthers ? 0.05 : 0.17} />)}
            {geom.tracks.filter((t) => t.layer === "F").map((t, i) => (
              <line key={i} x1={t.x0} y1={t.y0} x2={t.x1} y2={t.y1} stroke={C.top} strokeWidth={t.w} strokeLinecap="round" opacity={dimOthers && !hot(t.net) ? 0.25 : 1} onMouseEnter={() => setNet(t.net)} onMouseLeave={() => setNet(null)} />
            ))}
          </g>
        )}
        {/* vias */}
        {(layers.top || layers.bottom) &&
          geom.vias.map((v, i) => (
            <g key={i} opacity={dimOthers && !hot(v.net) ? 0.3 : 1} onMouseEnter={() => setNet(v.net)} onMouseLeave={() => setNet(null)}>
              <circle cx={v.x} cy={v.y} r={v.d / 2} fill={C.pad} />
              <circle cx={v.x} cy={v.y} r={v.drill / 2} fill={C.hole} />
            </g>
          ))}
        {/* pads */}
        {(layers.top || layers.bottom) &&
          geom.footprints.flatMap((fp) => fp.pads.map((p, i) => <Pad key={`${fp.ref}-${p.name}-${i}`} p={p} hot={hot(p.net)} dim={dimOthers && !hot(p.net) && !gnd(p.net)} onHover={setNet} />))}
        {/* silkscreen */}
        {layers.silk && (
          <g>
            {geom.footprints.flatMap((fp) => fp.graphics.map((g, i) => <Graphic key={`${fp.ref}-g${i}`} g={g} />))}
            {geom.texts.map((t, i) => (
              <text key={i} x={t.x} y={t.y} fontSize={t.size * 0.9} textAnchor="middle" fill={C.silk} fontFamily="var(--font-code), monospace">
                {t.text}
              </text>
            ))}
          </g>
        )}
        {layers.labels &&
          geom.footprints.map((fp) => {
            const top = Math.min(...fp.pads.map((p) => p.y - p.h / 2));
            const cx = fp.pads.reduce((s, p) => s + p.x, 0) / Math.max(1, fp.pads.length);
            return (
              <text key={fp.ref} x={cx} y={top - 0.5} fontSize={fp.ref.startsWith("U") || fp.ref.startsWith("J") ? 1.6 : 1.05} textAnchor="middle" fill={C.silk} fontFamily="var(--font-code), monospace" stroke={C.mask} strokeWidth={0.25} paintOrder="stroke">
                {fp.ref}
              </text>
            );
          })}
        {/* outline */}
        {geom.outline.map((s, i) => (
          <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke={C.maskLine} strokeWidth={0.2} />
        ))}
        {/* check markers */}
        {markers.map((m, i) => {
          const fp = geom.footprints.find((f) => f.ref === m.ref);
          const pads = fp?.pads.filter((p) => p.name === m.pad) ?? [];
          if (!pads.length) return null;
          const p = pads[0];
          const col = m.kind === "fail" ? C.fail : m.kind === "wired" ? C.wired : C.warn;
          const on = focus && focus.ref === m.ref && focus.pad === m.pad && focus.kind === m.kind;
          return (
            <g key={i} style={{ cursor: "pointer" }} onClick={() => onFocusMarker?.(m)} data-testid={`marker-${m.kind}-${m.pad}`}>
              <circle cx={p.x} cy={p.y} r={Math.max(p.w, p.h) * 1.1 + 0.6} fill="none" stroke={col} strokeWidth={on ? 0.35 : 0.22} className="hw-marker" />
              <circle cx={p.x} cy={p.y} r={Math.max(p.w, p.h) * 1.1 + 0.6} fill={col} opacity={0.12} />
              <title>{`${m.ref} pad ${m.pad}: ${m.text}`}</title>
            </g>
          );
        })}
      </svg>
      <p className="mt-1.5 min-h-[18px] text-[12px] text-ink-3" aria-live="polite">
        {net ? `Net ${net}` : "Hover a pad or track to see its net. Drag to pan; use + and −, or Ctrl and scroll, to zoom."}
      </p>
    </div>
  );
}
