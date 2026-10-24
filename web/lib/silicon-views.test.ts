import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hex32, layerNetlist, matches, parseViews } from "./silicon-views";

// A real file: views/instruction.json from a live run on the public site (TinyMaix dot product, Nemotron-proposed dot4).
const real = readFileSync(join(__dirname, "__fixtures__", "silicon-views-live.json"), "utf8");

describe("instruction views from a real live run", () => {
  const v = parseViews(real)!;
  it("parses", () => {
    expect(v).not.toBeNull();
    expect(v.cells.map((c) => c.type).sort()).toEqual(["$add", "$add", "$add", "$mul", "$mul", "$mul", "$mul"]);
    expect(v.gate_total).toBeGreaterThan(1000);
    expect(v.depth).toBeGreaterThan(10);
    expect(Object.keys(v.ports).sort()).toEqual(["rd", "rs1", "rs2"]);
  });
  it("lays the real netlist out: inputs, four multipliers, an adder tree, the result", () => {
    const g = layerNetlist(v);
    const byLayer = (l: number) => g.nodes.filter((n) => n.layer === l).map((n) => n.label.split("  ")[1] ?? n.label).sort();
    expect(byLayer(0)).toEqual(["rs1", "rs2"]);
    expect(byLayer(1)).toEqual(["multiply", "multiply", "multiply", "multiply"]);
    expect(g.nodes.filter((n) => n.kind === "out").map((n) => n.id)).toEqual(["out:rd"]);
    // every multiplier reads both inputs; the result is driven by exactly one cell
    for (const m of g.nodes.filter((n) => n.label.includes("multiply"))) expect(g.edges.filter((e) => e.to === m.id).map((e) => e.from).sort()).toEqual(["in:rs1", "in:rs2"]);
    expect(g.edges.filter((e) => e.to === "out:rd")).toHaveLength(1);
    // the adders sit deeper than the multipliers that feed them
    const layer = new Map(g.nodes.map((n) => [n.id, n.layer]));
    for (const e of g.edges) expect(layer.get(e.to)!).toBeGreaterThan(layer.get(e.from)!);
  });
  it("the simulated operand pairs agree with the C reference", () => {
    expect(v.rows.length).toBeGreaterThanOrEqual(6);
    expect(v.rows.every(matches)).toBe(true);
    expect(v.rows.some((r) => r[0] === 0x01020304 && r[2] === 10)).toBe(true); // 1*1 + 2*1 + 3*1 + 4*1
  });
});

describe("parseViews is strict about what it accepts", () => {
  it("rejects anything that is not the expected shape", () => {
    expect(parseViews(undefined)).toBeNull();
    expect(parseViews("not json")).toBeNull();
    expect(parseViews("[]")).toBeNull();
    expect(parseViews(JSON.stringify({ ports: {}, cells: [] }))).toBeNull();
  });
  it("drops malformed cells and rows instead of crashing", () => {
    const v = parseViews(JSON.stringify({ name: "x", ports: {}, cells: [{ type: "$add", conn: {}, dirs: {}, name: "a", params: {} }, { nope: 1 }], rows: [[1, 2, 3, 4], [1, 2], ["a", 1, 2, 3]] }))!;
    expect(v.cells).toHaveLength(1);
    expect(v.rows).toEqual([[1, 2, 3, 4]]);
  });
  it("a netlist loop does not hang the layout", () => {
    const v = parseViews(JSON.stringify({ name: "x", ports: { a: { dir: "input", bits: [2] }, y: { dir: "output", bits: [4] } }, rows: [], cells: [{ name: "c1", type: "$add", params: {}, dirs: { A: "input", Y: "output" }, conn: { A: [3], Y: [4] } }, { name: "c2", type: "$add", params: {}, dirs: { A: "input", Y: "output" }, conn: { A: [4], Y: [3] } }] }))!;
    expect(layerNetlist(v).nodes.length).toBe(4);
  });
});

describe("formatting", () => {
  it("hex is padded and unsigned", () => {
    expect(hex32(10)).toBe("0000000a");
    expect(hex32(-4)).toBe("fffffffc");
    expect(matches([1, 1, -4, 0xfffffffc])).toBe(true);
    expect(matches([1, 1, 1, 2])).toBe(false);
  });
});
