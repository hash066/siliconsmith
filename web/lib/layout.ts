// The routed board for a design: types for the generated geometry, the lookup of a precomputed layout by netlist, and the
// firmware-versus-board markers. The board is made by the engine (KiCad, Freerouting) and served as static files; see
// engine/siliconsmith/board/layout and engine/scripts/build_boards.py. Nothing here draws or invents copper.

export interface PadGeom {
  name: string;
  net: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  shape: "rect" | "circle" | "oval" | "roundrect";
  through: boolean;
  npth: boolean;
  drill: number;
  side: "F" | "B";
}
export interface GraphicGeom {
  k: "line" | "rect" | "circle" | "arc" | "poly";
  layer: "silk" | "crt";
  p: number[];
}
export interface FootprintGeom {
  ref: string;
  value: string;
  footprint: string;
  x: number;
  y: number;
  rot: number;
  pads: PadGeom[];
  graphics: GraphicGeom[];
}
export interface TrackGeom {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  layer: "F" | "B";
  net: string;
}
export interface ViaGeom {
  x: number;
  y: number;
  d: number;
  drill: number;
  net: string;
}
export interface ZoneGeom {
  layer: "F" | "B";
  net: string;
  outline: number[][];
  holes: number[][][];
}
export interface BoardGeometry {
  width: number;
  height: number;
  outline: number[][];
  footprints: FootprintGeom[];
  tracks: TrackGeom[];
  vias: ViaGeom[];
  zones: ZoneGeom[];
  keepouts: number[][];
  texts: Array<{ text: string; x: number; y: number; size: number }>;
}

export interface Marker {
  ref: string;
  pad: string;
  kind: "fail" | "wired" | "warn";
  rung: string;
  text: string;
}

export interface LayoutSummary {
  template: string;
  design_name: string;
  mcu_ref: string | null;
  mcu_padmap: Record<string, string[]>;
  status: string;
  stats: { parts: number; added_parts: number; nets: number; tracks: number; vias: number; board_mm: [number, number]; layers: number; unrouted_connections: number; fully_routed: boolean; seconds: number };
  drc: { errors: number; warnings: number; unconnected: number; error_types: Record<string, number>; warning_types: Record<string, number> };
  markers: Marker[];
  notes: string[];
  files: Record<string, string>;
  tool_note: string;
  generated_with: { kicad: string; router: string; rules: string };
}

export interface LayoutIndex {
  layouts: Record<string, { dir: string; canonical: string; templates: string[] }>;
}

interface DesignLike {
  instances: Array<{ ref: string; part: string; params?: Record<string, unknown> }>;
  nets: Array<{ name: string; pins: string[] }>;
  mcu_ref?: string;
  mcu_assignments?: Array<{ function: string; pin: string }>;
  firmware_pins?: Array<{ function: string; pin: string }>;
}

/** The same text the engine makes (engine/siliconsmith/board/layout/canonical.py): parts and connections only, sorted. A test pins the two together. */
export function canonicalNetlist(design: DesignLike): string {
  const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const instances = design.instances
    .map((i) => [i.ref, i.part, Object.entries(i.params ?? {}).sort(([a], [b]) => byStr(a, b)).map(([k, v]) => [k, v])] as const)
    .sort((a, b) => byStr(a[0], b[0]));
  const nets = design.nets.map((n) => [n.name, [...n.pins].sort(byStr)] as const).sort((a, b) => byStr(a[0], b[0]));
  return JSON.stringify({ instances, nets });
}

export function findLayout(index: LayoutIndex | null, design: DesignLike | null): { dir: string } | null {
  if (!index || !design) return null;
  const c = canonicalNetlist(design);
  for (const v of Object.values(index.layouts)) if (v.canonical === c) return { dir: v.dir };
  return null;
}

interface CheckLike {
  rungs: Array<{ rung: string; status: string; evidence: string[] }>;
}

/** Firmware-versus-board findings, on the pads they are about. Mirrors the engine's `_markers`; works on the live design and check. */
export function markersFor(design: DesignLike | null, summary: LayoutSummary | null, check: CheckLike | null): Marker[] {
  const out: Marker[] = [];
  if (!design || !summary || !design.mcu_ref) return out;
  const ref = design.mcu_ref;
  const pads = (pin: string) => summary.mcu_padmap[pin] ?? [];
  const wired = new Map((design.mcu_assignments ?? []).map((a) => [a.function, a.pin]));
  for (const fw of design.firmware_pins ?? []) {
    const nl = wired.get(fw.function);
    if (nl && nl !== fw.pin) {
      for (const pad of pads(fw.pin)) out.push({ ref, pad, kind: "fail", rung: "B4", text: `Firmware says ${fw.function} is on ${fw.pin}, but the board wires it to ${nl}.` });
      for (const pad of pads(nl)) out.push({ ref, pad, kind: "wired", rung: "B4", text: `${fw.function} is actually wired here (${nl}).` });
    }
  }
  if (check) {
    const names = new Map(Object.keys(summary.mcu_padmap).map((n) => [n.toLowerCase(), n]));
    const part = design.instances.find((i) => i.ref === ref)?.part;
    for (const r of check.rungs) {
      if (r.status === "pass") continue;
      for (const ev of r.evidence) {
        const m = part ? ev.match(new RegExp(`^part:${part}\\.(\\w+)`)) : null;
        const pin = m ? names.get(m[1]) : undefined;
        if (!pin || !ev.includes("strapping")) continue;
        for (const pad of pads(pin)) if (!out.some((x) => x.ref === ref && x.pad === pad)) out.push({ ref, pad, kind: "warn", rung: r.rung, text: `${pin} is a boot-strapping pin: its level at reset selects boot behaviour.` });
      }
    }
  }
  return out;
}

/** Extent of everything drawn (the module's antenna end hangs over the top edge). */
export function boundsOf(g: BoardGeometry): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = 0;
  let y0 = 0;
  let x1 = g.width;
  let y1 = g.height;
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const fp of g.footprints)
    for (const gr of fp.graphics) {
      grow(gr.p[0], gr.p[1]);
      if (gr.k === "line" || gr.k === "rect") grow(gr.p[2], gr.p[3]);
    }
  return { x0, y0, x1, y1 };
}

export const LAYOUT_BASE = "/boards";
