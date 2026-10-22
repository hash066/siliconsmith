// Keyboard, focus and contrast probe for /workstation (playwright-cli). Measures; does not judge screenshots.
//   node scripts/ws-a11y.mjs [baseUrl] [outDir]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3217";
const out = process.argv[3] ?? "../docs/design/evidence";
mkdirSync(out, { recursive: true });
const win = process.platform === "win32";
const q = (a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);
const cli = (...args) => execFileSync("playwright-cli", ["-s=wsa11y", ...args].map(q), { stdio: "pipe", shell: win }).toString();
const evalJson = (fn) => {
  const text = cli("eval", fn.split(/\r?\n/).map((l) => l.trim()).join(" "));
  const m = text.match(/### Result\s*\n([\s\S]*?)\n###/) ?? text.match(/### Result\s*\n([\s\S]*)$/);
  let v = JSON.parse(m[1].trim());
  if (typeof v === "string") v = JSON.parse(v);
  return v;
};
const wait = (ms) => cli("eval", `() => new Promise(r => setTimeout(r, ${ms}))`);

const CONTRAST = `() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const seen = new Map();
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (el.closest('[disabled]') || el.disabled) continue;
    const fg = parse(cs.color), bg = bgOf(el);
    const a = lum(fg) + 0.05, b = lum(bg) + 0.05;
    const ratio = Math.max(a, b) / Math.min(a, b);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const key = el.tagName + '|' + cs.color + '|' + cs.backgroundColor;
    if (!seen.has(key) || seen.get(key).ratio > ratio) seen.set(key, { text: el.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, ok: ratio >= need });
  }
  const all = [...seen.values()];
  return JSON.stringify({ checked: all.length, min: Math.min(...all.map((x) => x.ratio)), failures: all.filter((x) => !x.ok) });
}`;

const result = { keyboard: [], contrast: {} };
cli("open", "about:blank");
cli("resize", "1440", "900");
cli("goto", `${base}/workstation?t=end`);
wait(2500);
for (let i = 0; i < 26; i++) {
  cli("press", "Tab");
  const a = evalJson(`() => { const e = document.activeElement; const cs = getComputedStyle(e); return JSON.stringify({ tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40), outline: cs.outlineStyle + ' ' + cs.outlineWidth, visible: e.getBoundingClientRect().width > 0 }); }`);
  result.keyboard.push(a);
}
result.keyboard_focus_ring_on_every_stop = result.keyboard.every((k) => k.outline.startsWith("solid") && k.visible);
for (const theme of ["dark", "light"]) {
  evalJson(`() => { ${theme === "light" ? "document.documentElement.dataset.theme='light'" : "delete document.documentElement.dataset.theme"}; return JSON.stringify({ok:true}); }`);
  wait(200);
  result.contrast[theme] = evalJson(CONTRAST);
  // with the evidence drawer open
  evalJson(`() => { const b = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'').startsWith('Evidence for best')); b && b.click(); return JSON.stringify({ok:true}); }`);
  wait(300);
  result.contrast[`${theme}-evidence-open`] = evalJson(CONTRAST);
}
cli("close");
writeFileSync(`${out}/a11y.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ focusRing: result.keyboard_focus_ring_on_every_stop, stops: result.keyboard.map((k) => k.label), contrast: Object.fromEntries(Object.entries(result.contrast).map(([k, v]) => [k, { checked: v.checked, min: v.min, failures: v.failures }])) }, null, 1));
