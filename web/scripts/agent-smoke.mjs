// Live smoke test of the Agent against a running server that has the real key (the key stays in the server's env; this script never sees it).
//   1. python scripts/serve_api_local.py 8765
//   2. LOCAL_PYTHON_API=http://127.0.0.1:8765 node --env-file=<path to .env.local> node_modules/next/dist/bin/next start -p 3217
//   3. node scripts/agent-smoke.mjs [baseUrl] [--loops]
// It spends real (demo) credits: about $0.01 for the turns, up to $0.10 more with --loops. It prints per-turn model, tools, UI actions,
// cost and checks that /api/credits matches the sum of the cost events.

const base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3217";
const withLoops = process.argv.includes("--loops");
let cookie = "";

async function call(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}

async function turn(label, body) {
  const t0 = Date.now();
  const res = await call("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    console.log(`${label}: HTTP ${res.status} ${j.message ?? ""}`);
    return null;
  }
  const events = (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  // the stream ends with a signed receipt; posting it settles the cookie from the reserved estimate to the real cost
  const receipt = events.find((e) => e.type === "credits")?.receipt;
  if (receipt) await call("/api/credits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt }) });
  const model = events.find((e) => e.type === "turn.started")?.model;
  const tools = events.filter((e) => e.type === "tool.call").map((e) => e.call.name);
  const ui = events.filter((e) => e.type === "ui.action").map((e) => e.action.name);
  const cost = events.filter((e) => e.type === "cost").reduce((s, e) => s + e.usd, 0);
  const tin = events.filter((e) => e.type === "cost").reduce((s, e) => s + e.tokens_in, 0);
  const tout = events.filter((e) => e.type === "cost").reduce((s, e) => s + e.tokens_out, 0);
  const text = events.filter((e) => e.type === "text.delta").map((e) => e.text).join("");
  const flags = events.filter((e) => e.type === "flag").map((e) => e.kind);
  const err = events.find((e) => e.type === "turn.error")?.message;
  const prop = events.find((e) => e.type === "action.proposed")?.action;
  console.log(`\n== ${label}  [${model}]  ${((Date.now() - t0) / 1000).toFixed(1)} s  $${cost.toFixed(5)}  ${tin} in / ${tout} out`);
  console.log(`   tools: ${tools.join(", ") || "-"}   ui: ${ui.join(", ") || "-"}   flags: ${flags.join(", ") || "-"}${err ? `   ERROR: ${err}` : ""}`);
  if (prop) console.log(`   proposed: ${prop.tool} (cap $${prop.costEstimateUsd}) ${JSON.stringify(prop.args)}`);
  console.log(`   ${text.replace(/\s+/g, " ").slice(0, 320)}`);
  return { cost, prop, events, text };
}

const status = await (await call("/api/agent")).json();
if (!status.connected) {
  console.log("The server has no key: nothing to smoke-test.");
  process.exit(2);
}
const before = await (await call("/api/credits")).json();
console.log("credits before:", JSON.stringify({ remaining: before.remainingUsd, allowance: before.allowanceUsd, pool: before.pool, scope: before.scope }));

let total = 0;
const add = (r) => (total += r?.cost ?? 0);
add(await turn("nano lookup (auto)", { text: "Which library entries exist, and what is the exact reproduce command of the first?", model: "auto", workbench: "silicon" }));
add(await turn("super tool turn (auto), matter", { text: "Simulate rect_fins with 10 fins and tell me if M5 passes.", model: "auto", workbench: "matter", context: { matter: { generator: "rect_fins" } } }));
add(await turn("super tool turn (auto), board", { text: "Load the fault_gpio12_vs_gpio14 template and check it. Which rung fails?", model: "auto", workbench: "board" }));
add(await turn("ultra diagnosis (auto), silicon", { text: "Why was n2.2.4 pruned in r_w1_contree3?", model: "auto", workbench: "silicon", context: { silicon: { run_id: "r_w1_contree3" } } }));
const proposal = await turn("proposal only (nothing runs)", { text: "Propose an optimisation of the fin parameters for a lower peak temperature.", model: "super", workbench: "matter" });
add(proposal);
if (!proposal?.prop) console.log("   (the model did not propose a loop this time)");

if (withLoops) {
  add(await turn("confirmed matter_optimize", { confirm: true, action: { tool: "matter_optimize", args: { generator: "rect_fins" } }, workbench: "matter", text: "optimise" }));
  add(await turn("confirmed board_design", { confirm: true, action: { tool: "board_design", args: { brief: "Add a second status LED on GPIO5 with its own 330 ohm series resistor." } }, workbench: "board", text: "design" }));
}

const after = await (await call("/api/credits")).json();
const delta = before.remainingUsd - after.remainingUsd;
console.log(`\ncredits after: remaining $${after.remainingUsd}  (spent this run: $${delta.toFixed(6)}; sum of cost events: $${total.toFixed(6)})`);
const ok = Math.abs(delta - total) < 0.0001;
console.log(ok ? "OK: the ledger matches the cost events." : "MISMATCH between the ledger and the cost events.");
process.exit(ok ? 0 : 1);
