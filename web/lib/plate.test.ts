import { describe, expect, it } from "vitest";
import type { MatterViewer } from "./hosted";
import { buildPlate, heatColor } from "./plate";

const viewer = (mask: string[], T: Array<Array<number | null>>): MatterViewer => ({
  format: "matter-candidate/1",
  n: mask.length,
  dx_mm: 1,
  thickness_mm: 2,
  chip: [0, 1, 0, 1],
  mask,
  field: { n: mask.length, units: "degC", T_inf: 25, peak: 60, T },
});

describe("plate geometry from a matter-candidate/1 artifact", () => {
  it("one isolated cell is a box: top plus four sides, 10 triangles, all at that cell's temperature", () => {
    const p = buildPlate(viewer(["000", "010", "000"], [[null, null, null], [null, 60, null], [null, null, null]]));
    expect(p.cells).toBe(1);
    expect(p.mesh.count).toBe(10);
    expect([...p.temps].every((t) => t === 60)).toBe(true);
    expect(p.tMin).toBe(60);
  });

  it("two neighbouring cells share no wall between them", () => {
    const p = buildPlate(viewer(["000", "011", "000"], [[null, null, null], [null, 40, 50], [null, null, null]]));
    // 2 tops + 3 outer sides each = (1 + 3) * 2 quads * 2 triangles
    expect(p.mesh.count).toBe(16);
    expect(p.tMin).toBe(40);
    expect(p.tMax).toBe(50);
  });

  it("skips a masked cell that has no temperature instead of inventing one", () => {
    const p = buildPlate(viewer(["11"], [[30, null]]));
    expect(p.cells).toBe(1);
  });

  it("colour ramp is clamped and monotonic in brightness at the ends", () => {
    expect(heatColor(-1)).toEqual(heatColor(0));
    expect(heatColor(2)).toEqual(heatColor(1));
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    expect(lum(heatColor(1))).toBeGreaterThan(lum(heatColor(0.5)));
    expect(lum(heatColor(0.5))).toBeGreaterThan(lum(heatColor(0)));
  });
});
