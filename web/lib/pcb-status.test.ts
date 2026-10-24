import { describe, expect, it } from "vitest";
import { formatMm, onBoard, pointerToBoard, zoomPercent } from "./pcb-status";

const full = { x: -2, y: -2, w: 52, h: 40 };

describe("pcb status", () => {
  it("zoom is relative to the whole-board view", () => {
    expect(zoomPercent(full, full)).toBe(100);
    expect(zoomPercent(full, { ...full, w: 26 })).toBe(200);
    expect(zoomPercent(full, { ...full, w: 62.4 })).toBe(83);
  });

  it("maps a pointer to board millimetres", () => {
    const box = { left: 100, top: 50, width: 520, height: 400 };
    expect(pointerToBoard(full, box, 100, 50)).toEqual({ x: -2, y: -2 });
    expect(pointerToBoard(full, box, 360, 250)).toEqual({ x: 24, y: 18 });
    expect(pointerToBoard(full, { ...box, width: 0 }, 1, 1)).toBeNull();
  });

  it("knows the board from its margin and formats the readout", () => {
    expect(onBoard({ x: 10, y: 10 }, { width: 48, height: 36 })).toBe(true);
    expect(onBoard({ x: -1, y: 10 }, { width: 48, height: 36 })).toBe(false);
    expect(formatMm({ x: 1.234, y: 5 })).toBe("X 1.23  Y 5.00 mm");
    expect(formatMm(null)).toContain("–");
  });
});
