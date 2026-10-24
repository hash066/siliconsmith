// Live smoke of the prompt-first agent: free-form goals from the START screen (no workbench), against a running server with the real key
// (the key stays in the server's env; this script never sees it). Needs the Python API too (see agent-smoke.mjs).
//   node scripts/agent-freeform.mjs [baseUrl]
// Prints, per goal: the model, the actions the agent performed in the app, the plain-language answer, the follow-up chips and the cost.

const base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3217";
let cookie = "";
const call = async (path, init = {}) => {
  const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
};

const goals = [
  "A heat sink for a 5 W chip, 40 mm square, under 70 C.",
  "Check my ESP32 board.",
  "Make this loop faster with a custom RISC-V instruction.",
];
let total = 0;
let failures = 0;
for (const text of goals) {
  const res = await call("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, model: "auto" }) });
  if (!res.ok) {
    console.log(`\n== ${text}\n   HTTP ${res.status} ${(await res.json().catch(() => ({}))).message ?? ""}`);
    failures++;
    continue;
  }
  const ev = (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const receipt = ev.find((e) => e.type === "credits")?.receipt;
  if (receipt) await call("/api/credits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt }) });
  const cost = ev.filter((e) => e.type === "cost").reduce((s, e) => s + e.usd, 0);
  total += cost;
  const ui = ev.filter((e) => e.type === "ui.action").map((e) => e.action.name);
  const tools = ev.filter((e) => e.type === "tool.call").map((e) => e.call.name);
  const results = ev.filter((e) => e.type === "tool.result").map((e) => `${e.ok ? "ok" : "ERR"}: ${e.summary}`);
  const text_ = ev.filter((e) => e.type === "text.delta").map((e) => e.text).join("");
  const chips = ev.find((e) => e.type === "suggest")?.chips ?? [];
  const prop = ev.find((e) => e.type === "action.proposed")?.action;
  const err = ev.find((e) => e.type === "turn.error")?.message;
  const model = ev.find((e) => e.type === "turn.started")?.model;
  console.log(`\n== ${text}   [${model}]  $${cost.toFixed(5)}`);
  console.log(`   tools: ${tools.join(", ") || "-"}`);
  console.log(`   app actions: ${ui.join(", ") || "-"}`);
  for (const r of results) console.log(`   · ${r.slice(0, 200)}`);
  if (prop) console.log(`   proposal: ${prop.tool}, cap $${prop.costEstimateUsd}`);
  console.log(`   answer: ${text_.replace(/\s+/g, " ")}`);
  for (const fl of ev.filter((e) => e.type === "flag")) console.log(`   FLAG ${fl.kind}: ${fl.message}`);
  console.log(`   chips: ${chips.join(" | ") || "-"}`);
  if (err) {
    console.log(`   ERROR: ${err}`);
    failures++;
  }
  if (/\brungs?\b|board:|matter:|run:r_|part:/i.test(text_)) {
    console.log("   JARGON or raw ids leaked into the answer");
    failures++;
  }
}
console.log(`\ntotal $${total.toFixed(5)}; failures ${failures}`);
process.exit(failures ? 1 : 0);
