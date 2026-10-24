import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupByType, parseDrcReport } from "./drc";

const real = readFileSync(join(__dirname, "..", "public", "boards", "clean_sensor", "drc.txt"), "utf8");

describe("KiCad DRC report", () => {
  const f = parseDrcReport(real);
  it("the real clean board has no errors and only silkscreen warnings, each with a place on the board", () => {
    expect(f.filter((x) => x.severity === "error")).toEqual([]);
    expect(f.length).toBeGreaterThan(5);
    expect(new Set(f.map((x) => x.type))).toEqual(new Set(["silk_overlap", "silk_over_copper", "silk_edge_clearance"]));
    for (const x of f) {
      expect(x.items.length).toBeGreaterThan(0);
      for (const it of x.items) expect(it.x > -10 && it.x < 70 && it.y > -10 && it.y < 70, `${x.type} at ${it.x},${it.y}`).toBe(true); // board coordinates, not sheet ones
    }
  });
  it("groups by type, errors first, biggest first", () => {
    const g = groupByType(f);
    expect(g.map((x) => x.list.length)).toEqual([...g.map((x) => x.list.length)].sort((a, b) => b - a));
  });
  it("reads errors and converts the sheet frame, and ignores the library-table check", () => {
    const t = `[lib_footprint_issues]: nothing\n    Severity: error\n[clearance]: Clearance violation\n    Rule: x; Severity: error\n    @(121.5000 mm, 96.0000 mm): Track [GND] on F.Cu\n`;
    const r = parseDrcReport(t);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "clearance", severity: "error" });
    expect(r[0].items[0]).toMatchObject({ x: 21.5, y: 16 });
  });
});
