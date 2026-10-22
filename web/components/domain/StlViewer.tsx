"use client";

import { useEffect, useRef, useState } from "react";
import { parseStl, type Mesh } from "@/lib/stl";

type Load = { state: "loading" } | { state: "missing" } | { state: "bad"; why: string } | { state: "ok"; mesh: Mesh };

function useStl(url: string | null): Load {
  const [r, setR] = useState<{ url: string; load: Load } | null>(null);
  useEffect(() => {
    if (!url) return;
    let dead = false;
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return !dead && setR({ url, load: { state: "missing" } });
        const mesh = parseStl(await res.arrayBuffer());
        if (!dead) setR({ url, load: { state: "ok", mesh } });
      } catch (e) {
        if (!dead) setR({ url, load: { state: "bad", why: e instanceof Error ? e.message : "unreadable" } });
      }
    })();
    return () => {
      dead = true;
    };
  }, [url]);
  if (!url) return { state: "missing" };
  return r && r.url === url ? r.load : { state: "loading" };
}

const hex = (s: string): [number, number, number] => {
  const m = s.trim().match(/^#([0-9a-f]{6})$/i);
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [180, 185, 173];
};

/** Orthographic draw of the mesh, painter's order, flat shading from recomputed normals. */
export function drawMesh(ctx: CanvasRenderingContext2D, mesh: Mesh, w: number, h: number, az: number, el: number, base: [number, number, number], zScale: number) {
  const cx = (mesh.min[0] + mesh.max[0]) / 2;
  const cy = (mesh.min[1] + mesh.max[1]) / 2;
  const cz = (mesh.min[2] + mesh.max[2]) / 2;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const ce = Math.cos(el);
  const se = Math.sin(el);
  const rot = (x: number, y: number, z: number): [number, number, number] => {
    const X = (x - cx) * ca - (y - cy) * sa;
    const Y = (x - cx) * sa + (y - cy) * ca;
    const Z = (z - cz) * zScale;
    // tilt: screen y grows downward, depth grows away from the viewer
    return [X, Y * se + Z * ce, Y * ce - Z * se];
  };
  const span = Math.max(mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1]) * 1.42;
  const k = Math.min(w, h) / span;
  const order: Array<{ i: number; d: number }> = [];
  const P = new Float32Array(mesh.count * 9);
  for (let t = 0; t < mesh.count; t++) {
    let dsum = 0;
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const [x, y, d] = rot(mesh.tris[o], mesh.tris[o + 1], mesh.tris[o + 2]);
      P[o] = x;
      P[o + 1] = y;
      P[o + 2] = d;
      dsum += d;
    }
    order.push({ i: t, d: dsum });
  }
  order.sort((a, b) => b.d - a.d);
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 0.6;
  ctx.lineJoin = "round";
  for (const { i } of order) {
    const o = i * 9;
    const ux = P[o + 3] - P[o];
    const uy = P[o + 4] - P[o + 1];
    const uz = P[o + 5] - P[o + 2];
    const vx = P[o + 6] - P[o];
    const vy = P[o + 7] - P[o + 1];
    const vz = P[o + 8] - P[o + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // light from the upper left and the viewer; depth axis points away, so a face toward the viewer has -nz.
    const lit = Math.abs(-nx * 0.35 + -ny * 0.55 + -nz * 0.75);
    const s = 0.28 + 0.72 * lit;
    const col = `rgb(${Math.round(base[0] * s)},${Math.round(base[1] * s)},${Math.round(base[2] * s)})`;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(w / 2 + P[o] * k, h * 0.5 + P[o + 1] * k);
    ctx.lineTo(w / 2 + P[o + 3] * k, h * 0.5 + P[o + 4] * k);
    ctx.lineTo(w / 2 + P[o + 6] * k, h * 0.5 + P[o + 7] * k);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

export function StlViewer({ url, label }: { url: string | null; label: string }) {
  const load = useStl(url);
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [az, setAz] = useState(0.6);
  const [el, setEl] = useState(0.95);
  const [w, setW] = useState(0);
  const drag = useRef<{ x: number; y: number; az: number; el: number } | null>(null);

  useEffect(() => {
    const node = wrap.current;
    if (!node) return;
    const ro = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width)));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const h = Math.max(220, Math.min(380, Math.round(w * 0.72)));
  useEffect(() => {
    const cv = ref.current;
    if (!cv || load.state !== "ok" || !w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMesh(ctx, load.mesh, w, h, az, el, hex(getComputedStyle(cv).getPropertyValue("--ink-2")), 6);
  }, [load, w, h, az, el]);

  return (
    <div ref={wrap} className="min-w-0">
      {load.state === "ok" ? (
        <>
          <canvas
            ref={ref}
            role="img"
            aria-label={label}
            style={{ width: "100%", height: h, touchAction: "none", cursor: "grab" }}
            className="block rounded-md bg-sunken"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, az, el };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              setAz(d.az + (e.clientX - d.x) * 0.01);
              setEl(Math.max(0.15, Math.min(1.45, d.el + (e.clientY - d.y) * 0.006)));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            <button type="button" onClick={() => setAz((a) => a - 0.3)} className="h-8 rounded-md border border-line-2 px-2.5 text-ink-2 hover:text-ink" aria-label="Rotate left">
              ⟲ Rotate
            </button>
            <button type="button" onClick={() => setAz((a) => a + 0.3)} className="h-8 rounded-md border border-line-2 px-2.5 text-ink-2 hover:text-ink" aria-label="Rotate right">
              Rotate ⟳
            </button>
            <button type="button" onClick={() => { setAz(0.6); setEl(0.95); }} className="h-8 rounded-md px-2.5 hover:text-ink">
              Reset
            </button>
            <span className="num ml-auto">{load.mesh.count.toLocaleString("en-US")} triangles · z exaggerated 6×</span>
          </div>
        </>
      ) : (
        <p className="grid min-h-[140px] place-items-center rounded-md bg-sunken px-4 py-6 text-center text-[13px] leading-snug text-ink-3" role="status">
          {load.state === "loading"
            ? "Loading the geometry…"
            : load.state === "bad"
              ? `The geometry file could not be read (${load.why}).`
              : "No geometry file is shipped with this replay for this candidate, so there is nothing to draw. The event log records the file's hash, not its contents."}
        </p>
      )}
    </div>
  );
}
