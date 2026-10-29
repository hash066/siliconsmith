import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { presentRefs, STOPS, tiltOf } from "./board-explorer";

const board = JSON.parse(readFileSync(new URL("../public/boards/clean_sensor/board.json", import.meta.url), "utf8")) as { footprints: Array<{ ref: string }> };
const refs = board.footprints.map((f) => f.ref);

describe("board explorer", () => {
  it("every ref in the tour exists on the real board, and every part is covered once", () => {
    for (const s of STOPS) expect(presentRefs(s, refs)).toEqual(s.refs);
    const all = STOPS.flatMap((s) => s.refs).sort();
    expect(all).toEqual([...refs].sort());
  });
  it("labels are short and unique", () => {
    expect(new Set(STOPS.map((s) => s.label)).size).toBe(STOPS.length);
    for (const s of STOPS) expect(s.label.length).toBeLessThanOrEqual(20);
  });
  it("tilts with the pointer and not at all for reduced motion", () => {
    expect(tiltOf(0.5, 0.5, false)).toEqual({ rx: 0, ry: 0 });
    expect(tiltOf(1, 0, false).ry).toBeGreaterThan(0);
    expect(tiltOf(1, 0, false).rx).toBeGreaterThan(0);
    expect(tiltOf(9, -9, false).ry).toBe(9);
    expect(tiltOf(1, 0, true)).toEqual({ rx: 0, ry: 0 });
  });
});
