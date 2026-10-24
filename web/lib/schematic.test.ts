import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isGround, schematicOf, type DesignIn } from "./schematic";

const template = (id: string): DesignIn => JSON.parse(readFileSync(join(__dirname, "..", "..", "engine", "siliconsmith", "board", "templates", `${id}.json`), "utf8")).design;
const symbols = (d: DesignIn) => schematicOf(d).sections.flatMap((s) => s.symbols);

describe("schematic from the real netlists", () => {
  const d = template("clean_sensor");
  const s = schematicOf(d);
  it("has one symbol per part, grouped into sections in a fixed order", () => {
    expect(symbols(d).map((x) => x.ref).sort()).toEqual(d.instances.map((i) => i.ref).sort());
    expect(s.sections.map((x) => x.title)).toEqual(["Power", "Controller", "Sensors", "Passives and controls"]);
  });
  it("every connection in the netlist appears as a labelled pin on the right symbol", () => {
    const by = new Map(symbols(d).map((x) => [x.ref, x]));
    for (const n of d.nets)
      for (const p of n.pins) {
        const [ref, pin] = [p.slice(0, p.indexOf(".")), p.slice(p.indexOf(".") + 1)];
        const found = by.get(ref)!.pins.find((q) => q.name === pin);
        expect(found?.net, `${p}`).toBe(n.name);
      }
  });
  it("supply pins go on top, ground pins at the bottom, and two-terminal parts get two pins", () => {
    const u2 = symbols(d).find((x) => x.ref === "U2")!;
    expect(u2.pins.filter((p) => p.side === "top").map((p) => p.name).sort()).toEqual(["VIN", "VOUT"]);
    expect(u2.pins.find((p) => p.name === "GND")?.side).toBe("bottom");
    const r1 = symbols(d).find((x) => x.ref === "R1")!;
    expect(r1.kind).toBe("resistor");
    expect(r1.pins.map((p) => p.side).sort()).toEqual(["left", "right"]);
    expect(r1.value).toMatch(/k$|^\d+/);
  });
  it("no two symbols overlap and everything fits the sheet", () => {
    const boxes = symbols(d).map((x) => ({ ref: x.ref, x0: x.x - 92, y0: x.y - 18, x1: x.x + x.w + 92, y1: x.y + x.h + 18 }));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].x1).toBeLessThanOrEqual(s.width + 1);
      expect(boxes[i].y1).toBeLessThanOrEqual(s.height);
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1, `${a.ref} overlaps ${b.ref}`).toBe(false);
      }
    }
  });
});

describe("the firmware mismatch is marked on the controller", () => {
  it("fault example: GPIO12 is where firmware expects the button, GPIO14 is where it is wired", () => {
    const d = template("fault_gpio12_vs_gpio14");
    const u1 = symbols(d).find((x) => x.ref === "U1")!;
    const fail = u1.pins.find((p) => p.mark?.kind === "fail")!;
    const wired = u1.pins.find((p) => p.mark?.kind === "wired")!;
    expect(fail.name).toBe("GPIO12");
    expect(fail.net).toBe(""); // not connected on the board: only the firmware expects it
    expect(wired.name).toBe("GPIO14");
    expect(wired.net).not.toBe("");
  });
  it("the clean example has no marks", () => {
    expect(symbols(template("clean_sensor")).flatMap((x) => x.pins).filter((p) => p.mark)).toEqual([]);
  });
});

describe("helpers", () => {
  it("knows ground nets", () => {
    expect(isGround("GND")).toBe(true);
    expect(isGround("AGND")).toBe(true);
    expect(isGround("3V3")).toBe(false);
  });
});
