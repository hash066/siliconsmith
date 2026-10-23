// Quality gate for the UX v2 app: layout shift (CLS), axe-core (wcag2a/aa/22aa), first-run content and keyboard reach, against a running server.
//   BASE=http://localhost:3108 PW=E:/Winter/tools/pw/package.json PLAYWRIGHT_BROWSERS_PATH=E:/Winter/tools/pw-browsers node qa/app-quality.mjs
import { createRequire } from "node:module";
import { installSiliconMock } from "./mock-silicon.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = process.env.PW ?? "E:/Winter/tools/pw/package.json";
const require = createRequire(`file:///${PW}`);
const { chromium } = require("playwright");
const axePath = require.resolve("axe-core/axe.min.js");

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name} ${extra}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra ? " :: " + String(extra).slice(0, 400) : ""}`);
};
const browser = await chromium.launch();
const open = async (w, h, theme = "dark", { silicon = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem("hw-app-coach-v2", "1"); } catch {}
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push({ v: +e.value.toFixed(3), t: Math.round(e.startTime), n: (e.sources ?? []).slice(0, 2).map((s) => (s.node?.className ?? s.node?.nodeName ?? "").toString().slice(0, 50)) }); }
    }).observe({ type: "layout-shift", buffered: true });
  });
  if (theme === "light") await page.addInitScript(() => { try { localStorage.setItem("ss-theme", "light"); } catch {} });
  if (silicon) await installSiliconMock(page, { delayMs: 30 });
  return { ctx, page };
};
const settle = (page) => page.waitForFunction(() => { const v = document.querySelector("[data-testid=verdict]"); return !v || ["green", "amber", "red"].includes(v.getAttribute("data-tone")); }, null, { timeout: 30000 }).catch(() => {});
const runAxe = async (page) => {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } }));
};
const serious = (r, tag) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${tag}:${v.id}:${v.nodes.slice(0, 2).map((n) => n.target.join(" ").slice(0, 90)).join(" | ")}`);

const URLS = { start: "/app", silicon: "/app?wb=silicon", matter: "/app?wb=matter", board: "/app?wb=board" };

// ---------- CLS
for (const [w, h] of [[1440, 900], [390, 800]]) {
  for (const [name, url] of Object.entries(URLS)) {
    const { ctx, page } = await open(w, h);
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    await page.waitForTimeout(5000);
    const { cls, shifts } = await page.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts }));
    ok(`CLS < 0.1 at ${w}px on ${name} (${cls.toFixed(3)})`, cls < 0.1, JSON.stringify(shifts.slice(0, 4)));
    await ctx.close();
  }
  const { ctx, page } = await open(w, h);
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await page.getByTestId("example-matter").click();
  await page.waitForTimeout(5000);
  const cls = await page.evaluate(() => window.__cls);
  ok(`CLS < 0.1 at ${w}px through start -> matter workspace (${cls.toFixed(3)})`, cls < 0.1);
  await ctx.close();
}

// ---------- first-run content
{
  const { ctx, page } = await open(1440, 900);
  await page.goto(`${BASE}/app?wb=matter`, { waitUntil: "networkidle" });
  await settle(page);
  ok("Matter shows a real default result on first open", (await page.getByText("No simulation yet").count()) === 0 && /°C/.test(await page.getByTestId("verdict").innerText()));
  await page.goto(`${BASE}/app?wb=board`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("[data-testid=verdict]")?.getAttribute("data-tone") === "green", null, { timeout: 30000 }).catch(() => {});
  ok("Board shows the clean template's real check on first open", (await page.getByTestId("verdict").getAttribute("data-tone")) === "green");
  await ctx.close();
}

// ---------- axe
for (const theme of ["dark", "light"]) {
  for (const w of [390, 1440]) {
    for (const [name, url] of Object.entries({ start: "/app", silicon: "/app?wb=silicon", matter: "/app?wb=matter&autorun=1", board: "/app?wb=board&template=fault_gpio12_vs_gpio14&autorun=1" })) {
      const { ctx, page } = await open(w, w < 700 ? 800 : 900, theme, { silicon: name === "silicon" });
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      await settle(page);
      await page.waitForTimeout(800);
      const bad = [];
      if (name === "start") bad.push(...serious(await runAxe(page), "start"));
      else {
        if (name === "silicon") {
          await page.getByTestId("silicon-run-live").click().catch(() => {});
          await page.waitForFunction(() => document.querySelector("[data-testid=verdict]")?.getAttribute("data-tone") === "green", null, { timeout: 30000 }).catch(() => {});
        }
        if (w < 1024) {
          await page.getByTestId("pane-chat").click();
          bad.push(...serious(await runAxe(page), "chat"));
          await page.getByTestId("pane-preview").click();
        }
        for (const t of ["preview", "files", "proof"]) {
          await page.getByTestId(`ptab-${t}`).click();
          await page.waitForTimeout(150);
          bad.push(...serious(await runAxe(page), t));
        }
        await page.getByTestId("advanced-open").click();
        await page.waitForTimeout(250);
        bad.push(...serious(await runAxe(page), "advanced"));
      }
      ok(`axe 0 serious/critical ${theme} ${w}px ${name}`, bad.length === 0, bad.join(" ;; "));
      await ctx.close();
    }
  }
}

// ---------- keyboard
{
  const { ctx, page } = await open(1440, 900);
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  const labels = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    labels.push(await page.evaluate(() => { const e = document.activeElement; return e.getAttribute("aria-label") || e.getAttribute("data-testid") || e.textContent?.trim().slice(0, 24) || e.tagName; }));
  }
  for (const want of ["TEXTAREA", "chip-auto", "chip-matter", "chip-board", "chip-silicon", "example-matter", "example-board", "example-silicon"]) ok(`start: keyboard reaches ${want}`, labels.some((l) => l === want || l.includes(want)), labels.join(","));
  await page.getByLabel("What do you want to make?").fill("a heat sink");
  await page.getByLabel("What do you want to make?").press("Enter");
  await page.getByTestId("workspace").waitFor();
  await settle(page);
  const seen = new Set();
  const noRing = new Set();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); const own = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none"; return { l: e.getAttribute("data-testid") || e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 20) || e.tagName, ring: own }; });
    seen.add(info.l);
    if (!info.ring && /^(wb-|ptab-|download|advanced-open|start-over|share|coach-open)/.test(info.l)) noRing.add(info.l);
  }
  for (const want of ["coach-open", "credits-pill", "wb-matter", "wb-silicon", "wb-board", "download", "advanced-open", "start-over", "ptab-preview"]) ok(`workspace: keyboard reaches ${want}`, [...seen].some((s) => s.includes(want)), [...seen].slice(0, 30).join(","));
  ok("workspace: focused controls show a visible ring", noRing.size === 0, [...noRing].join(","));
  await page.getByTestId("ptab-proof").focus();
  await page.keyboard.press("Enter");
  ok("a tab is operable with Enter", (await page.getByTestId("ptab-proof").getAttribute("aria-selected")) === "true");
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
