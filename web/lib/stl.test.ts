import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStl } from "./stl";

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe("STL reader", () => {
  it("reads the real Matter plate (test fixture): ~mm extents, 2 mm thick", () => {
    const m = parseStl(ab(readFileSync(resolve(__dirname, "__fixtures__/m_eval_1.plate.stl"))));
    expect(m.count).toBeGreaterThan(100);
    expect(m.min[0]).toBeGreaterThanOrEqual(0);
    expect(m.max[0]).toBeLessThanOrEqual(60.001);
    expect(m.max[2] - m.min[2]).toBeCloseTo(2, 3);
  });

  it("reads a one-triangle ASCII STL and rejects junk", () => {
    const ascii = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
    expect(parseStl(ab(Buffer.from(ascii))).count).toBe(1);
    expect(() => parseStl(ab(Buffer.from("hello")))).toThrow();
    expect(() => parseStl(ab(Buffer.from("solid x\nvertex 1 2\n")))).toThrow();
  });
});
