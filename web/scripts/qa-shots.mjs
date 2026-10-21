// Screenshot QA with playwright-cli: every screen at 1440 and 390 px wide.
//   node scripts/qa-shots.mjs [baseUrl] [outDir] [filter]
// Needs `npm i -g @playwright/cli` and the app running (npm run build && npm start, or npm run dev).

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3217";
const out = process.argv[3] ?? "qa";
const filter = process.argv[4] ?? "";
mkdirSync(out, { recursive: true });

const SCREENS = [
  { name: "landing", path: "/", full: true, wait: 4000 },
  { name: "run-demo-end", path: "/runs/r_mock_demo?t=end&node=n1", full: false, wait: 2500 },
  { name: "run-demo-cex", path: "/runs/r_mock_demo?t=232&speed=1", full: false, wait: 2500 },
  { name: "run-real", path: "/runs/r_m4_first?t=end", full: false, wait: 2500 },
  { name: "report-demo", path: "/runs/r_mock_demo/report", full: true, wait: 3000 },
  { name: "report-real", path: "/runs/r_m4_first/report", full: true, wait: 3000 },
  { name: "try", path: "/try", full: true, wait: 2000 },
  { name: "how", path: "/how", full: true, wait: 2000 },
];
const WIDTHS = [
  { w: 1440, h: 900, tag: "1440" },
  { w: 390, h: 844, tag: "390" },
];

// On Windows the CLI is a .cmd shim, so it runs through the shell: quote every argument.
const win = process.platform === "win32";
const q = (a) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);
const cli = (...args) => execFileSync("playwright-cli", ["-s=qa", ...args].map(q), { stdio: "pipe", shell: win }).toString();

cli("open", "about:blank");
for (const { w, h, tag } of WIDTHS) {
  cli("resize", String(w), String(h));
  for (const s of SCREENS) {
    if (filter && !s.name.includes(filter)) continue;
    cli("goto", `${base}${s.path}`);
    cli("eval", `() => new Promise(r => setTimeout(r, ${s.wait}))`);
    const file = `${out}/${s.name}-${tag}.png`;
    cli("screenshot", "--filename", file, ...(s.full ? ["--full-page"] : []));
    console.log("saved", file);
  }
}
cli("close");
