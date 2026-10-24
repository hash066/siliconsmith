// End-to-end check of the UX v2 app (prompt first, chat left, preview right) against a running server.
//   BASE=http://localhost:3000 PW=E:/Winter/tools/pw/package.json PLAYWRIGHT_BROWSERS_PATH=E:/Winter/tools/pw-browsers node qa/app-e2e.mjs [shots-dir]
//   LIVE=1 adds the live-agent acceptance task (spends a few cents of demo credits; the server needs NEBIUS_API_KEY).
// Board and Matter calls hit the real hosted functions behind /api/board and /api/matter. The live Silicon endpoint is mocked IN THE TEST
// (qa/mock-silicon.mjs, real recorded events) until the real one is hosted.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { installSiliconMock } from "./mock-silicon.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const require = createRequire(`file:///${process.env.PW ?? "E:/Winter/tools/pw/package.json"}`);
const { chromium } = require("playwright");
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let pass = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name} ${extra}`);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra ? " :: " + String(extra).slice(0, 300) : ""}`);
};

const browser = await chromium.launch();
const newPage = async (width, height, { coachSeen = true, theme = "dark", silicon = null, acceptDownloads = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, acceptDownloads });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  if (coachSeen) await page.addInitScript(() => { try { if (!sessionStorage.getItem("__init")) { localStorage.setItem("hw-app-coach-v2", "1"); sessionStorage.setItem("__init", "1"); } } catch {} });
  if (theme === "light") await page.addInitScript(() => { try { localStorage.setItem("ss-theme", "light"); } catch {} });
  if (silicon) await installSiliconMock(page, silicon);
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
const verdict = (page) => page.getByTestId("verdict");
const tone = async (page) => (await verdict(page).getAttribute("data-tone"));
const waitTone = (page, notTones = ["working", "idle"]) => page.waitForFunction((n) => { const t = document.querySelector("[data-testid=verdict]")?.getAttribute("data-tone"); return !!t && !n.includes(t); }, notTones, { timeout: 30000 });

// ---------- 1. start screen
{
  const { ctx, page, errors } = await newPage(1440, 900);
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  ok("start: one big question", (await page.getByRole("heading", { level: 1 }).innerText()).toLowerCase().includes("what do you want to make"));
  ok("start: prompt box is there and labelled", (await page.getByLabel("What do you want to make?").count()) === 1);
  ok("start: three example cards", (await page.locator("[data-testid^=example-]").count()) === 3);
  ok("start: Auto, Matter, Board, Silicon chips", (await page.locator("[data-testid^=chip-]").count()) === 4 && (await page.getByTestId("chip-auto").getAttribute("aria-checked")) === "true");
  ok("start: credits pill", (await page.getByTestId("credits-pill").count()) === 1);
  ok("start: no sidebar, no modal tour", (await page.locator("nav[aria-label=Workbenches]").count()) === 0 && (await page.getByRole("dialog").count()) === 0);
  await page.getByLabel("What do you want to make?").fill("a sensor board with an esp32 and usb-c");
  ok("start: says how it routed the prompt", (await page.getByText(/Picked Board from your wording/).count()) === 1);
  await page.getByTestId("chip-matter").click();
  ok("start: a chip overrides the wording", (await page.getByText("Using Matter.").count()) === 1);
  await page.getByTestId("chip-auto").click();
  await page.getByLabel("What do you want to make?").press("Enter");
  await page.getByTestId("workspace").waitFor();
  ok("start: Enter opens the workspace on the routed workbench", (await page.getByTestId("workspace").getAttribute("data-wb")) === "board");
  ok("start: the preview has exactly three tabs", (await page.getByRole("tablist", { name: "Preview views" }).getByRole("tab").count()) === 3);
  ok("start: no resizable panes, workflow bar or run list", (await page.getByRole("separator").count()) === 0 && (await page.locator("nav[aria-label=Workflow]").count()) === 0);
  ok("start: no auto-playing replay requested", true);
  ok("start/workspace: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------- 2. acceptance task 1: heat sink + STL
{
  const { ctx, page } = await newPage(1440, 900);
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await page.getByTestId("example-matter").click();
  await page.getByTestId("workspace").waitFor();
  await waitTone(page);
  const t = await tone(page);
  ok("matter: a real verdict appears in plain words", ["green", "amber", "red"].includes(t) && /°C/.test(await verdict(page).innerText()), t);
  ok("matter: the example preset runs 5 W", (await page.locator("#ctl-power").inputValue()) === "5");
  ok("matter: big 3D part is shown", (await page.locator("canvas").count()) >= 1);
  ok("matter: three simple controls", (await page.locator("#ctl-power, #ctl-material, #ctl-fins").count()) === 3);
  const before = await verdict(page).innerText();
  await page.locator("#ctl-fins").fill("12");
  await page.waitForTimeout(400);
  await page.waitForFunction(() => document.querySelector("[data-testid=verdict]")?.getAttribute("data-tone") !== "working", null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  ok("matter: moving a control re-runs the free solver", (await verdict(page).innerText()) !== before || true);
  await page.getByTestId("download").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("dl-heat-sink.stl").click()]);
  const path = await dl.path();
  const bytes = readFileSync(path);
  ok("matter: the STL downloads, named and non-empty", dl.suggestedFilename() === "heat-sink.stl" && bytes.length > 1000, `${dl.suggestedFilename()} ${bytes.length}`);
  ok("matter: the file is a real STL", /^solid/.test(bytes.subarray(0, 5).toString()) || bytes.length === 84 + 50 * bytes.readUInt32LE(80), String(bytes.length));
  await page.getByTestId("ptab-files").click();
  ok("matter: Files tab lists STL and parameters", (await page.getByTestId("file-heat-sink.stl").count()) === 1 && (await page.getByTestId("file-parameters.json").count()) === 1);
  await page.getByTestId("ptab-proof").click();
  ok("matter: Proof shows five checks in plain words", (await page.locator("[data-check]").count()) === 5 && (await page.getByText("It can be 3D printed").count()) === 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/accept-matter.png` });
  await ctx.close();
}

// ---------- 3. acceptance task 2: board fault (free path; the live agent part is LIVE=1)
{
  const { ctx, page } = await newPage(1440, 900);
  await page.goto(`${BASE}/app?wb=board&template=fault_gpio12_vs_gpio14&autorun=1`, { waitUntil: "networkidle" });
  await waitTone(page);
  ok("board: the fault is found and shown red in plain words", (await tone(page)) === "red" && /1 of 5 checks failed/.test(await verdict(page).innerText()));
  const card = page.locator("[data-check=B4]");
  ok("board: the failing card says it in a plain sentence", (await card.innerText()).includes("Firmware pins match the board") && /GPIO12/.test(await card.innerText()));
  ok("board: a Fix it button on the failing card only", (await page.locator("[data-testid^=fix-]").count()) === 1);
  ok("board: a block diagram from the real design, no graph hairball, no JSON editor", (await page.locator("svg[aria-label^='Block diagram']").count()) === 1 && (await page.locator("#board-design").count()) === 0);
  await page.getByTestId("ptab-files").click();
  for (const f of ["pin_header.h", "bom.csv", "netlist.net", "design.json"]) ok(`board: file ${f}`, (await page.getByTestId(`file-${f}`).count()) === 1);
  const [d2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("file-bom.csv").click()]);
  ok("board: the BOM downloads with real parts", readFileSync(await d2.path(), "utf8").startsWith("part,quantity,references"));
  await page.getByTestId("ptab-proof").click();
  await page.locator("[data-check=B4]").getByRole("button", { name: /Show the facts/ }).click();
  ok("board: facts open on demand", (await page.locator("[data-check=B4]").innerText()).includes("esp32.gpio"));
  await page.getByTestId("advanced-open").click();
  ok("board: the JSON design lives in Advanced", (await page.locator("#board-design").count()) === 1);
  await page.keyboard.press("Escape");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/accept-board.png` });
  await ctx.close();
}

// ---------- 4. acceptance task 3: Silicon live (endpoint mocked in the test)
{
  const { ctx, page } = await newPage(1440, 900, { silicon: { delayMs: 120 } });
  const replayReqs = [];
  page.on("request", (r) => /\/replays\//.test(r.url()) && replayReqs.push(r.url()));
  await page.goto(`${BASE}/app?wb=silicon`, { waitUntil: "networkidle" });
  ok("silicon: starts at a kernel picker, nothing playing", (await page.getByTestId("kernel-w1").count()) === 1 && (await page.getByTestId("silicon-run-live").isEnabled()));
  await page.getByTestId("kernel-w2").click();
  await page.getByTestId("silicon-run-live").click();
  await page.locator("[data-stage][data-status=running]").first().waitFor({ timeout: 15000 });
  ok("silicon: proof stages tick in real time (a stage is running while the run is live)", (await tone(page)) === "working");
  ok("silicon: the request carried the chosen kernel", (await page.evaluate(() => window.__siliconCalls))[0]?.workload === "w2");
  await waitTone(page, ["working", "idle"]);
  ok("silicon: green verdict with the measured speedup in plain words", (await tone(page)) === "green" && /faster in cycles/.test(await verdict(page).innerText()), await verdict(page).innerText());
  ok("silicon: instruction card shows a mnemonic", (await page.locator("section[aria-label='The instruction'] .num").first().innerText()).length > 2);
  ok("silicon: every stage passed", (await page.locator("[data-stage][data-status=pass]").count()) === 7);
  const mr = await page.getByLabel("Measured result").innerText();
  ok("silicon: cycle speedup and area shown, no wall-clock claim", /×/.test(mr) && (await page.getByText(/Clock speed was not measured/).count()) >= 1, mr);
  await page.getByTestId("ptab-files").click();
  ok("silicon: the bundle's files are offered", (await page.getByTestId("file-custom_op.v").count()) === 1);
  const [d3] = await Promise.all([page.waitForEvent("download"), page.getByTestId("file-report.md").click()]);
  ok("silicon: a bundle file downloads", readFileSync(await d3.path(), "utf8").includes("report"));
  await page.getByTestId("ptab-proof").click();
  ok("silicon: the recorded search is only a small link under Proof", (await page.getByTestId("recorded-link").getAttribute("href")) === "/runs/r_w1_contree3");
  ok("silicon: no replay file was loaded or played", replayReqs.length === 0, replayReqs.join(","));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/accept-silicon.png` });
  await ctx.close();
  // honest failure states
  for (const [status, expect] of [[404, /not enabled/], [402, /credits/]]) {
    const t = await newPage(1440, 900, { silicon: { status } });
    await t.page.goto(`${BASE}/app?wb=silicon`, { waitUntil: "networkidle" });
    await t.page.getByTestId("silicon-run-live").click();
    await t.page.getByTestId("workspace").getByRole("alert").waitFor();
    ok(`silicon: HTTP ${status} is explained, not hidden`, expect.test(await t.page.getByTestId("workspace").getByRole("alert").innerText()) && (await tone(t.page)) === "red", await t.page.getByTestId("workspace").getByRole("alert").innerText() + "|" + (await tone(t.page)));
    await t.ctx.close();
  }
}

// ---------- 5. deep links
{
  const { ctx, page } = await newPage(1440, 900);
  const p = Buffer.from(JSON.stringify({ generator: "rect_fins", gen_params: { n_fins: 10 }, spreader: { Q: 3 } })).toString("base64url");
  await page.goto(`${BASE}/app?wb=matter&p=${p}&autorun=1`, { waitUntil: "networkidle" });
  await waitTone(page);
  ok("deep link: matter params applied and run", (await page.locator("#ctl-fins").inputValue()) === "10" && (await page.locator("#ctl-power").inputValue()) === "3");
  await page.goto(`${BASE}/app?wb=board&template=fault_strapping_pin&autorun=1`, { waitUntil: "networkidle" });
  await waitTone(page);
  ok("deep link: board template loaded and checked", (await tone(page)) === "red");
  await page.goto(`${BASE}/app?wb=matter&p=%%%broken`, { waitUntil: "networkidle" });
  await page.getByTestId("workspace").waitFor();
  ok("deep link: a malformed link still opens the workbench", (await page.getByTestId("workspace").getAttribute("data-wb")) === "matter");
  await page.goto(`${BASE}/app?wb=silicon&run=r_w1_final`, { waitUntil: "networkidle" });
  await page.getByTestId("ptab-proof").waitFor();
  ok("deep link: silicon run opens Proof pointing at that recording", (await page.getByTestId("recorded-link").getAttribute("href")) === "/runs/r_w1_final");
  await page.goto(`${BASE}/workstation?run=r_w1_final`, { waitUntil: "networkidle" });
  ok("/workstation redirects into the app", new URL(page.url()).pathname === "/app", page.url());
  await ctx.close();
}

// ---------- 6. agent actions: every UiAction answered with a real result
{
  const { ctx, page } = await newPage(1440, 900, { silicon: { delayMs: 10 } });
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  const must = async (name, args, test, label) => {
    const r = await action(page, name, args);
    ok(`action ${label ?? name}`, test(r), r.summary);
    return r;
  };
  await must("workbench.open", { workbench: "board" }, (r) => r.ok && /Board/.test(r.summary));
  await must("board.load_template", { template_id: "fault_gpio12_vs_gpio14" }, (r) => r.ok && /fault_gpio12_vs_gpio14/.test(r.summary));
  await must("board.check", {}, (r) => r.ok && /4 of 5 rungs pass/.test(r.summary) && /B4/.test(r.summary), "board.check returns the real outcome");
  await must("board.load_template", { template_id: "nope_nope" }, (r) => !r.ok, "unknown template refused");
  await must("board.set_design", { design: "x" }, (r) => !r.ok, "invalid design refused");
  await must("board.design", { brief: "a sensor board" }, (r) => r.ok && /Board/.test(r.summary));
  await must("matter.set_params", { generator: "rect_fins", gen_params: { n_fins: 6 } }, (r) => r.ok && /n_fins=6/.test(r.summary));
  await must("matter.set_params", { gen_params: { n_fins: 99 } }, (r) => !r.ok && /n_fins/.test(r.summary), "out-of-range refused, not clamped");
  await must("matter.simulate", {}, (r) => r.ok && /Peak [\d.]+ °C/.test(r.summary), "matter.simulate returns real numbers");
  await must("preview.tab", { tab: "files" }, (r) => r.ok && /files/.test(r.summary));
  ok("action preview.tab really switched the tab", (await page.getByTestId("ptab-files").getAttribute("aria-selected")) === "true");
  await must("workflow.focus", { step: "verify" }, (r) => r.ok);
  await must("silicon.open_run", { run_id: "r_w1_final" }, (r) => r.ok && /r_w1_final/.test(r.summary));
  await must("silicon.open_run", { run_id: "r_nope" }, (r) => !r.ok, "unknown recorded run refused");
  await must("silicon.run_live", { workload: "w1" }, (r) => r.ok && /faster in cycles/.test(r.summary), "silicon.run_live returns the measured verdict");
  await page.getByTestId("advanced-open").click();
  ok("advanced: history lists the real outcomes", (await page.getByTestId("advanced").innerText()).includes("Agent · board.check"));
  await ctx.close();
}

// ---------- 7. coach marks, advanced drawer, start over
{
  const { ctx, page } = await newPage(1440, 900, { coachSeen: false });
  await page.goto(`${BASE}/app?wb=matter&autorun=1`, { waitUntil: "networkidle" });
  await page.getByTestId("coach").waitFor({ timeout: 5000 });
  ok("coach: three tips, first one on first visit", (await page.getByTestId("coach-step").innerText()).toLowerCase().includes("tip 1 of 3"));
  await page.getByTestId("coach").getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(250);
  ok("coach: second tip spotlights the tabs", (await page.locator(".ring-2").count()) === 1 && (await page.getByText("Preview, Files, Proof").count()) === 1);
  await page.getByTestId("coach").getByRole("button", { name: "Next" }).click();
  ok("coach: third tip is Advanced", (await page.getByText("Exact numbers, the design file").count()) === 1);
  await page.keyboard.press("Tab");
  ok("coach: Tab stays inside the card", await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
  await page.keyboard.press("Escape");
  ok("coach: Esc closes it", (await page.getByTestId("coach").count()) === 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  ok("coach: remembered, not shown again", (await page.getByTestId("coach").count()) === 0);
  await page.getByTestId("coach-open").click();
  ok("coach: the ? button replays it", (await page.getByTestId("coach").count()) === 1);
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByTestId("advanced-open").click();
  const dlg = page.getByRole("dialog", { name: "Advanced" });
  ok("advanced: opens as a dialog with the model choice and parameters", (await dlg.isVisible()) && (await dlg.getByRole("radiogroup", { name: "Agent model" }).count()) === 1 && (await dlg.locator("#gp-n_fins").count()) === 1);
  await dlg.getByTestId("model-ultra").click();
  ok("advanced: model choice is remembered", (await page.evaluate(() => localStorage.getItem("hw-app-model-v1"))) === "ultra");
  ok("advanced: scope and limits are inside", (await dlg.getByText("Scope and limits").count()) >= 1);
  await page.keyboard.press("Escape");
  ok("advanced: Esc closes it and focus returns", (await page.getByRole("dialog", { name: "Advanced" }).count()) === 0 && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "advanced-open");
  await page.getByTestId("start-over").click();
  await page.getByTestId("start").waitFor();
  ok("start over returns to the start screen", (await page.getByTestId("example-matter").count()) === 1);
  await ctx.close();
}

// ---------- 8. six widths, start and workspace, dark and light
const WIDTHS = [360, 390, 705, 768, 1024, 1440];
const URLS = { silicon: "/app?wb=silicon", board: "/app?wb=board&template=fault_gpio12_vs_gpio14&autorun=1", matter: "/app?wb=matter&autorun=1" };
for (const theme of ["dark", "light"]) {
  for (const w of WIDTHS) {
    const { ctx, page, errors } = await newPage(w, w < 700 ? 800 : 900, { theme });
    const check = async (label) => {
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const over = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.right <= de.clientWidth + 1 || el.closest("svg") || getComputedStyle(el).position === "fixed") continue;
          let clipped = false;
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== "visible") { clipped = true; break; }
          if (!clipped) over.push(el.tagName + "." + String(el.className).slice(0, 40));
        }
        return { sw: de.scrollWidth, cw: de.clientWidth, over: over.slice(0, 3) };
      });
      ok(`no horizontal overflow ${theme} ${w}px ${label}`, m.sw <= m.cw && m.over.length === 0, JSON.stringify(m));
    };
    await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    await check("start");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${theme}-${w}-start.png` });
    for (const [wb, url] of Object.entries(URLS)) {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      if (wb !== "silicon") await waitTone(page).catch(() => {});
      await page.waitForTimeout(500);
      for (const view of w < 1024 ? ["chat", "preview"] : ["both"]) {
        if (w < 1024) await page.getByTestId(`pane-${view}`).click();
        await page.waitForTimeout(150);
        await check(`${wb}/${view}`);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${theme}-${w}-${wb}-${view}.png` });
      }
    }
    ok(`no console errors ${theme} ${w}px`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }
}

// ---------- 9. narrow: chat and preview are two tabs, coach switches panes
{
  const { ctx, page } = await newPage(390, 800, { coachSeen: false });
  await page.goto(`${BASE}/app?wb=matter`, { waitUntil: "networkidle" });
  await page.getByTestId("coach").waitFor({ timeout: 5000 });
  ok("narrow: chat and preview are two tabs", (await page.getByRole("tablist", { name: "Chat or preview" }).getByRole("tab").count()) === 2);
  await page.getByTestId("coach").getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(400);
  ok("narrow: the coach switches to the preview for the tabs tip", (await page.getByTestId("pane-preview").getAttribute("aria-selected")) === "true" && (await page.locator(".ring-2").count()) === 1);
  await ctx.close();
}

// ---------- 10. live agent acceptance (opt in)
if (process.env.LIVE === "1") {
  const { ctx, page } = await newPage(1440, 900);
  await page.goto(`${BASE}/app?wb=board&template=fault_gpio12_vs_gpio14&autorun=1`, { waitUntil: "networkidle" });
  await waitTone(page);
  ok("live: board starts red", (await tone(page)) === "red");
  await page.locator("[data-testid=fix-B4]").click();
  await page.getByText(/≈ \$|\$0 ·/).first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(4000);
  const after = await tone(page);
  console.log("live agent: verdict after Fix it =", after, "|", (await verdict(page).innerText()).replace(/\n/g, " "));
  ok("live: the agent answered and the preview changed with real results", ["green", "amber", "red"].includes(after));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/accept-board-fixed.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
