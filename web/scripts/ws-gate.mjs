// Rendered gate for the workstation surfaces with playwright-cli: horizontal-overflow sweep at six widths, plus screenshots.
//   node scripts/ws-gate.mjs [baseUrl] [outDir] [tag] [view,view,...]
// Needs the app running (npm run build && npx next start -p 3217) and `playwright-cli` on PATH.
// `tag` is appended to file names: use "fx" when the dev fixtures are installed (scripts/ws-fixtures.mjs on), none otherwise.
// It measures; it does not decide pass/fail for anything but overflow. Writes screenshots and overflow-<tag>.json into outDir.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3217";
const out = process.argv[3] ?? "../docs/design/evidence";
const only = process.argv[5] ? process.argv[5].split(",") : null; // optional: view names to run
const tag = process.argv[4] ? `-${process.argv[4]}` : "";
mkdirSync(out, { recursive: true });

const win = process.platform === "win32";
const q = (a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);
const cli = (...args) => execFileSync("playwright-cli", ["-s=wsgate", ...args].map(q), { stdio: "pipe", shell: win }).toString();
const flat = (fn) => fn.split(/\r?\n/).map((l) => l.trim()).join(" ");
const evalJson = (fn) => {
  const text = cli("eval", flat(fn));
  const m = text.match(/### Result\s*\n([\s\S]*?)\n###/) ?? text.match(/### Result\s*\n([\s\S]*)$/);
  if (!m) throw new Error(`no result in: ${text.slice(0, 200)}`);
  let v = JSON.parse(m[1].trim());
  if (typeof v === "string") v = JSON.parse(v);
  return v;
};
const wait = (ms) => cli("eval", `() => new Promise(r => setTimeout(r, ${ms}))`);
const click = (label) =>
  evalJson(`() => { const el = [...document.querySelectorAll('button, a')].find(b => (b.getAttribute('aria-label') || b.textContent || '').trim().startsWith(${JSON.stringify(label)})); if (!el) return JSON.stringify({ok:false}); el.click(); return JSON.stringify({ok:true}); }`);
const measure = () =>
  evalJson(`() => JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, offenders: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[class*="overflow-x-auto"], [class*="overflow-auto"], [class*="overflow-y-auto"]'); }).slice(0, 5).map(e => e.tagName + '.' + String(e.className).slice(0, 60)) })`);

const WORKSTATION = "/workstation?t=end";
// Each view: a path, then clicks (aria-label or text prefixes) in order.
const wide = (w) => w >= 1024;
const views = (w) => [
  { name: "default", path: WORKSTATION, steps: [] },
  { name: "evidence-open", path: WORKSTATION, steps: ["Evidence for best wall-clock speedup"] },
  ...(wide(w)
    ? [
        { name: "board", path: WORKSTATION, steps: ["Board"] },
        { name: "board-rung", path: WORKSTATION, steps: ["Board", "n1 B4"] },
        { name: "board-repair", path: WORKSTATION, steps: ["board-repair-pin_mismatch-1", "n1 B4"] },
        { name: "matter", path: WORKSTATION, steps: ["Matter"] },
        { name: "matter-rung", path: WORKSTATION, steps: ["Matter", "n1 M3"] },
      ]
    : [
        { name: "agent", path: WORKSTATION, steps: ["Agent"] },
        { name: "project", path: WORKSTATION, steps: ["Project"] },
        { name: "evidence-tab", path: WORKSTATION, steps: ["Evidence"] },
        { name: "board", path: WORKSTATION, steps: ["Board"] },
        { name: "board-rung", path: WORKSTATION, steps: ["Board", "n1 B4"] },
        { name: "matter", path: WORKSTATION, steps: ["Matter"] },
      ]),
  { name: "library", path: "/workstation/library", steps: [] },
  { name: "library-evidence", path: "/workstation/library", steps: ["Evidence for Wall-clock"] },
  { name: "templates", path: "/workstation/templates", steps: [] },
];

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
  for (const v of views(w).filter((x) => !only || only.includes(x.name))) {
    cli("goto", `${base}${v.path}`);
    wait(v.path.startsWith("/workstation?") ? 2300 : 1800);
    let clicked = true;
    for (const s of v.steps) {
      // On the narrow layout the rail's run list lives under the Project tab.
      if (s.startsWith("board-repair") && w < 1024) click("Project");
      const r = click(s);
      clicked = clicked && r.ok;
      wait(500);
    }
    wait(300);
    const m = measure();
    const file = `ws-${w}x${h}-${v.name}${tag}.png`;
    cli("screenshot", "--filename", `${out}/${file}`);
    results.push({ viewport: `${w}x${h}`, view: v.name, ...m, clicked, overflow: m.scrollWidth > m.innerWidth, screenshot: file });
    console.log(w, v.name, m.scrollWidth, m.innerWidth, clicked ? "" : "(click target not found)", m.offenders.join(" | "));
  }
}
cli("close");
writeFileSync(`${out}/overflow${tag}${only ? "-partial" : ""}.json`, JSON.stringify(results, null, 2));
console.log(results.every((r) => !r.overflow) ? "NO HORIZONTAL OVERFLOW" : "OVERFLOW FOUND");
