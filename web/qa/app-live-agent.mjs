// Live agent turns through the v2 flow. SPENDS real (demo) credits: run on purpose against a server that has NEBIUS_API_KEY.
//   BASE=http://localhost:3108 PW=E:/Winter/tools/pw/package.json PLAYWRIGHT_BROWSERS_PATH=... node qa/app-live-agent.mjs [shots-dir]
// 1) start screen -> the first prompt lands in the chat and the agent answers and acts; 2) board fault -> "Fix it" asks the agent to repair.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const require = createRequire(`file:///${process.env.PW ?? "E:/Winter/tools/pw/package.json"}`);
const { chromium } = require("playwright");
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch();
let bad = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${n}${!c && x ? " :: " + x : ""}`); if (!c) bad++; };
const mk = async () => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem("hw-app-coach-v2", "1"); } catch {} });
  return { ctx, page };
};
const credits = (page) => page.getByTestId("credits-pill").innerText().then((t) => t.replace(/\s+/g, " "));
const costLine = (page) => page.getByText(/≈ \$[\d.]+ · [\d,]+ in · [\d,]+ out · \w+|\$0 · [\d,]+ in/).first();

{
  const { ctx, page } = await mk();
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  const before = await credits(page);
  console.log("credits before:", before);
  await page.getByTestId("example-board").click();
  await page.getByTestId("workspace").waitFor();
  await page.getByText(/BME280/).first().waitFor({ timeout: 20000 });
  ok("the start-screen prompt landed in the chat as the first message", true);
  const t0 = Date.now();
  await costLine(page).waitFor({ timeout: 180000 });
  console.log("first turn finished in", Math.round((Date.now() - t0) / 1000), "s");
  await page.waitForTimeout(2500);
  console.log("cost line:", await costLine(page).innerText());
  console.log("credits after:", await credits(page));
  ok("the preview shows a real verdict", ["green", "amber", "red"].includes(await page.getByTestId("verdict").getAttribute("data-tone")));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-start-board.png` });
  await ctx.close();
}
{
  const { ctx, page } = await mk();
  await page.goto(`${BASE}/app?wb=board&template=fault_gpio12_vs_gpio14&autorun=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("[data-testid=verdict]")?.getAttribute("data-tone") === "red", null, { timeout: 30000 });
  ok("fault template is red before the fix", true);
  const before = await credits(page);
  await page.getByTestId("fix-B4").click();
  await costLine(page).waitFor({ timeout: 180000 });
  await page.waitForTimeout(4000);
  const tone = await page.getByTestId("verdict").getAttribute("data-tone");
  console.log("verdict after Fix it:", tone, "|", (await page.getByTestId("verdict").innerText()).replace(/\n/g, " "));
  console.log("cost line:", await costLine(page).innerText());
  console.log("credits:", before, "->", await credits(page));
  ok("the agent repaired it: the preview is no longer red", tone !== "red");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-fix-it.png` });
  await ctx.close();
}
await b.close();
process.exit(bad ? 1 : 0);
