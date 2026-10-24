// KiCad's text design-rule report -> a list of findings with where on the board they are. Mirrors engine/siliconsmith/board/layout/runner.py
// (parse_drc) and adds the locations. KiCad reports positions in its sheet frame; our boards sit at (100, 80) mm there (pcb_build.py OX, OY).

export const SHEET_OX = 100;
export const SHEET_OY = 80;
/** Checks that say nothing about a board made from KiCad's own libraries (see runner.py). */
const IGNORED = new Set(["lib_footprint_issues", "lib_footprint_mismatch"]);

export interface DrcItem {
  text: string;
  x: number;
  y: number;
}
export interface DrcFinding {
  type: string;
  severity: "error" | "warning";
  description: string;
  items: DrcItem[];
}

export function parseDrcReport(text: string): DrcFinding[] {
  const out: DrcFinding[] = [];
  for (const blk of text.split(/^(?=\[\w+\]: )/m)) {
    const h = blk.match(/^\[(\w+)\]: (.*)/);
    if (!h || IGNORED.has(h[1])) continue;
    const sev = blk.match(/Severity: (\w+)/);
    const items: DrcItem[] = [];
    for (const m of blk.matchAll(/@\(([-\d.]+) mm, ([-\d.]+) mm\): ([^\n]*)/g)) items.push({ x: Number(m[1]) - SHEET_OX, y: Number(m[2]) - SHEET_OY, text: m[3].trim() });
    out.push({ type: h[1], severity: sev?.[1] === "warning" ? "warning" : "error", description: h[2].trim(), items });
  }
  return out;
}

export function groupByType(findings: DrcFinding[]): Array<{ type: string; severity: "error" | "warning"; description: string; list: DrcFinding[] }> {
  const m = new Map<string, DrcFinding[]>();
  for (const f of findings) m.set(`${f.severity}:${f.type}`, [...(m.get(`${f.severity}:${f.type}`) ?? []), f]);
  return [...m.entries()]
    .map(([, list]) => ({ type: list[0].type, severity: list[0].severity, description: list[0].description, list }))
    .sort((a, b) => (a.severity === b.severity ? b.list.length - a.list.length : a.severity === "error" ? -1 : 1));
}

export const DRC_WORDS: Record<string, string> = {
  silk_overlap: "Silkscreen text overlaps other silkscreen",
  silk_over_copper: "Silkscreen sits over bare copper",
  silk_edge_clearance: "Silkscreen is clipped by the board edge",
  copper_edge_clearance: "Copper is too close to the board edge",
  clearance: "Two copper items are too close",
  unconnected_items: "A connection is missing",
  courtyards_overlap: "Two parts' courtyards overlap",
  track_width: "A track is narrower than the minimum",
  via_diameter: "A via is smaller than the minimum",
  hole_clearance: "A hole is too close to copper",
  items_not_allowed: "Something is inside a keep-out area",
  starved_thermal: "A pad's connection to the pour is too thin",
};
