import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BenchApiError, describeError, getJson, postJson } from "./api";
import {
  failedEvidence, findMismatches, gradeSpot, headerLines, netLines, parseBus, rungOf, withPullups,
  type BoardDesign, type CheckResponse, type TemplateResponse,
} from "./data/board";
import { KERNEL_LINES } from "./data/kernel";
import {
  clampParams, gradeMatter, matterDeepParams, peakBars, plateRgba, simulateBody, tempColor, type SimResponse,
} from "./data/matter";
import { extractSilicon, gradePick, parseNdjson, rankCandidates, scoreHunt, shortReason, topHotspot } from "./data/silicon";

const fx = <T,>(name: string) => JSON.parse(readFileSync(resolve(__dirname, "__fixtures__", name), "utf8")) as T;
const replay = readFileSync(resolve(__dirname, "../../../public/replays/r_w1_contree3.ndjson"), "utf8");
const data = extractSilicon(parseNdjson(replay))!;

describe("silicon extraction from the real run", () => {
  it("reads the baseline and the profile", () => {
    expect(data.runId).toBe("r_w1_contree3");
    expect(data.baseline.cycles).toBe(860730);
    expect(data.hotspots[0]).toMatchObject({ fn: "tm_dot_prod", file: "tm_dot.h", lineStart: 26, lineEnd: 37, pct: 95.72 });
    expect(topHotspot(data.hotspots).fn).toBe("tm_dot_prod");
  });
  it("lists the six depth-1 proposals with their real outcomes", () => {
    expect(data.candidates.map((c) => c.nodeId)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6"]);
    const by = Object.fromEntries(data.candidates.map((c) => [c.nodeId, c]));
    expect(by.n1.outcome).toMatchObject({ kind: "scored", speedup: 2.6852, areaDeltaPct: 4.83 });
    expect(by.n2.outcome).toMatchObject({ kind: "scored", speedup: 1.6384, areaDeltaPct: 1.21 });
    for (const id of ["n3", "n4", "n5", "n6"]) expect(by[id].outcome.kind).toBe("pruned");
    expect(by.n6.outcome).toMatchObject({ reason: "no speedup (0.86x vs parent 1.00x)" });
  });
  it("finds the winning line and best descendants", () => {
    expect(data.bestNodeId).toBe("n1.2.1");
    const by = Object.fromEntries(data.candidates.map((c) => [c.nodeId, c]));
    expect(by.n1.onWinningLine).toBe(true);
    expect(by.n2.onWinningLine).toBe(false);
    expect(by.n1.bestDescendant).toEqual({ nodeId: "n1.2.1", speedup: 4.0406 });
    expect(by.n2.bestDescendant?.nodeId).toBe("n2.2");
  });
  it("tolerates a truncated line and missing events", () => {
    expect(parseNdjson('{"type":"a"}\n{"type":').length).toBe(1);
    expect(extractSilicon([])).toBeNull();
  });
});

describe("pick scoring", () => {
  const by = Object.fromEntries(data.candidates.map((c) => [c.nodeId, c]));
  it("grades winner, verified and pruned", () => {
    expect(gradePick(by.n1)).toBe("winner");
    expect(gradePick(by.n2)).toBe("verified");
    expect(gradePick(by.n3)).toBe("pruned");
  });
  it("ranks the winning line first and pruned last", () => {
    const r = rankCandidates(data.candidates).map((c) => c.nodeId);
    expect(r.slice(0, 2)).toEqual(["n1", "n2"]);
    expect(r.slice(2)).toEqual(["n3", "n4", "n5", "n6"]);
  });
  it("words prune reasons without inventing causes", () => {
    expect(shortReason("implementation failed: x\nRTL does not compile\n%Error")).toMatch(/did not compile/);
    expect(shortReason("something new\nsecond line")).toBe("something new");
  });
});

describe("hot-loop hunt scoring", () => {
  it("scores lines against the profile ranges", () => {
    expect(scoreHunt(data.hotspots, "tm_dot.h", 33).grade).toBe("top");
    expect(scoreHunt(data.hotspots, "tm_dot.h", 26).grade).toBe("top");
    expect(scoreHunt(data.hotspots, "tm_dot.h", 37).grade).toBe("top");
    const other = scoreHunt(data.hotspots, "main.c", 42);
    expect(other.grade).toBe("other");
    expect(other.hit?.fn).toBe("tml_fc");
    expect(scoreHunt(data.hotspots, "tm_dot.h", 40).grade).toBe("none");
    expect(scoreHunt(data.hotspots, "main.c", 31).grade).toBe("none");
  });
});

describe("kernel source", () => {
  const root = resolve(__dirname, "../../../../workloads/w1_tinymaix_fc");
  it.skipIf(!existsSync(root))("matches the repo's workload files line for line", () => {
    for (const file of ["tm_dot.h", "main.c"] as const) {
      const src = readFileSync(resolve(root, file), "utf8").split(/\r?\n/).map((l) => l.replace(/\t/g, "    "));
      for (const l of KERNEL_LINES.filter((k) => k.file === file)) expect(src[l.line - 1].trimEnd(), `${file}:${l.line}`).toBe(l.text.trimEnd());
    }
  });
});

describe("board: spot the mismatch", () => {
  const tpl = fx<TemplateResponse>("board-template-fault.json");
  const header = headerLines(tpl.header);
  const nets = netLines(tpl.design);
  it("parses header and netlist rows", () => {
    expect(header.map((h) => [h.fn, h.pin])).toEqual([["i2c_sda", 21], ["i2c_scl", 22], ["wake_btn", 12], ["status_led", 4]]);
    expect(nets.map((n) => n.net)).toEqual(["SDA", "SCL", "WAKE", "LED_DRV"]);
  });
  it("finds the one disagreement and grades clicks on either side", () => {
    const m = findMismatches(header, nets);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ fn: "wake_btn", firmwarePin: 12, netlistPin: "GPIO14" });
    expect(gradeSpot("fw:wake_btn", m)).toBe("found");
    expect(gradeSpot("net:WAKE", m)).toBe("found");
    expect(gradeSpot("fw:i2c_sda", m)).toBe("wrong");
    expect(gradeSpot(null, m)).toBe("none");
  });
  it("the clean template has no disagreement", () => {
    const clean = fx<TemplateResponse>("board-template-clean.json");
    expect(findMismatches(headerLines(clean.header), netLines(clean.design))).toEqual([]);
  });
  it("reads the real B4 result and its evidence ids", () => {
    const r = fx<CheckResponse>("board-check-fault.json");
    const b4 = rungOf(r, "B4")!;
    expect(b4.status).toBe("fail");
    expect(b4.detail).toMatch(/firmware says GPIO12, netlist wires GPIO14/);
    expect(failedEvidence(b4)).toContain("part:esp32.gpio12");
  });
});

describe("board: fix the rung", () => {
  it("edits only the mode and the two pull-ups, without touching the original", () => {
    const base = fx<TemplateResponse>("board-template-clean.json").design;
    const d = withPullups(base, 2200);
    expect(d.assumptions.i2c_mode).toBe("fast");
    expect(d.instances.filter((i) => i.part === "res").map((i) => [i.ref, i.params.ohms])).toEqual([["R1", 2200], ["R2", 2200], ["R3", 10000], ["R4", 330], ["R5", 5100], ["R6", 5100], ["R7", 2000]]);
    expect(base.assumptions.i2c_mode).toBe("standard");
    expect(base.instances.find((i) => i.ref === "R1")!.params.ohms).toBe(4700);
  });
  it("parses the real rise-time sentences (fail, pass and too-low)", () => {
    const fail = parseBus(rungOf(fx<CheckResponse>("board-check-fast-10000.json"), "B3")!.detail, false);
    expect(fail[0]).toMatchObject({ line: "SCL", rp: 10000, riseNs: 847, limitNs: 300, ok: false });
    const pass = parseBus(rungOf(fx<CheckResponse>("board-check-fast-2200.json"), "B3")!.detail, true);
    expect(pass.map((b) => [b.line, b.rp, b.riseNs, b.limitNs, b.ok])).toEqual([["SCL", 2200, 186, 300, true], ["SDA", 2200, 186, 300, true]]);
    const low = parseBus("SCL: Rp 330 ohm is below the minimum 967 ohm for 3.3 V; SDA: Rp 330 ohm is below the minimum 967 ohm for 3.3 V", false);
    expect(low[0]).toMatchObject({ rp: 330, minRp: 967, ok: false });
    expect(low[0].riseNs).toBeUndefined();
  });
});

describe("matter", () => {
  const ok = fx<SimResponse>("matter-sim-ok.json");
  const over = fx<SimResponse>("matter-sim-overbudget.json");
  it("builds the request inside the documented ranges", () => {
    expect(clampParams({ n_fins: 99, fin_len: 1, budget_fraction: 5 })).toEqual({ n_fins: 14, fin_len: 4, budget_fraction: 0.9 });
    expect(simulateBody({ n_fins: 8, fin_len: 16, budget_fraction: 0.4 })).toEqual({ generator: "rect_fins", gen_params: { n_fins: 8, fin_len: 16 }, spreader: { budget_fraction: 0.4 } });
    expect(matterDeepParams({ n_fins: 8, fin_len: 16, budget_fraction: 0.4 }).gen_params.n_fins).toBe(8);
  });
  it("grades honestly against the baselines", () => {
    expect(gradeMatter(ok)).toBe("no-beat");
    expect(gradeMatter(over)).toBe("no-solve");
    const better = { ...ok, verdict: { ...ok.verdict!, beats_equal_material: true } };
    expect(gradeMatter(better)).toBe("beats-equal");
    expect(gradeMatter({ ...better, verdict: { ...better.verdict, beats_full_budget: true } })).toBe("beats-both");
  });
  it("makes bars only from response numbers", () => {
    expect(peakBars(ok).map((b) => b.key)).toEqual(["you", "eq", "full"]);
    expect(peakBars(over).map((b) => b.key)).toEqual(["full"]);
  });
  it("colours a plate: transparent without material, hot at the peak, flipped rows", () => {
    expect(tempColor(25, 25, 80)).toEqual([38, 52, 120]);
    expect(tempColor(80, 25, 80)).toEqual([190, 36, 40]);
    expect(tempColor(200, 25, 80)).toEqual([190, 36, 40]);
    const { data: px, n } = plateRgba({ n: 2, chip: [0, 1, 0, 1], mask: ["10", "00"], field: { T_inf: 25, peak: 80, T: [[80, null], [null, null]] } });
    expect(n).toBe(2);
    // model row 0 is the bottom image row
    expect(Array.from(px.slice((1 * 2 + 0) * 4, (1 * 2 + 0) * 4 + 4))).toEqual([190, 36, 40, 255]);
    expect(px[3]).toBe(0);
    expect(plateRgba(ok.viewer!).data.length).toBe(60 * 60 * 4);
  });
});

describe("api errors", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
  it("maps 422, 429, 5xx and network failures to messages", async () => {
    reply(422, { ok: false, error: { field: "gen_params.n_fins", message: "must be between 2 and 14, got 99" } });
    const e1 = await postJson("/x", {}).catch((e) => e);
    expect(e1).toBeInstanceOf(BenchApiError);
    expect(describeError(e1)).toMatch(/gen_params\.n_fins: must be between 2 and 14/);
    reply(429, { ok: false }, { "retry-after": "12" });
    expect(describeError(await getJson("/x").catch((e) => e))).toMatch(/12 s/);
    reply(500, {});
    expect(describeError(await getJson("/x").catch((e) => e))).toMatch(/\(500\)/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("failed"); }));
    expect(describeError(await getJson("/x").catch((e) => e))).toMatch(/Could not reach/);
  });
  it("treats ok:false in a 200 body as an error and passes good bodies through", async () => {
    reply(200, { ok: false, error: { message: "bad" } });
    expect(((await getJson("/x").catch((e) => e)) as BenchApiError).kind).toBe("server");
    reply(200, { ok: true, v: 1 });
    expect(await getJson<{ v: number }>("/x")).toEqual({ ok: true, v: 1 });
  });
});
