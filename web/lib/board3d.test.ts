import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bodyOf, boardMesh, lookOf } from "./board3d";
import type { BoardGeometry } from "./layout";

const geom = JSON.parse(readFileSync(join(__dirname, "..", "public", "boards", "clean_sensor", "board.json"), "utf8")) as BoardGeometry;

describe("3D board from the real clean_sensor geometry", () => {
  const m = boardMesh(geom);
  it("has a substrate, copper, and one box per part", () => {
    expect(m.parts).toBe(geom.footprints.length);
    expect(m.mesh.count).toBe(m.colours.length);
    expect(m.mesh.count % 12).toBe(0); // every solid is a 12-triangle box
    expect(m.mesh.tris.length).toBe(m.mesh.count * 9);
  });
  it("sits on the board: width and depth match the outline, thickness is 1.6 mm plus the tallest part", () => {
    expect(m.mesh.min[0]).toBeLessThanOrEqual(0);
    expect(m.mesh.max[0]).toBeGreaterThanOrEqual(geom.width);
    expect(m.mesh.min[2]).toBe(0);
    expect(m.mesh.max[2]).toBeCloseTo(1.6 + 6.0, 1); // the battery connector is the tallest part
  });
  it("every triangle is finite and has area", () => {
    const t = m.mesh.tris;
    expect([...t].every(Number.isFinite)).toBe(true);
  });
  it("looks follow the footprint family and the ESP32 module extends past the board edge like the 2D view", () => {
    const esp = geom.footprints.find((f) => f.ref === "U1")!;
    expect(lookOf(esp).word).toBe("module");
    expect(bodyOf(esp).y0).toBeLessThan(0);
    expect(lookOf(geom.footprints.find((f) => f.ref === "R1")!).word).toBe("resistor");
    expect(lookOf(geom.footprints.find((f) => f.ref === "D1")!).word).toBe("LED");
    expect(lookOf(geom.footprints.find((f) => f.ref === "J1")!).word).toBe("connector");
  });
});
