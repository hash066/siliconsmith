import { describe, expect, it } from "vitest";
import type { BoardCheck, MatterSimulation } from "@/lib/hosted";
import { initialRunState } from "@/lib/run-state";
import { blockDiagram } from "./blocks";
import { COACH_STEPS, holePath, placeCard } from "./coach";
import { bomCsv, bomOf, kicadNetlist } from "./netlist";
import { EXAMPLES, resolveWorkbench, routePrompt } from "./route";
import { failureMessage, parseBundle } from "./useSiliconLive";
import { boardChecks, boardVerdict, matterChecks, matterVerdict, siliconVerdict } from "./verdict";
import { bytesOf, fromBundle } from "./files";

const design = {
  mcu_ref: "U1",
  instances: [{ ref: "U1", part: "esp32" }, { ref: "U2", part: "ldo33" }, { ref: "U3", part: "bme280" }, { ref: "J1", part: "usbc" }, { ref: "R1", part: "res" }, { ref: "R2", part: "res" }],
  nets: [{ name: "GND", pins: ["U1.GND", "U2.GND"] }, { name: "3V3", pins: ["U2.VOUT", "U1.3V3", "U3.VDD", "R1.1", "R2.1"] }, { name: "VBUS", pins: ["J1.VBUS", "U2.VIN"] }, { name: "SDA", pins: ["U1.GPIO21", "U3.SDI", "R1.2"] }],
};

describe("routing a first prompt", () => {
  it("routes by wording", () => {
    expect(routePrompt("A heat sink for a 5 W chip, 40 mm square, under 70 C.")).toBe("matter");
    expect(routePrompt("A battery ESP32 sensor board with a BME280 and USB-C charging; check it against its firmware.")).toBe("board");
    expect(routePrompt("Make this loop faster with a custom RISC-V instruction.")).toBe("silicon");
  });
  it("a chip overrides the wording and an unclear prompt falls back honestly", () => {
    expect(resolveWorkbench("heat sink", "board")).toEqual({ wb: "board", picked: "chip" });
    expect(resolveWorkbench("hello there", "auto")).toEqual({ wb: "board", picked: "default" });
    expect(resolveWorkbench("a faster loop", "auto").picked).toBe("wording");
  });
  it("every example routes to its own workbench", () => {
    expect(EXAMPLES.map((e) => e.wb).sort()).toEqual(["board", "matter", "silicon"]);
    for (const e of EXAMPLES) expect(routePrompt(e.prompt)).toBe(e.wb);
  });
});

describe("plain verdicts follow the real result", () => {
  const rung = (id: string, status: string, label: string | null = null, detail = "") => ({ id, status, label, check: "tool", detail });
  const sim = (ladder: ReturnType<typeof rung>[], over: Partial<MatterSimulation> = {}) =>
    ({ ladder, first_failure: ladder.find((r) => r.status === "fail")?.id ?? null, metrics: { peak_temp_c: 61.2, material_fraction: 0.35 }, viewer: { field: { peak: 61.2 } }, baselines: { equal_material: { delta_k: 1.3, peak_temp_c: 62.5, cells: 1, params: {} }, full_budget: { delta_k: 0.4, peak_temp_c: 61.6, cells: 1, params: {} } }, verdict: { label: "Beats", delta_equal_material_k: 1.3 }, ...over }) as unknown as MatterSimulation;
  const all = (s: string) => ["M1", "M2", "M3", "M4", "M5"].map((id) => rung(id, s, "ok"));
  it("Matter: green when every check passed, with the plain comparison", () => {
    const v = matterVerdict({ sim: sim(all("pass")), busy: false, stale: false, failed: null });
    expect(v.tone).toBe("green");
    expect(v.title).toContain("61.2 °C");
    expect(v.title).toContain("1.30 K cooler than plain fins");
  });
  it("Matter: not beating plain fins is amber, not red", () => {
    const l = all("pass");
    l[4] = rung("M5", "fail", null, "Does not beat the baseline");
    const v = matterVerdict({ sim: sim(l, { verdict: null, baselines: { equal_material: { delta_k: -3.2, peak_temp_c: 1, cells: 1, params: {} }, full_budget: { delta_k: -1, peak_temp_c: 1, cells: 1, params: {} } } } as Partial<MatterSimulation>), busy: false, stale: false, failed: null });
    expect(v.tone).toBe("amber");
    expect(v.title).toContain("no better than plain fins");
  });
  it("Matter: a failed validity check is red; a rejected shape says nothing was solved", () => {
    const l = all("pass");
    l[2] = rung("M3", "fail", null, "Too thin to print");
    expect(matterVerdict({ sim: sim(l), busy: false, stale: false, failed: null }).tone).toBe("red");
    const rejected = sim(all("skipped"), { metrics: {}, viewer: { field: null } as never, first_failure: "M2" });
    const v = matterVerdict({ sim: rejected, busy: false, stale: false, failed: null });
    expect(v.tone).toBe("red");
    expect(v.title).toBe("This shape was rejected");
  });
  it("Matter: idle, working and a stale result are labelled", () => {
    expect(matterVerdict({ sim: null, busy: false, stale: false, failed: null }).tone).toBe("idle");
    expect(matterVerdict({ sim: null, busy: true, stale: false, failed: null }).tone).toBe("working");
    expect(matterVerdict({ sim: sim(all("pass")), busy: false, stale: true, failed: null }).title).toContain("settings changed");
  });
  const check = (statuses: string[]) => ({ rungs: statuses.map((s, i) => ({ rung: `B${i + 1}`, status: s, label: s === "pass" ? "fine" : null, detail: s === "fail" ? "wake_btn: firmware says GPIO12, netlist wires GPIO14" : "", evidence: [], findings: [] })), ladder: [], evidence: {}, passed: !statuses.includes("fail"), header: "", labels: [], notice: "", ok: true }) as unknown as BoardCheck;
  it("Board: red with the failing check named in plain words, amber when undecided, green when all pass", () => {
    const red = boardVerdict({ check: check(["pass", "pass", "pass", "fail", "pass"]), busy: false, stale: false, failed: null });
    expect(red.tone).toBe("red");
    expect(red.title).toBe("1 of 5 checks failed");
    expect(red.detail).toBe("Firmware pins match the board");
    expect(boardVerdict({ check: check(["pass", "unknown", "pass", "pass", "pass"]), busy: false, stale: false, failed: null }).tone).toBe("amber");
    expect(boardVerdict({ check: check(["pass", "pass", "pass", "pass", "pass"]), busy: false, stale: false, failed: null }).tone).toBe("green");
    expect(boardVerdict({ check: null, busy: false, stale: false, failed: "offline" }).tone).toBe("red");
  });
  it("Board cards carry the real sentence for a failure", () => {
    const cards = boardChecks(check(["pass", "pass", "pass", "fail", "pass"]));
    expect(cards[3]).toMatchObject({ state: "fail", title: "Firmware pins match the board" });
    expect(cards[3].sentence).toContain("GPIO12");
    expect(matterChecks(sim(all("pass")))[4].title).toBe("It beats plain fins");
  });
  it("Silicon: idle, running, failed", () => {
    const s = initialRunState();
    expect(siliconVerdict({ phase: "idle", state: s, error: null }).tone).toBe("idle");
    expect(siliconVerdict({ phase: "running", state: s, error: null }).tone).toBe("working");
    expect(siliconVerdict({ phase: "failed", state: s, error: "out of credits" })).toMatchObject({ tone: "red", detail: "out of credits" });
    expect(siliconVerdict({ phase: "done", state: s, error: null }).tone).toBe("amber");
  });
});

describe("downloads are derived from the real design", () => {
  it("bom groups parts and counts them", () => {
    expect(bomOf(design)).toEqual([{ part: "bme280", qty: 1, refs: ["U3"] }, { part: "esp32", qty: 1, refs: ["U1"] }, { part: "ldo33", qty: 1, refs: ["U2"] }, { part: "res", qty: 2, refs: ["R1", "R2"] }, { part: "usbc", qty: 1, refs: ["J1"] }]);
    expect(bomCsv(design).split("\n")[0]).toBe("part,quantity,references");
    expect(bomCsv(design)).toContain('res,2,"R1 R2"');
  });
  it("the netlist lists every part and net with its pins", () => {
    const n = kicadNetlist(design);
    expect(n).toContain('(comp (ref "U1") (value "esp32")');
    expect(n).toContain('(name "SDA")');
    expect(n).toContain('(node (ref "U3") (pin "SDI"))');
    expect((n.match(/\(comp /g) ?? []).length).toBe(6);
    expect((n.match(/\(net /g) ?? []).length).toBe(4);
  });
  it("sizes and bundle files", () => {
    expect(bytesOf({ name: "a", mime: "text/plain", note: "", text: "héllo" })).toBe(6);
    expect(bytesOf({ name: "a", mime: "x", note: "", base64: "AAAA" })).toBe(3);
    expect(fromBundle([{ path: "rtl/dot4.v", text: "module x;" }])[0]).toMatchObject({ name: "dot4.v", note: "rtl/dot4.v" });
  });
});

describe("block diagram", () => {
  it("draws blocks for the real groups and links between them; rails are power links", () => {
    const g = blockDiagram(design);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["mcu", "passive", "power", "sensor", "usb"]);
    expect(g.links.some((l) => l.kind === "signal" && l.label.includes("SDA"))).toBe(true);
    expect(g.links.some((l) => l.kind === "power" && l.label.includes("3V3"))).toBe(true);
    expect(g.links.every((l) => g.nodes.some((n) => n.id === l.a) && g.nodes.some((n) => n.id === l.b))).toBe(true);
  });
});

describe("live Silicon stream", () => {
  it("reads a bundle given as an array or as a map, and ignores junk", () => {
    expect(parseBundle({ files: [{ path: "a.v", content: "x" }, { path: "b.bin", content: "AAAA", encoding: "base64" }, { nope: 1 }, null] })).toEqual([{ path: "a.v", text: "x", base64: undefined }, { path: "b.bin", text: undefined, base64: "AAAA" }]);
    expect(parseBundle({ files: { "report.md": "# ok" } })).toEqual([{ path: "report.md", text: "# ok" }]);
    expect(parseBundle({})).toEqual([]);
    expect(parseBundle(null)).toEqual([]);
  });
  it("says plainly when the endpoint is missing or credits are out", () => {
    expect(failureMessage(404, null)).toContain("not enabled");
    expect(failureMessage(402, null)).toContain("credits");
    expect(failureMessage(500, { message: "boom" })).toBe("boom");
  });
});

describe("coach marks", () => {
  it("are three, in order, each pointing at something on the workspace", () => {
    expect(COACH_STEPS.map((s) => s.id)).toEqual(["chat", "tabs", "advanced"]);
  });
  it("keep the card inside the viewport at phone and desktop sizes", () => {
    for (const [vw, vh] of [[360, 640], [390, 800], [1440, 900]]) {
      for (const t of [{ x: 0, y: 100, w: vw, h: 500 }, { x: vw - 100, y: 10, w: 90, h: 36 }, null]) {
        const p = placeCard(t, { w: 300, h: 170 }, vw, vh);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + 300).toBeLessThanOrEqual(vw);
        expect(p.y + 170).toBeLessThanOrEqual(vh);
      }
    }
    expect(holePath({ x: 1, y: 1, w: 5, h: 5 }, 100, 100)).toContain("evenodd");
  });
});
