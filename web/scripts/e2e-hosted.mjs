// End-to-end check of the hosted Python functions on a plain local HTTP server (no Vercel login, no model, no key).
//   npm run prebuild && node scripts/e2e-hosted.mjs        (PYTHON=/path/to/python overrides the interpreter)
// It starts scripts/serve_api_local.py, which mounts the very `handler` classes api/board.py and api/matter.py export.

import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = 8765 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
const py = spawn(process.env.PYTHON ?? "python", [join(here, "serve_api_local.py"), String(port)], { stdio: ["ignore", "inherit", "inherit"] });

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) failed++;
};
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep null
  }
  return { status: res.status, json, headers: res.headers, text };
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${base}/api/board/schema`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const list = await call("GET", "/api/board/templates");
  check("GET /api/board/templates lists the 3 real templates", list.status === 200 && list.json.templates?.length === 3, list.json?.templates?.map((t) => t.id).join(","));
  const clean = await call("GET", "/api/board/templates/clean_sensor");
  check("GET /api/board/templates/clean_sensor has a design and a C header", clean.status === 200 && !!clean.json.design && /GPIO|pin/i.test(clean.json.header ?? ""));
  check("GET unknown template is 404", (await call("GET", "/api/board/templates/nope")).status === 404);
  const schema = await call("GET", "/api/board/schema");
  check("GET /api/board/schema has the rungs and limits", schema.status === 200 && !!schema.json["x-rungs"] && !!schema.json["x-limits"]);
  check("GET /api/board/parts and /faults answer", (await call("GET", "/api/board/parts")).status === 200 && (await call("GET", "/api/board/faults")).json?.faults?.length === 8);
  const viaRewrite = await call("GET", "/api/board?route=templates");
  check("rewrite style (?route=templates) reaches the same handler", viaRewrite.status === 200 && viaRewrite.json.templates?.length === 3);

  const ok = await call("POST", "/api/board/check", { design: clean.json.design });
  check("POST /check on the clean template passes B1 to B5", ok.status === 200 && ok.json.passed === true && ok.json.rungs.length === 5, `labels=${ok.json?.labels?.length}`);
  const fault = await call("GET", "/api/board/templates/fault_gpio12_vs_gpio14");
  const bad = await call("POST", "/api/board/check", { design: fault.json.design });
  const b4 = bad.json?.rungs?.find((r) => r.rung === "B4");
  check("POST /check on the GPIO12 fault fails B4 with no claim label and cites fact ids", bad.status === 200 && bad.json.passed === false && b4?.status === "fail" && b4.label === null && b4.evidence.length > 0, b4?.detail?.slice(0, 60));
  check("check result resolves every evidence id", Object.keys(bad.json.evidence ?? {}).length > 0 && b4.evidence.every((id) => id in bad.json.evidence));
  const expl = await call("POST", "/api/board/explain", { design: fault.json.design });
  check("POST /explain lists the failing rung with a hint", expl.status === 200 && expl.json.failing?.length > 0);
  const badJson = await call("POST", "/api/board/check", "{ not json");
  check("malformed JSON is 400 bad_json", badJson.status === 400 && badJson.json?.error?.code === "bad_json");
  const big = await call("POST", "/api/board/check", { design: "x".repeat(120_000) });
  check("oversized body is 413", big.status === 413);
  check("POST /api/board/run is disabled by default", (await call("POST", "/api/board/run", {})).status === 404);

  const sim = await call("POST", "/api/matter/simulate", { generator: "rect_fins", gen_params: { spine: 8, n_fins: 8, fin_w: 3, fin_len: 16 } });
  check("POST /api/matter/simulate returns M1..M5 and a viewer artifact", sim.status === 200 && sim.json.ladder?.length === 5 && sim.json.viewer?.format === "matter-candidate/1", `${sim.json?.timings_ms} ms, ${sim.text.length} bytes`);
  check("both baselines and the limits are present", !!sim.json?.baselines?.equal_material && !!sim.json?.baselines?.full_budget && sim.json.limits?.length > 0);
  check("a failing rung has no label (labels are claims)", sim.json.ladder.every((r) => (r.status === "pass") === (r.label !== null)));
  const bad422 = await call("POST", "/api/matter/simulate", { spreader: { n: 500 } });
  check("out-of-range input is 422 with the field name", bad422.status === 422 && bad422.json?.error?.field === "spreader.n", bad422.json?.error?.message);
  check("GET /api/matter/simulate is 405", (await call("GET", "/api/matter/simulate")).status === 405);
  check("POST /api/matter/run is not served", (await call("POST", "/api/matter/run", {})).status === 404);

  // The agent's read-only tools against the real handlers (same tests as the unit run, which uses a scripted stand-in).
  const vt = spawnSync("npx", ["vitest", "run", "lib/agent-tools-v2.test.ts"], { cwd: join(here, ".."), env: { ...process.env, HOSTED_API_URL: base }, shell: true, encoding: "utf8" });
  check("agent tools board_check, matter_simulate and library lookups pass against the real handlers", vt.status === 0, (vt.stdout ?? "").split("\n").find((l) => l.includes("Tests")) ?? "");

  let limited = null;
  for (let i = 0; i < 130 && !limited; i++) {
    const r = await call("POST", "/api/board/check", { design: clean.json.design });
    if (r.status === 429) limited = r;
  }
  check("the in-memory limiter answers 429 with Retry-After", !!limited && !!limited.headers.get("retry-after"));

} catch (e) {
  console.error(e);
  failed++;
} finally {
  py.kill();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall hosted-function checks passed");
process.exit(failed ? 1 : 0);
