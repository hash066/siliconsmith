// Rendered check of the per-visitor credit balance against a running server that has the real key (the key stays in the server's env).
//   node --env-file=<path to .env.local> node_modules/next/dist/bin/next start -p 3217
//   node scripts/credits-live.mjs [baseUrl] [outDir]
// Opens the workstation in a real browser, sends two Nano lookup turns (about $0.0003 each) and prints the credit pill after each,
// plus the pill read straight from GET /api/credits, and samples the composer's position while the status/credits fetch lands (layout shift).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3217";
const out = process.argv[3] ?? "../docs/design/evidence";
mkdirSync(out, { recursive: true });
const win = process.platform === "win32";
const q = (a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);
const cli = (...args) => execFileSync("playwright-cli", ["-s=creditslive", ...args].map(q), { stdio: "pipe", shell: win }).toString();
const flat = (fn) => fn.split(/\r?\n/).map((l) => l.trim()).join(" ");
const ev = (fn) => cli("eval", flat(fn));
const result = (t) => JSON.parse(JSON.parse(t.match(/### Result\s*\n([\s\S]*?)\n###/)[1].trim()));
const wait = (ms) => ev(`() => new Promise(r => setTimeout(r, ${ms}))`);
const pill = () => result(ev(`() => JSON.stringify([...document.querySelectorAll('span')].map(s => s.textContent.trim()).find(t => /^\\$[0-9.]+ left$/.test(t)) ?? null)`));
const api = () => result(ev(`async () => { const j = await (await fetch('/api/credits', { cache: 'no-store' })).json(); return JSON.stringify({ remaining: j.remainingUsd, spent: j.spentUsd, pool: j.pool.spentUsd }) }`));
const typeAndSend = (text) =>
  ev(`() => { const t = document.getElementById('agent-input'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === 'Send').at(-1).click(); return 1 }`);

const log = { base, steps: [] };
cli("open", "about:blank");
cli("resize", "1440", "900");

// layout shift: sample the composer's top and the header's height every 40 ms from the first paint until 3 s
cli("goto", `${base}/workstation?wb=silicon&t=end`);
const samples = result(
  ev(`async () => {
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      const ta = document.getElementById('agent-input');
      const h = document.querySelector('section[aria-label="Agent"]');
      out.push(ta && h ? [Math.round(ta.getBoundingClientRect().top), Math.round(h.getBoundingClientRect().height)] : null);
      await new Promise(r => setTimeout(r, 40));
    }
    return JSON.stringify(out.filter(Boolean));
  }`),
);
const tops = samples.map((s) => s[0]);
log.layout = { samples: samples.length, composerTopMin: Math.min(...tops), composerTopMax: Math.max(...tops), shiftPx: Math.max(...tops) - Math.min(...tops) };
console.log("layout shift while the status and credits fetch land:", JSON.stringify(log.layout));

wait(1500);
const first = { pill: pill(), api: api() };
log.steps.push({ step: "before any turn", ...first });
console.log("before:", JSON.stringify(first));
cli("screenshot", "--filename", `${out}/credits-live-0-before.png`);

const prompts = ["Which library entries exist? Give me only the count.", "What is the reproduce command of the first library entry?"];
prompts.forEach((p, i) => {
  typeAndSend(p);
  // wait until the turn has finished (the composer shows Send again) and the pill has settled
  ev(`async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { const b = [...document.querySelectorAll('button')].map(x => x.textContent.trim()); if (!b.includes('Stop') && document.querySelectorAll('ol[aria-label="Conversation"] li').length >= ${(i + 1) * 2}) break; await new Promise(r => setTimeout(r, 300)); } await new Promise(r => setTimeout(r, 1500)); return 1 }`);
  const s = { pill: pill(), api: api() };
  log.steps.push({ step: `after turn ${i + 1}`, ...s });
  console.log(`after turn ${i + 1}:`, JSON.stringify(s));
  cli("screenshot", "--filename", `${out}/credits-live-${i + 1}-after.png`);
});

// the balance must fall across the two turns and the pill must agree with the server each time
const n = (s) => Number(String(s.pill).replace(/[^0-9.]/g, ""));
const ok = log.steps.every((s) => Math.abs(n(s) - s.api.remaining) < 0.0006) && n(log.steps[1]) < n(log.steps[0]) && n(log.steps[2]) < n(log.steps[1]) + 1e-9 && log.steps[2].api.remaining < log.steps[1].api.remaining;
log.ok = ok;
writeFileSync(`${out}/credits-live.json`, JSON.stringify(log, null, 2));
cli("close");
console.log(ok ? "OK: the pill matches the server and the balance fell across both turns." : "FAIL: see the steps above.");
process.exit(ok ? 0 : 1);
