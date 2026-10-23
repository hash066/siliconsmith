import { describe, expect, it } from "vitest";
import { defaultSimulateInput, type BoardCheck, type MatterSimulation } from "@/lib/hosted";
import { LOADING_CREDITS, NO_CREDITS, pillText, usd2, viewCredits } from "./credits";
import { workstationRedirect } from "./redirect";
import { groupOf, layoutGrouped } from "./FunctionGraph";
import { COACH_STEPS, holePath, placeCard } from "./coach";
import { parseUiAction } from "./ui-actions";
import { summarizeCheck } from "./useBoardBench";
import { mergeMatterParams, summarizeSim } from "./useMatterBench";

describe("credits view", () => {
  it("never invents a balance", () => {
    expect(viewCredits({ credits: null, loading: false })).toEqual(NO_CREDITS);
    expect(viewCredits({ credits: null, loading: true })).toEqual(LOADING_CREDITS);
    expect(pillText(NO_CREDITS)).toBe("Credits: offline");
    expect(pillText(NO_CREDITS, true)).toBe("Offline");
  });
  it("shows what the server reports, with the pool state and the honest scope", () => {
    const c = viewCredits({ credits: { allowanceUsd: 0.5, spentUsd: 0.1, remainingUsd: 0.4, pool: { capUsd: 25, spentUsd: 25 }, scope: "per server instance, in memory" }, loading: false });
    expect(c.mode).toBe("ready");
    expect(c.remainingUsd).toBe(0.4);
    expect(c.poolExhausted).toBe(true);
    expect(c.scope).toBe("per server instance, in memory");
    expect(pillText(c)).toBe("$0.400 demo credits");
    expect(pillText(c, true)).toBe("$0.400");
  });
  it("small balances keep three decimals", () => {
    expect(usd2(0.0123)).toBe("$0.012");
    expect(usd2(0.5)).toBe("$0.500");
  });
});

describe("agent action validation (agent output is untrusted)", () => {
  it("accepts every UiAction shape", () => {
    const good: unknown[] = [
      { name: "workbench.open", args: { workbench: "matter" } },
      { name: "board.load_template", args: { template_id: "fault_gpio12_vs_gpio14" } },
      { name: "board.set_design", args: { design: { instances: [], nets: [] } } },
      { name: "board.check", args: {} },
      { name: "matter.set_params", args: { gen_params: { n_fins: 6 } } },
      { name: "matter.simulate", args: {} },
      { name: "silicon.open_run", args: { run_id: "r_w1_contree3", node_id: "n1.2.1" } },
      { name: "workflow.focus", args: { step: "verify" } },
    ];
    for (const g of good) expect(parseUiAction(g).ok, JSON.stringify(g)).toBe(true);
  });
  it("refuses unknown names, bad ids and non-numeric params", () => {
    const bad: unknown[] = [
      null,
      { name: 3 },
      { name: "shell.run", args: { cmd: "rm -rf /" } },
      { name: "workbench.open", args: { workbench: "library" } },
      { name: "board.load_template", args: { template_id: "../../etc/passwd" } },
      { name: "board.set_design", args: { design: "nope" } },
      { name: "matter.set_params", args: { spreader: { Q: "hot" } } },
      { name: "silicon.open_run", args: { run_id: "a/b" } },
      { name: "workflow.focus", args: { step: "deploy" } },
    ];
    for (const b of bad) expect(parseUiAction(b).ok, JSON.stringify(b)).toBe(false);
  });
});

describe("Matter parameter merge", () => {
  const cur = defaultSimulateInput("rect_fins");
  it("merges known keys and keeps the rest", () => {
    const m = mergeMatterParams(cur, { gen_params: { n_fins: 6 }, spreader: { Q: 5 } });
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.input.gen_params.n_fins).toBe(6);
      expect(m.input.gen_params.fin_len).toBe(cur.gen_params.fin_len);
      expect(m.input.spreader.Q).toBe(5);
    }
  });
  it("switching generator resets geometry to that generator's defaults", () => {
    const m = mergeMatterParams(cur, { generator: "radial_spokes" });
    expect(m.ok && Object.keys(m.input.gen_params)).toEqual(["n_spokes", "spoke_w", "ring_r", "length"]);
  });
  it("refuses unknown generators and unknown keys with a reason", () => {
    expect(mergeMatterParams(cur, { generator: "magic" })).toMatchObject({ ok: false });
    const bad = mergeMatterParams(cur, { gen_params: { bogus: 1 } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain("bogus");
  });
});

describe("result summaries use only the real numbers", () => {
  it("Board summary names the failing rung and its detail", () => {
    const c = { rungs: [{ rung: "B1", status: "pass", detail: "", evidence: [] }, { rung: "B4", status: "fail", detail: "GPIO12 vs GPIO14", evidence: [] }] } as unknown as BoardCheck;
    const s = summarizeCheck(c);
    expect(s).toContain("1 of 2 rungs pass");
    expect(s).toContain("B4 fail: GPIO12 vs GPIO14");
  });
  it("Matter summary states the peak and the rung count, and refuses a verdict it was not given", () => {
    const sim = { metrics: { peak_temp_c: 81.64 }, viewer: { field: {} }, baselines: { equal_material: {}, full_budget: {} }, ladder: [{ status: "pass" }, { status: "fail" }], verdict: null, first_failure: "M5" } as unknown as MatterSimulation;
    const s = summarizeSim(sim);
    expect(s).toContain("Peak 81.6 °C");
    expect(s).toContain("1 of 2 rungs pass");
    expect(s).toContain("No verdict (M5 did not pass)");
  });
});

describe("Matter result rejected at M2", () => {
  it("is reported as nothing solved, without reading missing metrics", () => {
    const sim = { metrics: {}, viewer: { field: null }, baselines: { equal_material: null, full_budget: null }, ladder: [{ status: "pass" }, { status: "fail" }], first_failure: "M2" } as unknown as MatterSimulation;
    expect(summarizeSim(sim)).toBe("Nothing was solved: M2 rejected the geometry (1 of 2 rungs pass).");
  });
});

describe("grouped connection graph", () => {
  const design = {
    mcu_ref: "U1",
    instances: [{ ref: "U1", part: "esp32" }, { ref: "U2", part: "ldo33" }, { ref: "U3", part: "bme280" }, { ref: "J1", part: "usbc" }, { ref: "R1", part: "res" }, { ref: "SW1", part: "btn" }],
    nets: [{ name: "GND", pins: ["U1.GND", "U2.GND", "R1.2"] }, { name: "3V3", pins: ["U2.VOUT", "U1.3V3", "U3.VDD", "R1.1", "SW1.1"] }, { name: "SDA", pins: ["U1.GPIO21", "U3.SDI", "R1.2"] }, { name: "NC", pins: ["U3.NC"] }],
  };
  it("groups parts by function", () => {
    expect(groupOf("esp32", "U1")).toBe("mcu");
    expect(groupOf("ldo33", "U2")).toBe("power");
    expect(groupOf("bme280", "U3")).toBe("sensor");
    expect(groupOf("usbc", "J1")).toBe("usb");
    expect(groupOf("res", "R1")).toBe("passive");
    expect(groupOf("custom_mcu_part", "U9", "U9")).toBe("mcu");
  });
  it("is deterministic and places every part exactly once inside its group box", () => {
    const a = layoutGrouped(design);
    expect(JSON.stringify(layoutGrouped(design))).toBe(JSON.stringify(a));
    expect(a.parts.map((p) => p.ref).sort()).toEqual(["J1", "R1", "SW1", "U1", "U2", "U3"]);
    for (const p of a.parts) {
      const box = a.boxes.find((b) => b.id === p.group)!;
      expect(p.x - 22).toBeGreaterThanOrEqual(box.x);
      expect(p.x + 22).toBeLessThanOrEqual(box.x + box.w + 1);
      expect(p.y + 11).toBeLessThanOrEqual(box.y + box.h + 1);
    }
  });
  it("draws signal nets, lists power rails instead of drawing them, and marks ground", () => {
    const a = layoutGrouped(design);
    expect(a.edges.map((e) => e.net)).toEqual(["SDA", "SDA"]);
    expect(a.edges.every((e) => e.a === "U1")).toBe(true);
    expect(a.rails).toEqual(["3V3"]);
    expect([...a.ground].sort()).toEqual(["R1", "U1", "U2"]);
  });
});

describe("old /workstation links", () => {
  it("map a run id to the Silicon workbench and drop everything else", () => {
    expect(workstationRedirect({ run: "r_w1_final", evil: "x" })).toBe("/app?wb=silicon&run=r_w1_final");
    expect(workstationRedirect({ wb: "board" })).toBe("/app?wb=board");
    expect(workstationRedirect({})).toBe("/app");
    expect(workstationRedirect({ run: "../x" })).toBe("/app");
  });
});
