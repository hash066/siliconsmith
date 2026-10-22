// DEV ONLY. Copies the real Board/Matter test logs from lib/__fixtures__ into public/replays so the canvases can be
// looked at before those runs land in the product, and removes them again. They must never be committed:
//   node scripts/ws-fixtures.mjs on   (then npm run build && npx next start)
//   node scripts/ws-fixtures.mjs off
// `public/replays/_dev-fixtures.json` lists what was added so `off` removes exactly that.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const rep = join(root, "public", "replays");
const fx = join(root, "lib", "__fixtures__");
const marker = join(rep, "_dev-fixtures.json");

if (process.argv[2] === "off") {
  if (existsSync(marker)) {
    // Only names this script itself adds are removable: a replay file, a run directory, or the dev templates manifest.
    for (const f of JSON.parse(readFileSync(marker, "utf8"))) {
      if (f !== "../templates.json" && (f.includes("..") || f.includes("/") || f.includes("\\") || f === "")) continue;
      rmSync(join(rep, f), { recursive: f !== "../templates.json", force: true });
    }
    rmSync(marker);
  }
  console.log("fixtures removed");
} else {
  const added = [];
  const put = (rel, from) => {
    mkdirSync(dirname(join(rep, rel)), { recursive: true });
    if (!from.content) copyFileSync(join(fx, from), join(rep, rel));
    else writeFileSync(join(rep, rel), from.content);
    added.push(rel === "../templates.json" ? rel : rel.split("/")[0]);
  };
  for (const f of ["board-propose-template-6", "board-repair-pin_mismatch-1", "board-repair-pin_mismatch-2", "m_eval_1", "m_eval_2", "m_eval_3"]) put(`${f}.ndjson`, `${f}.ndjson`);
  put("m_eval_1/nodes/n7/plate.stl", "m_eval_1.plate.stl");
  // The clean reference design from the Board branch stands in for design.json of the repaired node (test shape only).
  const design = execFileSync("git", ["show", "ws-board:engine/siliconsmith/board/designs/battery_env_sensor.json"], { cwd: root, encoding: "utf8" });
  put("board-repair-pin_mismatch-1/nodes/n1.1/design.json", { content: design });
  // A dev-only templates manifest: one valid entry and one pointing at a run that is not recorded (to see both states).
  put("../templates.json", { content: JSON.stringify({ version: 1, templates: [{ id: "dev-valid", title: "DEV FIXTURE: int8 dot product", domain: "silicon", summary: "Test manifest, not product data.", run_id: "r_w1_contree3" }, { id: "dev-broken", title: "DEV FIXTURE: missing run", run_id: "r_not_recorded" }] }) });
  writeFileSync(marker, JSON.stringify([...new Set(added)]));
  console.log("fixtures added:", [...new Set(added)].join(", "));
}
