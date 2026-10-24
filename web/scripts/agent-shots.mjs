// Rendered states of the Agent panel with playwright-cli. Needs three servers (see agent-smoke.mjs for the key rules):
//   A  http://localhost:3217  with the real key           (connected states, a real turn, a proposal and its confirmed run)
//   B  http://localhost:3218  with the key and AGENT_VISITOR_USD=0.0005 (credits used up)
//   C  http://localhost:3219  without a key               (not connected)
//   node scripts/agent-shots.mjs [outDir]
// The turn and the loop spend real demo credits (about $0.01).

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "../docs/design/evidence";
mkdirSync(out, { recursive: true });
const win = process.platform === "win32";
const q = (a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);
const cli = (...args) => execFileSync("playwright-cli", ["-s=agentshots", ...args].map(q), { stdio: "pipe", shell: win }).toString();
const flat = (fn) => fn.split(/\r?\n/).map((l) => l.trim()).join(" ");
const ev = (fn) => cli("eval", flat(fn));
const wait = (ms) => ev(`() => new Promise(r => setTimeout(r, ${ms}))`);
const click = (text, last = false) =>
  ev(`() => { const all = [...document.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label') || b.textContent || '').trim().startsWith(${JSON.stringify(text)})); const el = ${last ? "all.at(-1)" : "all[0]"}; if (el) el.click(); return !!el }`);
const overflow = () => {
  const t = ev("() => JSON.stringify({ sw: document.documentElement.scrollWidth, iw: innerWidth })");
  return JSON.parse(JSON.parse(t.match(/### Result\s*\n([\s\S]*?)\n###/)[1].trim()));
};
const shot = (name, w, h) => {
  const o = overflow();
  cli("screenshot", "--filename", `${out}/${name}-${w}x${h}.png`);
  console.log(name, `${w}x${h}`, o.sw, o.iw, o.sw > o.iw ? "OVERFLOW" : "");
};
const open = (url, w, h, openAgentTab) => {
  cli("resize", String(w), String(h));
  cli("goto", url);
  wait(2200);
  if (openAgentTab && w < 1024) click("Agent");
  wait(400);
};
const typeAndSend = (text) => {
  ev(`() => { const t = document.getElementById('agent-input'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); return 1 }`);
  click("Send", true);
};

cli("open", "about:blank");
for (const [w, h] of [[1440, 900], [390, 844]]) {
  // connected, empty: suggested prompts, model selector, credits, context chips
  open("http://localhost:3217/workstation?wb=matter&t=end", w, h, true);
  shot("agent-v2-empty", w, h);
  // a real turn on the Board workbench: tool card, actions, answer, cost
  open("http://localhost:3217/workstation?wb=board&t=end", w, h, true);
  typeAndSend("Load the fault_gpio12_vs_gpio14 template and check it. Which rung fails?");
  wait(14000);
  click("board_check");
  wait(400);
  shot("agent-v2-turn", w, h);
  // a proposal that needs a click, then the confirmed loop
  open("http://localhost:3217/workstation?wb=matter&t=end", w, h, true);
  typeAndSend("Propose an optimisation of the fin parameters for a lower peak temperature.");
  wait(12000);
  shot("agent-v2-proposal", w, h);
  click("Run (up to");
  wait(20000);
  shot("agent-v2-loop", w, h);
  // credits used up, and not connected
  open("http://localhost:3218/workstation?wb=matter&t=end", w, h, true);
  shot("agent-v2-exhausted", w, h);
  open("http://localhost:3219/workstation?wb=matter&t=end", w, h, true);
  shot("agent-v2-not-connected", w, h);
}
cli("close");
