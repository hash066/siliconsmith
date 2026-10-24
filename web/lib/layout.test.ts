import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boundsOf, canonicalNetlist, findLayout, markersFor, type BoardGeometry, type LayoutIndex, type LayoutSummary } from "./layout";

const root = join(__dirname, "..");
const boards = (...p: string[]) => join(root, "public", "boards", ...p);
const index: LayoutIndex = JSON.parse(readFileSync(boards("index.json"), "utf8"));
const template = (id: string) => JSON.parse(readFileSync(join(root, "..", "engine", "siliconsmith", "board", "templates", `${id}.json`), "utf8")).design;
const summary = (dir: string): LayoutSummary => JSON.parse(readFileSync(boards(dir, "summary.json"), "utf8"));
const geom = (dir: string): BoardGeometry => JSON.parse(readFileSync(boards(dir, "board.json"), "utf8"));

describe("netlist key", () => {
  it("is the same text the engine produced, for every template", () => {
    for (const v of Object.values(index.layouts)) for (const t of v.templates) expect(canonicalNetlist(template(t))).toBe(v.canonical);
  });
  it("ignores the firmware pin table and finds the board for the clean and the fault example", () => {
    const clean = findLayout(index, template("clean_sensor"));
    const fault = findLayout(index, template("fault_gpio12_vs_gpio14"));
    const strap = findLayout(index, template("fault_strapping_pin"));
    expect(clean?.dir).toBeTruthy();
    expect(fault?.dir).toBe(clean?.dir);
    expect(strap?.dir).toBeTruthy();
    expect(strap?.dir).not.toBe(clean?.dir);
  });
  it("finds nothing for a design with a different netlist, or no design", () => {
    const d = template("clean_sensor");
    d.nets[0].pins = [...d.nets[0].pins, "R1.2"];
    expect(findLayout(index, d)).toBeNull();
    expect(findLayout(index, null)).toBeNull();
    expect(findLayout(null, template("clean_sensor"))).toBeNull();
  });
});

describe("markers on the board", () => {
  it("firmware on GPIO12 but wired to GPIO14: a fail on pad 14 and a 'wired here' on pad 13", () => {
    const m = markersFor(template("fault_gpio12_vs_gpio14"), summary("fault_gpio12_vs_gpio14"), null);
    expect(m.map((x) => `${x.kind}:${x.pad}`).sort()).toEqual(["fail:14", "wired:13"]);
    expect(m.find((x) => x.kind === "fail")?.text).toContain("wake_btn");
  });
  it("a clean design has none, and fixing the firmware pin removes them", () => {
    expect(markersFor(template("clean_sensor"), summary("clean_sensor"), null)).toEqual([]);
    const d = template("fault_gpio12_vs_gpio14");
    const row = d.firmware_pins.find((p: { function: string }) => p.function === "wake_btn");
    row.pin = "GPIO14";
    expect(markersFor(d, summary("fault_gpio12_vs_gpio14"), null)).toEqual([]);
  });
  it("a strapping-pin finding from the check lands on that pin's pad", () => {
    const check = { rungs: [{ rung: "B4", status: "fail", evidence: ["part:esp32.gpio12.strapping", "part:esp32.gpio12"] }] };
    const m = markersFor(template("fault_strapping_pin"), summary("fault_strapping_pin"), check);
    expect(m.some((x) => x.kind === "warn" && x.pad === "14")).toBe(true);
  });
});

describe("the generated boards", () => {
  it.each(["clean_sensor", "fault_gpio12_vs_gpio14", "fault_strapping_pin"])("%s: routed, no KiCad errors, geometry present", (dir) => {
    const s = summary(dir);
    expect(s.stats.fully_routed).toBe(true);
    expect(s.drc.errors).toBe(0);
    const g = geom(dir);
    expect(g.tracks.length).toBeGreaterThan(50);
    expect(g.zones.length).toBeGreaterThan(0);
    expect(g.footprints.length).toBe(s.stats.parts);
    const b = boundsOf(g);
    expect(b.y0).toBeLessThan(0); // the antenna end hangs over the top edge
    expect(b.x1).toBeGreaterThanOrEqual(g.width);
  });
});
