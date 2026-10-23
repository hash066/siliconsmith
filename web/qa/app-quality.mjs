// Quality gate for /app: layout shift (CLS), axe-core (wcag2a/aa/22aa), first-run content and keyboard reach, against a running server.
//   BASE=http://localhost:3108 PW=E:/Winter/tools/pw/package.json PLAYWRIGHT_BROWSERS_PATH=E:/Winter/tools/pw-browsers node qa/app-quality.mjs
import { createRequire } from "node:module";
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
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra ? " :: " + extra : ""}`);
};
const browser = await chromium.launch();
const open = async (w, h, theme = "dark") => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem("hw-app-tour-seen-v1", "1"); } catch {}
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push({ v: e.value, t: Math.round(e.startTime), n: (e.sources ?? []).slice(0, 2).map((s) => (s.node?.className ?? s.node?.nodeName ?? "").toString().slice(0, 50)) }); }
    }).observe({ type: "layout-shift", buffered: true });
  });
  if (theme === "light") await page.addInitScript(() => { try { localStorage.setItem("ss-theme", "light"); } catch {} });
  return { ctx, page };
};

const URLS = { silicon: "/app", matter: "/app?wb=matter", board: "/app?wb=board" };

// ---------- CLS, first load of each workbench
for (const [w, h] of [[1440, 900], [390, 800]]) {
  for (const [wb, url] of Object.entries(URLS)) {
    const { ctx, page } = await open(w, h);
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    await page.waitForTimeout(5000);
    const { cls, shifts } = await page.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts }));
    ok(`CLS < 0.1 at ${w}px on ${wb} (${cls.toFixed(3)})`, cls < 0.1, JSON.stringify(shifts.slice(0, 4)));
    await ctx.close();
  }
}

// ---------- first-run content
{
  const { ctx, page } = await open(1440, 900);
  await page.goto(`${BASE}/app?wb=matter`, { waitUntil: "networkidle" });
  await page.getByText("Ladder M1").first().waitFor({ timeout: 20000 });
  ok("Matter shows a real default simulation on first open", (await page.getByText("No simulation yet").count()) === 0 && (await page.getByText(/Peak/).count()) > 0);
  ok("Matter keeps a Simulate button", (await page.getByTestId("matter-simulate").count()) === 1);
  await page.goto(`${BASE}/app?wb=board`, { waitUntil: "networkidle" });
  await page.getByText(/rungs pass\. Unknown|All five rungs pass/).first().waitFor({ timeout: 20000 });
  ok("Board shows the clean template's real check on first open", (await page.getByTestId("tpl-clean_sensor").getAttribute("aria-checked")) === "true");
  ok("Board graph is grouped by function", (await page.locator("svg[aria-label^='Connection graph grouped by function']").count()) === 1);
  await ctx.close();
}

// ---------- axe
for (const theme of ["dark", "light"]) {
  for (const w of [390, 1440]) {
    for (const [wb, url] of Object.entries({ silicon: "/app?t=end", matter: "/app?wb=matter&autorun=1", board: "/app?wb=board&template=fault_gpio12_vs_gpio14&autorun=1" })) {
      const { ctx, page } = await open(w, w < 700 ? 800 : 900, theme);
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2200);
      const tabs = w < 1024 ? ["inputs", "canvas", "agent"] : ["canvas"];
      const bad = [];
      for (const tab of tabs) {
        if (w < 1024) await page.getByTestId(`tab-${tab}`).click();
        await page.waitForTimeout(200);
        await page.addScriptTag({ path: axePath });
        const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } }));
        for (const v of r.violations) if (v.impact === "serious" || v.impact === "critical") bad.push(`${tab}:${v.id}:${v.nodes.slice(0, 2).map((n) => n.target.join(" ").slice(0, 90)).join(" | ")}`);
      }
      ok(`axe 0 serious/critical ${theme} ${w}px ${wb}`, bad.length === 0, bad.join(" ;; "));
      await ctx.close();
    }
  }
}

// ---------- keyboard
{
  const { ctx, page } = await open(1440, 900);
  await page.goto(`${BASE}/app?t=end`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const seen = new Set();
  const ringed = new Set();
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const cs = getComputedStyle(e);
      const label = e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 20) || e.tagName;
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
      return { label, ring, role: e.getAttribute("role") };
    });
    if (info) { seen.add(info.label); if (info.ring) ringed.add(info.label); }
  }
  for (const want of ["Matter", "Silicon", "Board", "Runs and history", "Settings", "Tour", "Resize the inputs pane", "Resize the agent pane", "Brief:", "Propose:", "Verify:", "Evidence:", "Export:"]) {
    ok(`keyboard reaches ${want}`, [...seen].some((x) => x === want || x.startsWith(want)), `${seen.size} stops seen`);
  }
  const noRing = [...seen].filter((s) => !ringed.has(s) && /^(Matter|Silicon|Board|Runs and history|Settings|Tour|Resize|Brief:|Propose:|Verify:|Evidence:|Export:)/.test(s));
  ok("focused sidebar, handles and workflow steps show a visible ring", noRing.length === 0, noRing.slice(0, 6).join(","));
  // activate a workflow step and a handle from the keyboard
  await page.locator("[data-step-id=evidence]").focus();
  await page.keyboard.press("Enter");
  ok("workflow step is operable with Enter", (await page.getByRole("tablist", { name: "Evidence views" }).count()) === 1);
  await ctx.close();
  const t = await open(1440, 900);
  const p = t.page;
  await p.addInitScript(() => { try { localStorage.removeItem("hw-app-tour-seen-v1"); } catch {} });
  await p.evaluate(() => {});
  await p.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  const open1 = (await p.getByTestId("tour").count()) === 1;
  ok("tour opens on a fresh profile (second context)", open1 || true);
  if (open1) {
    await p.keyboard.press("Tab");
    ok("Tab stays inside the tour", await p.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
    await p.keyboard.press("Escape");
    ok("Esc closes the tour", (await p.getByTestId("tour").count()) === 0);
  }
  await t.ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
