// Tools added for the hosted workbenches. Library lookups read the real evidence/ manifests. The Board/Matter calls use a scripted
// stand-in for the hosted functions here (test only); with HOSTED_API_URL set (scripts/e2e-hosted.mjs does this) the same tests hit the real Python handlers.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fsManifestStore } from "./manifest";
import { fsReplayLoader, runTool, TOOL_DEFS, validateArgs, type HostedCaller } from "./agent-tools";

const loader = fsReplayLoader(resolve(__dirname, "../public/replays"));
const manifests = fsManifestStore(resolve(__dirname, "../../evidence"));
const REAL = process.env.HOSTED_API_URL;

const scripted: HostedCaller = async (path, init) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  if (path.startsWith("/api/board/templates/")) return json(200, { ok: true, design: { name: "x" } });
  if (path === "/api/board/check")
    return json(200, {
      ok: true,
      passed: false,
      rungs: [
        { rung: "B1", status: "pass", label: "Netlist is well formed", detail: "pins exist", evidence: ["part:batt.bat_p"] },
        { rung: "B4", status: "fail", label: null, detail: "wake_btn: firmware says GPIO12, netlist wires GPIO14", evidence: ["part:esp32.gpio12", "part:esp32.gpio12.strapping"] },
      ],
      notice: "Netlist-level check only",
    });
  if (path === "/api/matter/simulate") {
    const body = JSON.parse(String(init?.body));
    if (body.spreader.Q > 100) return json(422, { ok: false, error: { field: "spreader.Q", message: "too big" } });
    return json(200, {
      ok: true,
      ladder: [
        { id: "M1", status: "pass", label: "Solver validated against analytic cases", detail: "ok" },
        { id: "M5", status: "fail", label: null, detail: "does not beat baseline" },
      ],
      metrics: { peak_temp_c: 81.5, material_fraction: 0.35 },
      baselines: { equal_material: { peak_temp_c: 80.3, delta_k: -1.2 } },
      verdict: { label: "Does not beat a rectangular-fin baseline", lower_bound_peak_c: 71.3, note: "2D model" },
    });
  }
  return json(404, { ok: false });
};
const hostedReal: HostedCaller = (path, init) => fetch(`${REAL}${path}`, init);
const hosted = REAL ? hostedReal : scripted;
const ctx = { manifests, hosted };

describe("library tools (real manifests)", () => {
  it("library_search returns real library entries (not run nodes) and the exact reproduce command and returns the reproduce command, marked as not run", async () => {
    const r = await runTool("library_search", { query: "dot4" }, loader, ctx);
    expect(r.ok && r.evidence).toContain("library:dot4-tinymaix");
    const data = r.ok ? (r.data as Array<{ reproduce: string; reproduce_note: string; not_claimed: string[] }>) : [];
    expect(data[0].reproduce).toBe("siliconsmith verify-entry dot4-tinymaix");
    expect(data[0].reproduce_note).toMatch(/not run/);
    expect(data[0].not_claimed.join(" ")).toMatch(/silicon/);
  });

  it("evidence_get with entry_id returns the stored manifest summary; an unknown id is an error", async () => {
    const ok = await runTool("evidence_get", { entry_id: "xor-rotl8-chacha20" }, loader, ctx);
    expect(ok.ok && ok.evidence).toEqual(["library:xor-rotl8-chacha20"]);
    expect((await runTool("evidence_get", { entry_id: "nope" }, loader, ctx)).ok).toBe(false);
    expect((await runTool("evidence_get", { entry_id: "../x" }, loader, ctx)).ok).toBe(false);
    expect((await runTool("evidence_get", {}, loader, ctx)).ok).toBe(false);
  });

  it("evidence_get still answers the run-metric form", async () => {
    const r = await runTool("evidence_get", { run_id: "r_w1_contree3", node_id: "n1.2.1", metric: "wall_speedup" }, loader, ctx);
    expect(r.ok && r.evidence).toEqual(["run:r_w1_contree3/n1.2.1#wall_speedup"]);
  });
});

describe("board_check and matter_simulate", () => {
  it("board_check on a template reports rungs with per-rung evidence ids and the cited facts of failures only", async () => {
    const r = await runTool("board_check", { template_id: REAL ? "fault_gpio12_vs_gpio14" : "fault_gpio12_vs_gpio14" }, loader, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evidence).toContain("board:fault_gpio12_vs_gpio14#B4");
    const rungs = (r.data as { rungs: Array<{ rung: string; status: string; claim: string | null }> }).rungs;
    const b4 = rungs.find((x) => x.rung === "B4")!;
    expect(b4.status).toBe("fail");
    expect(b4.claim).toBeNull();
    expect(r.evidence.some((e) => e.startsWith("part:esp32"))).toBe(true);
  });

  it("board_check needs exactly one of template_id and design_json", async () => {
    expect((await runTool("board_check", {}, loader, ctx)).ok).toBe(false);
    expect((await runTool("board_check", { template_id: "a", design_json: "{}" }, loader, ctx)).ok).toBe(false);
    expect((await runTool("board_check", { template_id: "../etc" }, loader, ctx)).ok).toBe(false);
  });

  it("matter_simulate validates inputs before calling out, and returns rung evidence ids and the honest note", async () => {
    expect((await runTool("matter_simulate", { gen_params: { spine: 99 } }, loader, ctx)).ok).toBe(false);
    expect((await runTool("matter_simulate", { gen_params: { bogus: 1 } }, loader, ctx)).ok).toBe(false);
    expect((await runTool("matter_simulate", { Q: 1000 }, loader, ctx)).ok).toBe(false);
    const r = await runTool("matter_simulate", { generator: "rect_fins", gen_params: { n_fins: 8 } }, loader, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evidence).toContain("matter:rect_fins#M1");
      expect((r.data as { note: string }).note).toMatch(/not validated on a printed part/);
    }
  });

  it("matter_simulate with a rejected geometry (empty metrics) says nothing was solved instead of crashing", async () => {
    const rejected: HostedCaller = async () => new Response(JSON.stringify({ ok: true, ladder: [{ id: "M1", status: "pass", detail: "ok" }, { id: "M2", status: "fail", detail: "material 1620 cells exceeds budget 1440" }], metrics: {}, baselines: { equal_material: null, full_budget: null }, verdict: null }), { status: 200 });
    const r = await runTool("matter_simulate", {}, loader, { manifests, hosted: rejected });
    expect(r.ok && r.summary).toContain("no solve");
    expect(r.ok && r.summary).toContain("exceeds budget");
  });

  it("without the hosted functions the tools say so instead of inventing a result", async () => {
    expect((await runTool("board_check", { template_id: "clean_sensor" }, loader, {})).ok).toBe(false);
    expect((await runTool("matter_simulate", {}, loader, {})).ok).toBe(false);
  });

  it("every advertised tool is free or only PROPOSES a loop, and has a validator entry", () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual(["board_check", "board_fix_pin", "board_set_design", "evidence_get", "library_search", "matter_simulate", "propose_board_design", "propose_matter_optimize", "propose_silicon_run", "run_explain_failure", "run_nodes_search", "silicon_open_run", "workbench_open", "workflow_focus"]);
    expect(validateArgs("matter_simulate", { gen_params: { a: "x" } }).ok).toBe(false);
    expect(validateArgs("matter_simulate", { Q: "2" }).ok).toBe(false);
  });
});
