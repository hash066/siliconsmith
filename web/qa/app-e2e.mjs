// End-to-end check of /app against a running server: tour, pane resizing, workbenches, deep links, agent actions, overflow at six widths.
//   BASE=http://localhost:3000 PW=E:/Winter/tools/pw/package.json PLAYWRIGHT_BROWSERS_PATH=E:/Winter/tools/pw-browsers node qa/app-e2e.mjs [shots-dir]
// Board and Matter calls hit the real hosted functions behind /api/board and /api/matter, so those must be reachable from BASE.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const require = createRequire(`file:///${(process.env.PW ?? "E:/Winter/tools/pw/package.json").replace(/\\/g, "/")}`);
const { chromium } = require("playwright");
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name} ${extra}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra ? " :: " + extra : ""}`);
};

const browser = await chromium.launch();
const newPage = async (width, height, { seen = true, theme = "dark" } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  if (seen) await page.addInitScript(() => { try { if (!sessionStorage.getItem("__init")) { localStorage.setItem("hw-app-tour-seen-v1", "1"); sessionStorage.setItem("__init", "1"); } } catch {} });
  if (theme === "light") await page.addInitScript(() => { try { localStorage.setItem("ss-theme", "light"); } catch {} });
  return { ctx, page, errors };
};
const action = (page, name, args = {}) =>
  page.evaluate(
    ([name, args]) =>
      new Promise((resolve) => {
        let answered = false;
        window.dispatchEvent(new CustomEvent("hw:ui-action", { detail: { action: { name, args }, respond: (p) => { answered = true; p.then(resolve); } } }));
        if (!answered) resolve({ ok: false, summary: "NO LISTENER" });
      }),
    [name, args],
  );

// ---------- 1. tour
{
  const { ctx, page, errors } = await newPage(1440, 900, { seen: false });
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  const dlg = page.getByRole("dialog", { name: /Welcome/ });
  ok("tour opens on first visit", await dlg.isVisible());
  ok("tour says Step 1 of 5", (await page.getByTestId("tour-step").innerText()).toLowerCase().includes("step 1 of 5"));
  ok("tour is modal", (await dlg.getAttribute("aria-modal")) === "true");
  const titles = [];
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: /^Next$/ }).click();
    await page.waitForTimeout(350);
    titles.push(await page.locator("#tour-title").innerText());
    const ring = await page.locator(".ring-2").count();
    ok(`tour step ${i + 2} spotlights its element`, ring === 1);
  }
  ok("tour walks the 5 steps", titles.join("|") === "Three workbenches|Canvas and workflow|The Agent|Credits and evidence", titles.join("|"));
  await page.getByRole("button", { name: /^Back$/ }).click();
  ok("tour Back works", (await page.locator("#tour-title").innerText()) === "The Agent");
  let inside = true;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    inside = inside && (await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
  }
  ok("tour traps focus", inside);
  await page.keyboard.press("Escape");
  ok("Esc closes the tour", (await page.getByTestId("tour").count()) === 0);
  ok("tour flag persisted", (await page.evaluate(() => localStorage.getItem("hw-app-tour-seen-v1"))) === "1");
  await page.reload({ waitUntil: "networkidle" });
  ok("tour does not return after being seen", (await page.getByTestId("tour").count()) === 0);
  await page.getByTestId("nav-tour").click();
  ok("Tour button replays it", (await page.getByTestId("tour").count()) === 1 && (await page.getByTestId("tour-step").innerText()).toLowerCase().includes("step 1"));
  await page.getByRole("button", { name: "Skip tour" }).click();
  ok("Skip tour closes", (await page.getByTestId("tour").count()) === 0);
  ok("tour page has no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------- 2. panes
{
  const { ctx, page } = await newPage(1440, 900);
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  const cols = () => page.getByTestId("panes").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").map(parseFloat));
  const before = await cols();
  const sep = page.getByRole("separator", { name: "Resize the inputs pane" });
  const box = await sep.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + 200, { steps: 6 });
  await page.mouse.up();
  const after = await cols();
  ok("dragging the left handle widens the inputs pane", after[0] - before[0] >= 60, `${before[0]} -> ${after[0]}`);
  ok("centre stays at least 380 px", after[2] >= 380, String(after[2]));
  const v0 = Number(await sep.getAttribute("aria-valuenow"));
  await sep.focus();
  await page.keyboard.press("ArrowRight");
  const v1 = Number(await sep.getAttribute("aria-valuenow"));
  ok("arrow key moves the handle by 16 px", v1 - v0 === 16, `${v0} -> ${v1}`);
  await page.keyboard.press("Home");
  ok("Home resets the pane", Number(await sep.getAttribute("aria-valuenow")) === 300);
  await page.getByRole("button", { name: "Collapse Agent" }).click();
  const c2 = await cols();
  ok("collapse shrinks the agent pane to the slim rail", c2[4] === 44, String(c2[4]));
  await page.reload({ waitUntil: "networkidle" });
  const c3 = await cols();
  ok("pane sizes persist across reload", c3[4] === 44, String(c3[4]));
  await page.getByRole("button", { name: "Expand Agent" }).click();
  ok("expand restores the agent pane", (await cols())[4] > 100);
  await ctx.close();
}

// ---------- 3. workbenches, real tools
{
  const { ctx, page, errors } = await newPage(1440, 900);
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  ok("Silicon lists five recorded runs", (await page.locator("[data-testid^=run-]").count()) === 5);
  await page.getByTestId("run-r_w2_final3").click();
  await page.waitForTimeout(1200);
  ok("picking a run opens it", (await page.getByTestId("app-root").innerText()).includes("Monocypher"));
  await page.getByTestId("wb-matter").click();
  await page.getByTestId("matter-simulate").click();
  await page.getByText("Ladder M1").first().waitFor({ timeout: 20000 });
  ok("Matter simulate shows a real result", (await page.getByTestId("app-root").innerText()).toLowerCase().includes("ladder m1"));
  await page.getByRole("button", { name: /Evidence for|^ev$/i }).first().click().catch(() => {});
  await page.getByTestId("wb-board").click();
  await page.getByTestId("tpl-fault_gpio12_vs_gpio14").click();
  await page.waitForTimeout(150);
  await page.waitForFunction(() => !document.querySelector("[data-testid=board-check]")?.disabled);
  await page.getByTestId("board-check").click();
  await page.getByText("4 of 5 rungs pass. Unknown").first().waitFor({ timeout: 20000 });
  ok("Board check reports B4 failing on the GPIO fault template", (await page.getByTestId("app-root").innerText()).includes("B4"));
  await page.getByRole("button", { name: "Evidence for rung B4" }).click();
  ok("evidence chip opens the evidence drawer", (await page.getByRole("tab", { name: /Evidence/ }).count()) > 0 && (await page.getByText(/Rung\s*B4/).count()) > 0);
  ok("workbench pages have no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------- 4. deep links
{
  const { ctx, page } = await newPage(1440, 900);
  const p = Buffer.from(JSON.stringify({ generator: "rect_fins", gen_params: { n_fins: 10 }, spreader: { Q: 3 } })).toString("base64url");
  await page.goto(`${BASE}/app?wb=matter&p=${p}&autorun=1`, { waitUntil: "networkidle" });
  await page.getByText("Ladder M1").first().waitFor({ timeout: 20000 });
  ok("matter deep link applies params and autoruns", (await page.locator("#gp-n_fins").inputValue()) === "10" && (await page.locator("#sp-Q").inputValue()) === "3");
  await page.goto(`${BASE}/app?wb=board&template=fault_strapping_pin&autorun=1`, { waitUntil: "networkidle" });
  await page.getByText(/rungs pass\. Unknown|All five rungs/).first().waitFor({ timeout: 20000 });
  ok("board deep link loads the template and checks it", (await page.getByTestId("tpl-fault_strapping_pin").getAttribute("aria-checked")) === "true");
  await page.goto(`${BASE}/app?wb=silicon&run=r_w1_final&t=end`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  ok("silicon deep link opens the run", (await page.getByTestId("run-r_w1_final").getAttribute("aria-current")) === "true");
  await page.goto(`${BASE}/app?wb=matter&p=%%%broken`, { waitUntil: "networkidle" });
  ok("a malformed link still opens the workbench", (await page.locator("#gp-n_fins").count()) === 1);
  await page.goto(`${BASE}/workstation?run=r_w1_final`, { waitUntil: "networkidle" });
  ok("/workstation redirects to the app", page.url().includes("/app?wb=silicon&run=r_w1_final"), page.url());
  await page.goto(`${BASE}/workstation/library`, { waitUntil: "networkidle" });
  ok("old Library URL leads to the app, not a page", new URL(page.url()).pathname === "/app", page.url());
  await ctx.close();
}

// ---------- 5. agent actions
{
  const { ctx, page } = await newPage(1440, 900);
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  let r = await action(page, "workbench.open", { workbench: "board" });
  ok("action workbench.open", r.ok && /Board/.test(r.summary), r.summary);
  r = await action(page, "board.load_template", { template_id: "fault_gpio12_vs_gpio14" });
  ok("action board.load_template", r.ok && /fault_gpio12_vs_gpio14/.test(r.summary), r.summary);
  r = await action(page, "board.check");
  ok("action board.check returns the real rung outcome", r.ok && /4 of 5 rungs pass/.test(r.summary) && /B4/.test(r.summary), r.summary);
  r = await action(page, "board.load_template", { template_id: "nope_not_real" });
  ok("unknown template is refused honestly", !r.ok, r.summary);
  r = await action(page, "board.set_design", { design: "not an object" });
  ok("invalid design is refused", !r.ok, r.summary);
  r = await action(page, "matter.set_params", { generator: "rect_fins", gen_params: { n_fins: 6 } });
  ok("action matter.set_params", r.ok && /n_fins=6/.test(r.summary), r.summary);
  r = await action(page, "matter.set_params", { gen_params: { n_fins: 99 } });
  ok("out-of-range params are refused, not clamped", !r.ok && /n_fins/.test(r.summary), r.summary);
  r = await action(page, "matter.set_params", { gen_params: { bogus: 1 } });
  ok("unknown param is refused", !r.ok, r.summary);
  r = await action(page, "matter.simulate");
  ok("action matter.simulate returns real numbers", r.ok && /Peak [\d.]+ °C/.test(r.summary), r.summary);
  r = await action(page, "silicon.open_run", { run_id: "r_w1_contree3" });
  ok("action silicon.open_run", r.ok && /r_w1_contree3/.test(r.summary), r.summary);
  r = await action(page, "silicon.open_run", { run_id: "r_nope" });
  ok("unknown run is refused", !r.ok, r.summary);
  r = await action(page, "workflow.focus", { step: "brief" });
  ok("action workflow.focus", r.ok, r.summary);
  r = await action(page, "workflow.focus", { step: "evidence" });
  ok("action workflow.focus evidence opens the drawer", r.ok && (await page.getByRole("tablist", { name: "Evidence views" }).count()) === 1, r.summary);
  await page.getByRole("button", { name: "Runs and history" }).click();
  ok("history lists real action outcomes", (await page.getByRole("dialog", { name: "Runs and history" }).innerText()).includes("Agent · board.check"));
  await ctx.close();
}

// ---------- 6. six widths, three workbenches, light and dark
const WIDTHS = [360, 390, 705, 768, 1024, 1440];
const URLS = { silicon: "/app?wb=silicon&run=r_w1_contree3&t=end", board: "/app?wb=board&template=fault_gpio12_vs_gpio14&autorun=1", matter: "/app?wb=matter&autorun=1" };
for (const theme of ["dark", "light"]) {
  for (const w of WIDTHS) {
    const { ctx, page, errors } = await newPage(w, w < 700 ? 800 : 900, { theme });
    for (const [wb, url] of Object.entries(URLS)) {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(wb === "silicon" ? 1200 : 2200);
      const narrow = w < 1024;
      for (const tab of narrow ? ["inputs", "canvas", "agent"] : ["canvas"]) {
        if (narrow) await page.getByTestId(`tab-${tab}`).click();
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const over = [];
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.right <= de.clientWidth + 1 || el.closest("svg") || getComputedStyle(el).position === "fixed") continue;
            // clipped by a scrolling or hidden ancestor = intentional inner scroll, not page overflow
            let clipped = false;
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const ox = getComputedStyle(a).overflowX;
              if (ox !== "visible") { clipped = true; break; }
            }
            if (!clipped) over.push(el.tagName + "." + String(el.className).slice(0, 40));
          }
          return { sw: de.scrollWidth, cw: de.clientWidth, over: over.slice(0, 3) };
        });
        ok(`no horizontal overflow ${theme} ${w}px ${wb}/${tab}`, m.sw <= m.cw && m.over.length === 0, JSON.stringify(m));
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${theme}-${w}-${wb}-${tab}.png` });
      }
    }
    ok(`no console errors ${theme} ${w}px`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }
}

// ---------- 7. narrow tour switches panes
{
  const { ctx, page } = await newPage(390, 800, { seen: false });
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^Next$/ }).click();
  await page.waitForTimeout(400);
  ok("narrow tour shows the Agent pane for step 4", (await page.getByTestId("tab-agent").getAttribute("aria-selected")) === "true" && (await page.locator(".ring-2").count()) === 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-390-agent.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
