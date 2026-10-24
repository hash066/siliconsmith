import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bomCsvText, bomOf, categoryOf, filterParts, usable, type LibPart } from "./parts-library";

const dir = join(__dirname, "..", "..", "engine", "siliconsmith", "board");
const ids = ["esp32", "bme280", "ldo33", "mcp73831", "usbc", "batt", "res", "led", "btn", "load", "std_i2c"];
// the real part files, shaped like the API summary
const parts: LibPart[] = ids.map((id) => {
  const p = JSON.parse(readFileSync(join(dir, "parts", `${id}.json`), "utf8"));
  return { id: p.id, name: p.name, kind: p.kind, package: p.package, description: p.description, pin_table_checked: !!p.pin_table_provenance?.citation_checked, pins: p.pins ?? [], facts: [] };
});
const design = JSON.parse(readFileSync(join(dir, "templates", "clean_sensor.json"), "utf8")).design;

describe("part library", () => {
  it("hides placeholders and groups the rest", () => {
    expect(usable(parts).map((p) => p.id)).not.toContain("load");
    expect(usable(parts).map((p) => p.id)).not.toContain("std_i2c");
    const cat = Object.fromEntries(usable(parts).map((p) => [p.id, categoryOf(p)]));
    expect(cat).toMatchObject({ esp32: "ics", bme280: "ics", ldo33: "power", mcp73831: "power", res: "passives", led: "passives", usbc: "connectors", batt: "connectors" });
  });
  it("filters by category and text", () => {
    expect(filterParts(parts, "power", "").map((p) => p.id).sort()).toEqual(["ldo33", "mcp73831"]);
    expect(filterParts(parts, "all", "esp32").map((p) => p.id)).toEqual(["esp32"]);
    expect(filterParts(parts, "passives", "zzz")).toEqual([]);
    expect(filterParts(parts, "all", "  LGA ").map((p) => p.id)).toEqual(["bme280"]);
  });
});

describe("BOM of the real clean_sensor design", () => {
  const rows = bomOf(design, parts);
  it("groups identical parts and values, in reference order", () => {
    expect(rows.reduce((n, r) => n + r.refs.length, 0)).toBe(design.instances.length);
    const r4k7 = rows.find((r) => r.part === "res" && r.value === "4.7k")!;
    expect(r4k7.refs).toEqual(["R1", "R2"]);
    expect(rows[0].refs[0]).toBe("D1");
  });
  it("writes CSV that quotes what needs quoting", () => {
    const csv = bomCsvText([{ refs: ["R1", "R2"], part: "res", value: "4.7k", name: 'Resistor, "generic"', package: "0603" }]);
    expect(csv.split("\n")[1]).toBe('R1 R2,2,"Resistor, ""generic""",4.7k,0603');
  });
  it("a design with no parts has an empty BOM", () => {
    expect(bomOf(null, parts)).toEqual([]);
  });
});
