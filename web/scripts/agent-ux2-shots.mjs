// Rendered states of the prompt-first agent (plain-language chips, follow-up chips, the Silicon proposal card), with playwright-cli against a
// running server that has the real key (the key stays in the server's env). Spends about $0.01.
//   node scripts/agent-ux2-shots.mjs [baseUrl] [outDir]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3217";
const out = process.argv[3] ?? "../docs/design/evidence";
mkdirSync(out, { recursive: true });
const win = process.platform === "win32";
const q = (a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);
const cli = (...args) => execFileSync("playwright-cli", ["-s=ux2shots", ...args].map(q), { stdio: "pipe", shell: win }).toString();
const flat = (fn) => fn.split(/\r?\n/).map((l) => l.trim()).join(" ");
const ev = (fn) => cli("eval", flat(fn));
const result = (t) => JSON.parse(JSON.parse(t.match(/### Result\s*\n([\s\S]*?)\n###/)[1].trim()));
const wait = (ms) => ev(`() => new Promise(r => setTimeout(r, ${ms}))`);
const click = (text, last = false) =>
  ev(`() => { const all = [...document.querySelectorAll('button')].filter(b => (b.getAttribute('aria-label') || b.textContent || '').trim().startsWith(${JSON.stringify(text)})); const el = ${last ? "all.at(-1)" : "all[0]"}; if (el) el.click(); return !!el }`);
const typeAndSend = (text) => {
  ev(`() => { const t = document.getElementById('agent-input'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); return 1 }`);
  click("Send", true);
};
const turnDone = () => ev(`async () => { const t0 = Date.now(); while (Date.now() - t0 < 90000) { const b = [...document.querySelectorAll('button')].map(x => x.textContent.trim()); if (!b.includes('Stop') && document.querySelectorAll('ol[aria-label="Conversation"] li').length >= 2) break; await new Promise(r => setTimeout(r, 400)); } await new Promise(r => setTimeout(r, 1200)); return 1 }`);
const overflow = () => result(ev("() => JSON.stringify({ sw: document.documentElement.scrollWidth, iw: innerWidth })"));
const facts = () =>
  result(
    ev(`() => JSON.stringify({
      chips: [...document.querySelectorAll('[aria-label="Suggested next steps"] button')].map(b => b.textContent.trim()),
      cards: [...document.querySelectorAll('[role="group"][aria-label^="Tool call"]')].map(g => g.querySelector('span.truncate')?.textContent?.trim()),
      confirm: !!document.querySelector('[aria-label="Confirm before spending credits"]'),
      text: [...document.querySelectorAll('ol[aria-label="Conversation"] li')].at(-1)?.innerText?.slice(0, 600) ?? '',
      jargon: (() => { const c = document.querySelector('ol[aria-label="Conversation"]')?.cloneNode(true); c?.querySelectorAll('details').forEach(d => d.remove()); return /\\brungs?\\b|board:|matter:|run:r_/i.test(c?.innerText ?? ''); })(),
    })`),
  );

const log = { base, shots: [] };
cli("open", "about:blank");
for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  cli("resize", String(w), String(h));
  const open = (wb) => {
    cli("goto", `${base}/workstation?wb=${wb}&t=end`);
    wait(2200);
    click("Skip tour");
    wait(300);
    if (w < 1024) click("Agent");
    wait(400);
  };
  open("matter");
  typeAndSend("A heat sink for a 5 W chip, 40 mm square, under 70 C.");
  turnDone();
  const a = { name: "heat-sink", w, h, ...overflow(), ...facts() };
  cli("screenshot", "--filename", `${out}/agent-ux2-heatsink-${w}x${h}.png`);
  open("silicon");
  typeAndSend("Make this loop faster with a custom RISC-V instruction.");
  turnDone();
  const b = { name: "silicon-proposal", w, h, ...overflow(), ...facts() };
  cli("screenshot", "--filename", `${out}/agent-ux2-silicon-proposal-${w}x${h}.png`);
  for (const s of [a, b]) {
    log.shots.push(s);
    console.log(s.name, `${w}x${h}`, `scroll ${s.sw}/${s.iw}`, s.sw > s.iw ? "OVERFLOW" : "", `cards: ${s.cards.join(" | ")}`, `chips: ${s.chips.join(" | ")}`, s.confirm ? "confirm card" : "", s.jargon ? "JARGON" : "");
  }
}
cli("close");
writeFileSync(`${out}/agent-ux2-shots.json`, JSON.stringify(log, null, 2));
const bad = log.shots.some((s) => s.sw > s.iw || s.jargon);
process.exit(bad ? 1 : 0);
