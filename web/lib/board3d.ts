// A 3D picture of a routed board, built from the same geometry the 2D view uses: the substrate, the copper pads and the parts as boxes.
// It is APPROXIMATE and labelled so: each part is a box over its footprint at a typical height, not a model of the real package.
import type { BoardGeometry, FootprintGeom } from "./layout";
import type { Mesh } from "./stl";

export type Rgb = [number, number, number];

const SUBSTRATE_T = 1.6;
const COPPER_T = 0.05;

interface Look {
  height: number;
  colour: Rgb;
  word: string;
}

/** Typical body height and colour by footprint family. */
export function lookOf(fp: FootprintGeom): Look {
  const n = fp.footprint;
  if (/ESP32|RF_Module/i.test(n)) return { height: 3.1, colour: [172, 176, 184], word: "module" };
  if (/USB_C|USB/i.test(n)) return { height: 3.3, colour: [190, 196, 204], word: "connector" };
  if (/JST|Connector/i.test(n)) return { height: 6.0, colour: [226, 222, 205], word: "connector" };
  if (/SW_|Button/i.test(n)) return { height: 3.5, colour: [70, 72, 78], word: "button" };
  if (/LED/i.test(n)) return { height: 0.7, colour: [236, 214, 120], word: "LED" };
  if (/Capacitor|C_0/i.test(n)) return { height: 0.8, colour: [166, 126, 84], word: "capacitor" };
  if (/Resistor|R_0/i.test(n)) return { height: 0.5, colour: [34, 34, 38], word: "resistor" };
  if (/LGA/i.test(n)) return { height: 0.95, colour: [190, 190, 196], word: "sensor" };
  return { height: 1.2, colour: [30, 30, 34], word: "chip" };
}

/** The part's footprint on the board: its silkscreen and courtyard outline if it has one, else its pads. */
export function bodyOf(fp: FootprintGeom): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  const isModule = /ESP32|RF_Module/i.test(fp.footprint);
  for (const g of fp.graphics) {
    if (g.layer !== "crt" && !(isModule && g.layer === "silk")) continue;
    grow(g.p[0], g.p[1]);
    if (g.k === "line" || g.k === "rect") grow(g.p[2], g.p[3]);
  }
  for (const p of fp.pads) {
    if (p.npth) continue;
    grow(p.x - p.w / 2, p.y - p.h / 2);
    grow(p.x + p.w / 2, p.y + p.h / 2);
  }
  if (!Number.isFinite(x0)) return { x0: fp.x - 1, y0: fp.y - 1, x1: fp.x + 1, y1: fp.y + 1 };
  return { x0, y0, x1, y1 };
}

class Builder {
  tris: number[] = [];
  colours: Rgb[] = [];
  /** y is flipped so the picture matches the 2D layout seen from above (the board's y axis points down). */
  constructor(private flipY: number) {}
  box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, c: Rgb) {
    const ya = this.flipY - y1;
    const yb = this.flipY - y0;
    const v = (x: number, y: number, z: number) => [x, y, z];
    const p = [v(x0, ya, z0), v(x1, ya, z0), v(x1, yb, z0), v(x0, yb, z0), v(x0, ya, z1), v(x1, ya, z1), v(x1, yb, z1), v(x0, yb, z1)];
    const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    for (const f of faces) {
      for (const i of f) this.tris.push(...p[i]);
      this.colours.push(c);
    }
  }
}

export interface Board3D {
  mesh: Mesh;
  colours: Rgb[];
  parts: number;
}

export function boardMesh(g: BoardGeometry): Board3D {
  const b = new Builder(g.height);
  const GREEN: Rgb = [28, 122, 78];
  const GOLD: Rgb = [214, 178, 90];
  b.box(0, 0, g.width, g.height, 0, SUBSTRATE_T, GREEN);
  // the module's own board and antenna hang past the edge: draw the module before the pads so they read on top of it
  for (const fp of g.footprints) {
    const look = lookOf(fp);
    const r = bodyOf(fp);
    if (look.word === "module") b.box(r.x0, r.y0, r.x1, r.y1, SUBSTRATE_T, SUBSTRATE_T + 0.8, [24, 96, 76]);
  }
  for (const fp of g.footprints) for (const p of fp.pads) if (!p.npth && p.side === "F") b.box(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, SUBSTRATE_T, SUBSTRATE_T + COPPER_T, GOLD);
  let parts = 0;
  for (const fp of g.footprints) {
    const look = lookOf(fp);
    const r = bodyOf(fp);
    // inset a little so tiny parts do not hide their own pads
    const inset = look.word === "resistor" || look.word === "capacitor" || look.word === "LED" ? 0.28 : 0.1;
    if (look.word === "module") b.box(r.x0 + 0.5, r.y0 + 6.8, r.x1 - 0.5, r.y1 - 0.5, SUBSTRATE_T + 0.8, SUBSTRATE_T + look.height, look.colour);
    else b.box(r.x0 + inset, r.y0 + inset, r.x1 - inset, r.y1 - inset, SUBSTRATE_T, SUBSTRATE_T + look.height, look.colour);
    parts++;
  }
  const tris = Float32Array.from(b.tris);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], tris[i + k]);
    max[k] = Math.max(max[k], tris[i + k]);
  }
  return { mesh: { tris, count: tris.length / 9, min, max }, colours: b.colours, parts };
}
