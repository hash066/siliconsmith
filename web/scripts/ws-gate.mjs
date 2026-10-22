// Rendered gate for /workstation with playwright-cli: horizontal-overflow sweep and the three target-viewport screenshots.
//   node scripts/ws-gate.mjs [baseUrl] [outDir]
// Needs the app running (npm run build && npx next start -p 3217) and `playwright-cli` on PATH.
// Writes screenshots and overflow.json into outDir. It measures; it does not decide pass/fail for anything but overflow.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3217";
const out = process.argv[3] ?? "../docs/design/evidence";
mkdirSync(out, { recursive: true });

const win = process.platform === "win32";
const q = (a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);
const cli = (...args) => execFileSync("playwright-cli", ["-s=wsgate", ...args].map(q), { stdio: "pipe", shell: win }).toString();
const evalJson = (fn) => {
  const text = cli("eval", fn);
  const m = text.match(/### Result\s*\n([\s\S]*?)\n###/) ?? text.match(/### Result\s*\n([\s\S]*)$/);
  if (!m) throw new Error(`no result in: ${text.slice(0, 200)}`);
  let v = JSON.parse(m[1].trim());
  if (typeof v === "string") v = JSON.parse(v);
  return v;
};
const wait = (ms) => cli("eval", `() => new Promise(r => setTimeout(r, ${ms}))`);
const click = (label) =>
  evalJson(`() => { const el = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent || '').trim().startsWith(${JSON.stringify(label)})); if (!el) return JSON.stringify({ok:false}); el.click(); return JSON.stringify({ok:true}); }`);
const measure = () =>
  evalJson(`() => JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, bodyScrollWidth: document.body.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[class*="overflow-x-auto"], [class*="overflow-auto"], [class*="overflow-y-auto"]'); }).slice(0, 5).map(e => e.tagName + '.' + String(e.className).slice(0, 60)) })`);

const WIDTHS = [
  [360, 780],
  [390, 844],
  [705, 900],
  [768, 1024],
  [1024, 768],
  [1440, 900],
];
const results = [];
cli("open", "about:blank");
for (const [w, h] of WIDTHS) {
  cli("resize", String(w), String(h));
  cli("goto", `${base}/workstation?t=end`);
  wait(2500);
  const views = [{ name: "default", steps: [] }];
  if (w < 1024) {
    views.push({ name: "agent", steps: ["Agent"] }, { name: "project", steps: ["Project"] }, { name: "evidence-tab", steps: ["Evidence"] }, { name: "board", steps: ["Canvas", "Board"] });
  } else {
    views.push({ name: "board", steps: ["Board"] }, { name: "matter", steps: ["Matter"] });
  }
  for (const v of views) {
    cli("goto", `${base}/workstation?t=end`);
    wait(2200);
    for (const s of v.steps) click(s);
    wait(300);
    const m = measure();
    const file = `ws-${w}x${h}-${v.name}.png`;
    cli("screenshot", "--filename", `${out}/${file}`);
    results.push({ viewport: `${w}x${h}`, view: v.name, ...m, overflow: m.scrollWidth > m.innerWidth, screenshot: file });
    console.log(w, v.name, m.scrollWidth, m.innerWidth, m.offenders.join(" | "));
  }
  // The evidence flow: click the first evidence chip, then capture the opened drawer.
  cli("goto", `${base}/workstation?t=end`);
  wait(2200);
  const opened = click("Evidence for best wall-clock speedup");
  wait(300);
  const m = measure();
  const file = `ws-${w}x${h}-evidence-open.png`;
  cli("screenshot", "--filename", `${out}/${file}`);
  results.push({ viewport: `${w}x${h}`, view: "evidence-open", ...m, opened: opened.ok, overflow: m.scrollWidth > m.innerWidth, screenshot: file });
}
cli("close");
writeFileSync(`${out}/overflow.json`, JSON.stringify(results, null, 2));
console.log(results.every((r) => !r.overflow) ? "NO HORIZONTAL OVERFLOW" : "OVERFLOW FOUND");
