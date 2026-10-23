// One live agent turn that performs an action in the app. Spends real (demo) credits: run on purpose, against a dev server that has NEBIUS_API_KEY.
//   BASE=http://localhost:3109 PW=E:/Winter/tools/pw/package.json PLAYWRIGHT_BROWSERS_PATH=... node qa/app-live-agent.mjs [shot.png]
import { createRequire } from "node:module";
const BASE = process.env.BASE ?? "http://localhost:3000";
const require = createRequire(`file:///${process.env.PW ?? "E:/Winter/tools/pw/package.json"}`);
const { chromium } = require("playwright");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem("hw-app-tour-seen-v1", "1"); } catch {} });
await page.goto(`${BASE}/app?wb=board`, { waitUntil: "networkidle" });
const pill = () => page.getByTestId("credits-pill").innerText();
const before = await pill();
console.log("credits before:", before.replace(/\s+/g, " "));
await page.getByLabel(/Ask the agent|message/i).first().fill("Load the GPIO12 fault template and check it.").catch(async () => { await page.locator("textarea").last().fill("Load the GPIO12 fault template and check it."); });
await page.getByRole("button", { name: "Send" }).click();
const t0 = Date.now();
await page.getByText(/≈ \$|\$0 ·/).first().waitFor({ timeout: 120000 });
console.log("turn finished in", Math.round((Date.now() - t0) / 1000), "s");
await page.waitForTimeout(2500);
const state = await page.evaluate(() => ({
  board: document.querySelector("[data-testid=app-root]")?.getAttribute("data-wb"),
  tpl: document.querySelector("[data-testid=tpl-fault_gpio12_vs_gpio14]")?.getAttribute("aria-checked"),
  rungs: (document.body.innerText.match(/\d of 5 rungs pass/) ?? [])[0] ?? null,
  cost: (document.body.innerText.match(/≈ \$[\d.]+ · [\d,]+ in · [\d,]+ out · \w+/) ?? [])[0] ?? null,
}));
console.log(JSON.stringify(state));
console.log("credits after:", (await pill()).replace(/\s+/g, " "));
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await b.close();
const ok = state.board === "board" && state.tpl === "true" && !!state.rungs;
console.log(ok ? "PASS: the agent switched the workbench, loaded the template and the app shows the check" : "FAIL");
process.exit(ok ? 0 : 1);
