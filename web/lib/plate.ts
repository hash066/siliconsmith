// Geometry for the temperature-coloured plate: the `matter-candidate/1` viewer artifact (mask + field) extruded into triangles.
// Each material cell becomes a box: its top face and any side face that borders empty space or the plate edge. Every triangle carries the
// temperature of its cell, so colours are the solver's numbers and nothing is interpolated or invented.

import type { MatterViewer } from "./hosted";
import type { Mesh } from "./stl";

export interface PlateMesh {
  mesh: Mesh;
  /** Temperature in degC of the cell each triangle belongs to. */
  temps: Float32Array;
  tMin: number;
  tMax: number;
  cells: number;
}

export function buildPlate(v: MatterViewer): PlateMesh {
  const n = v.n;
  const dx = v.dx_mm;
  const t = v.thickness_mm;
  const solid = (i: number, j: number) => i >= 0 && j >= 0 && i < n && j < n && v.mask[j]?.[i] === "1";
  const tris: number[] = [];
  const temps: number[] = [];
  let cells = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  const quad = (a: number[], b: number[], c: number[], d: number[], T: number) => {
    tris.push(...a, ...b, ...c, ...a, ...c, ...d);
    temps.push(T, T);
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (!solid(i, j)) continue;
      const T = v.field.T[j]?.[i];
      if (typeof T !== "number") continue;
      cells++;
      tMin = Math.min(tMin, T);
      tMax = Math.max(tMax, T);
      const x0 = i * dx;
      const x1 = x0 + dx;
      const y0 = j * dx;
      const y1 = y0 + dx;
      quad([x0, y0, t], [x1, y0, t], [x1, y1, t], [x0, y1, t], T);
      if (!solid(i - 1, j)) quad([x0, y0, 0], [x0, y1, 0], [x0, y1, t], [x0, y0, t], T);
      if (!solid(i + 1, j)) quad([x1, y0, 0], [x1, y0, t], [x1, y1, t], [x1, y1, 0], T);
      if (!solid(i, j - 1)) quad([x0, y0, 0], [x0, y0, t], [x1, y0, t], [x1, y0, 0], T);
      if (!solid(i, j + 1)) quad([x0, y1, 0], [x1, y1, 0], [x1, y1, t], [x0, y1, t], T);
    }
  const arr = Float32Array.from(tris);
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [n * dx, n * dx, t];
  return { mesh: { tris: arr, count: arr.length / 9, min, max }, temps: Float32Array.from(temps), tMin: cells ? tMin : 0, tMax: cells ? tMax : 0, cells };
}

const STOPS: Array<[number, number, number]> = [
  [20, 24, 80], // cool: near ambient
  [90, 40, 130],
  [190, 55, 90],
  [245, 130, 35],
  [252, 230, 110], // hot: the peak
];

/** 0 (ambient) to 1 (peak) -> a dark-blue to yellow ramp that stays readable on the graphite ground. */
export function heatColor(t01: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, Number.isFinite(t01) ? t01 : 0)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const heatGradientCss = () => `linear-gradient(90deg, ${STOPS.map((s, i) => `rgb(${s.join(",")}) ${Math.round((i / (STOPS.length - 1)) * 100)}%`).join(", ")})`;
