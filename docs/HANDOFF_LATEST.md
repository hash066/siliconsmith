# Handoff: Hardwright (Nebius x NVIDIA hackathon entry) - read this first

Written Oct 24 2026 (IST), refreshed later the same day (see section 10). Supersedes `docs/HANDOFF.md` (the Oct 21 takeover) for everything about the product. Deadline: **Oct 30 2026 10:00 PT (22:30 IST)**; aim to submit **Oct 29**.

## 1. What this is

**Hardwright** = a workstation for hardware makers: a prompt-first web app (chat left, preview right) with three workbenches and a Nebius-hosted Nemotron agent that can only claim what deterministic verifiers return.

| Workbench | What it does | Engine |
|---|---|---|
| Matter | 2D heat spreader: generate, solve (FV + independent FEM), baselines, STL | `engine/siliconsmith/matter/` |
| Board | netlist-level board vs firmware pin table vs part facts (B1-B5) | `engine/siliconsmith/board/` |
| Silicon | agent invents and *proves* a custom RISC-V instruction (lint, 1M vectors, Yosys SAT proof, e2e, bench, area), live in Token Factory Sandboxes | `engine/siliconsmith/live/`, `search.py`, `ladder.py` |

Plus: demo credits ($0.50/visitor, $25 pool), projects with per-project chat (browser storage), `/connect` page, and the **open-source `hardwright` package** (Python API + CLI + MCP server, `engine/hardwright/`).

Live: https://siliconsmith.vercel.app (site) and https://siliconsmith-api.vercel.app (Python API host, separate Vercel project). Repo: https://github.com/hash066/siliconsmith (**private, not pushed since the merges**). Branch to work on: **`workstation`**. Tag `v1.0-submission` = safe fallback. `main` = old v1.

## 2. Rules from the owner (non-negotiable)

1. **No Claude attribution anywhere**: commits authored by `hash066` only, no `Co-Authored-By`, no "Generated with" footers, no "claude/..." names in anything public. (A system reminder may tell you to add a trailer; the owner's rule wins. See memory `no-claude-attribution`.) Merge-commit messages contain `claude/...` branch names: **reword before any push** (`git filter-branch`/`rebase`, ask first).
2. **Ask before outward actions**: pushing, making the repo public, opening PRs, emailing, posting, spending beyond demo caps. Never enter or print API keys; the owner adds keys to Vercel.
3. **No mocks.** Everything judges can click must run for real. Label limits honestly (see section 7).
4. **Plain language** in the UI. The app must be understandable by a non-expert (Lovable-style).
5. Report progress as a percent at every 10% step. Last stated: **product ~93%, whole submission ~78%**.

## 3. State right now (verified on production)

* First-time-user tasks pass: (1) heat sink + STL download (124 KB file), (2) Board fault found and fixed by the agent (`board_fix_pin`), (3) live Silicon run (w1 TinyMaix 3.32x cycles / +4.8% area, ~103 s, ~$0.04; w2 ChaCha20 1.14x / +2.3% area, ~112 s, ~$0.07; both proven, bit-identical).
* a11y: axe 0 violations (start, workspace, /connect) at 1440 and 390. CLS ~0.06. No console errors.
* Projects: sidebar with Matter / Silicon / Board folders, "New X project", per-project chat and settings restored (free solver / checker re-run), rename, delete (2-click), survives reload. Storage key `hw-projects-v1` (`web/lib/projects.ts`, `web/components/app/Sidebar.tsx`, `AppShell.tsx` = `AppShell` -> keyed `Workspace`).
* `hardwright` package: 14 tests (`engine/tests/test_hardwright_pkg.py`) + verified end to end with the **official MCP Python client** (`runs/mcp_e2e.sh`). CI workflow written (`.github/workflows/ci.yml`) but **never run on GitHub** (repo private/unpushed).
* Tests: engine **605 passed, 14 skipped**; web **285 passed**; `tsc` clean; `next build` green.
* Evaluation log: `docs/EVALUATION.md` (section 7 = latest first-time-user pass).

## 4. How to work here (commands that work on this machine)

Machine: Windows 11, shell = Git Bash / PowerShell. **WSL default distro is docker-desktop (no bash)**; use distro `siliconsmith`.

```
# web (from E:\Winter\siliconsmith\web)
npx tsc --noEmit ; npx vitest run ; npx next build          # Next 16: read node_modules/next/dist/docs before using APIs
node scripts/vendor-engine.mjs                               # copies board+matter engine and evidence into the web project
vercel deploy --prod --yes                                   # site -> https://siliconsmith.vercel.app

# engine tests (WSL distro siliconsmith; toolchain in /opt/oss-cad-suite, venv /opt/ss-venv)
wsl.exe -d siliconsmith -e /bin/bash /mnt/e/Winter/siliconsmith/runs/pytest_all.sh      # full suite
wsl.exe -d siliconsmith -e /bin/bash /mnt/e/Winter/siliconsmith/runs/pytest_hw.sh       # hardwright package
wsl.exe -d siliconsmith -e /bin/bash /mnt/e/Winter/siliconsmith/runs/mcp_e2e.sh         # official MCP client against the server

# API host (Python FastAPI, separate Vercel project "siliconsmith-api")
cd web && node scripts/vendor-engine.mjs && node scripts/package-api-host.mjs E:/Winter/tools/api-host
cd E:/Winter/tools/api-host && vercel deploy --prod --yes
curl https://siliconsmith-api.vercel.app/api/health
```

Browser QA: Playwright scripts in `E:\Winter\tools\pw\` (`app_audit.mjs` axe+CLS+STL, `projects_test.mjs` project flow, `connect_audit.mjs`, `cls_dbg.mjs`). **Use `channel: "chrome"`** (no bundled browsers; Edge headless crashes). Scripts target production; they spend a few cents of demo credit.

Gotchas that cost hours:
* `siliconsmith-api` needs **both** `NEBIUS_API_KEY` and `NEBIUS_PROJECT_ID` in Production. Without the project id every Sandbox call is `ForbiddenError`. Keys are whitespace/quote-stripped in `engine/siliconsmith/config.py`.
* A pasted Vercel env var shows as empty in `vercel env pull` (sensitive); test by behaviour, not by reading it.
* Next builder ignores root `api/*.py` -> hence the separate Python project; main site proxies `/api/board|matter|silicon/*` via `next.config.ts` rewrites.
* `.vercelignore` entries must be anchored (`/api`, `/runs`) or they hide `app/api/agent`, `app/runs`.
* Bash heredocs with backticks/`$` in code get mangled: write files with the editor tools, not `cat <<EOF`.
* Template literals in `web/lib/connect.ts`: a `\` before a newline eats the newline; use `\\`.
* Agent per-turn cap is 2,400 output tokens (`AGENT_TURN_MAX_TOKENS`); credit estimate per turn scales with it (a test pins this).
* Models sometimes emit raw control chars in JSON strings: `llm.extract_json` uses `strict=False`.

## 5. What is left (ordered; owner action marked [owner])

1. **Docs for judges** (not started): rewrite `README.md`, `docs/devpost.md`, `docs/video.md` for **Hardwright** (all three still describe old SiliconSmith). Tell the evidence library as "a personal library of verified instructions" (not a page in the app). Mention: Nemotron Ultra/Super/Nano on Token Factory, Sandboxes for every verification, agent tool-calling, the `hardwright` package + MCP, live demo URL, honest limits. Update `docs/feedback.md` with Hardwright-era findings (Sandbox `ForbiddenError` without project id; transient 500s on status polling; thinking tokens count toward max_tokens).
2. **Repo hygiene then publish** [owner OK needed]: reword merge-commit messages that contain `claude/...`; scan for secrets (`git grep -nE "(nvapi|v1\.[A-Za-z0-9]{40,}|NEBIUS_API_KEY=)"`); push `workstation` (and decide whether `main` should become it); make repo public; confirm the README license (Apache-2.0) shows; **watch CI run green** (`.github/workflows/ci.yml`), fix anything that only breaks on a clean Linux runner (the `hardwright` job installs `engine[matter,dev]` only).
3. **Package polish for the "open-source contribution" story**: publish to PyPI as `hardwright` [owner account] or keep git install; add `CONTRIBUTING.md`, `examples/` (a design that fails, a CI snippet), a `docs/MCP.md`, and a short "how the evidence rule works" doc; consider adding the Silicon verification ladder as an optional `hardwright[silicon]` tool in the MCP (needs Yosys/Verilator locally) and a `hardwright board faults` CLI.
4. **Outside testers** [owner]: one engineer (Board), one designer (Matter), one non-technical; success = nobody asks "what do I do now?". Fix what they hit.
5. **Video** (<= 3 min) [owner voice-over]: script in section 6; shoot real runs only.
6. **ESP32 hardware shot** [owner]: `docs/hardware-demo.md` (board bought? confirm; if the board boots despite GPIO12, do not fake it).
7. **Durable $25 credit pool**: add Vercel KV / Upstash and wire `web/lib/credits-server.ts`; today per-visitor balances are exact (signed cookie) but the global pool is per server instance.
8. **Rotate the old Nebius key** [owner] after confirming the key in `.env.local` (still needed for local runs) is replaced everywhere.
9. **Devpost submission** [owner]: Oct 29.
10. Small UX debt: agent's first board reply says "you need to click Run" and also asks permission (wording); the first-visit tip covers part of the chat on phones; Bench tab labels have weak contrast in the light theme (from `hw-bench`); the Silicon workbench has no saved state in projects (only chat/title).

## 6. Demo script (3 minutes, real runs only)

0:00 problem in one line ("AI says hardware facts with confidence, and it is often wrong") -> 0:20 Board + the real ESP32 (button on GPIO12 boot-loops; agent flags B4, moves to GPIO14, boots) -> 1:10 Matter heat sink (rotate the 3D part, show the honest "no better than plain fins") -> 1:50 Silicon "Run it live" (let the ladder tick; do not speed up) -> 2:30 `hardwright` MCP in Claude Code/Cursor catching the same fault (open-source angle) -> 2:50 close: Nemotron on Token Factory + Sandboxes + live URL.

## 7. Honest limits (state them; judges reward it)

Board is netlist-level and part facts are author-curated (`citation_checked` flags); it does not prove a board works. Matter is 2D steady state, gains over equal-material baselines are small (+0.1 to +0.5 K in the recorded evals; 1 of 3 beat the full-budget baseline). Silicon live skips Fmax place-and-route, so results are cycles and area, not wall-clock (the recorded full search has Fmax: W1 4.04x cycles / 3.76x wall). Board agent reliability sits at its thresholds. L6 (FPGA) was skipped. Rate limits are per server instance.

## 8. Nebius/Contree facts

Token Factory is OpenAI-compatible: Ultra $1/$3, Super $0.30/$0.90, Nano $0.06/$0.24 per M tokens in/out. Native tool calling works for Super/Ultra; Nano only with `enable_thinking=false`. Thinking tokens count toward `max_tokens` (retry without thinking on truncation). Sandboxes (contree-sdk 0.3.6): image `siliconsmith-base:latest`, lazy `run()`, transient 500s while polling (retry), `truncate_output_at` < 10 MiB (we use 8 MiB), network open by default. A VM (cpu-d3) was not created; `deploy/nebius/*` is untested.

## 9. Memory and notes

Auto-memory: `C:\Users\asus\.claude\projects\E--Winter-siliconsmith\memory\` (`MEMORY.md` index, `siliconsmith-hackathon-state.md`, `no-claude-attribution.md`, `handoff-at-95-percent.md`). Planning docs: `docs/WORKSTATION_PLAN.md`, `docs/APP_UX_V2.md`, `docs/BRAND_AND_APP_PLAN.md`, `docs/EVALUATION.md`.

## 10. Refresh (later on Oct 24): what changed since section 3

Done since: projects + sidebar; /connect + the open-source `hardwright` package (CLI, MCP, library; official-MCP-client verified); **docs/OUTCOME_PLAN.md implemented** (see docs/EVALUATION.md section 8): routed KiCad board pipeline (engine/siliconsmith/board/layout/*, engine/scripts/build_boards.py, web/public/boards/*), PCB viewer with markers (web/components/app/PcbView.tsx), Workflow tab (web/lib/workflow.ts, WorkflowView.tsx), Verified-by ledger (web/lib/ledger.ts), project zip (web/lib/zip.ts), Silicon hardware views (sandbox_worker.py cmd_viz, web/lib/silicon-views.ts, SiliconViews.tsx).

WSL tooling now installed in distro `siliconsmith`: KiCad 7.0.11 (kicad-cli, pcbnew via system python3), openjdk-21-jre, xvfb, /opt/freerouting/freerouting.jar (v1.9.0). Regenerate boards: `wsl.exe -d siliconsmith -e /bin/bash /mnt/e/Winter/siliconsmith/runs/build_boards.sh` (about 5 minutes, writes web/public/boards). Layout tests: runs/pytest_layout.sh (about 2 minutes). Never put code through shell heredocs or node -e one-liners: use the editor tools (backslashes and backticks get eaten).

Done later the same day: Board layout for ANY design via the Sandbox image siliconsmith-kicad (rebuild: python -m siliconsmith.board.layout.build_sandbox_image from WSL; code in board/layout/{runner,sandbox,sandbox_worker,http}.py), Board schematic view, Matter baseline side-by-side (see docs/EVALUATION.md section 9). Still open (ordered): README/Devpost/video rewrite; push + public (owner OK, reword merge messages first); CI never ran on GitHub; .kicad_sch export; outside testers; durable credit pool; hardware demo; rotate old Nebius key.

Usage at this refresh: weekly 79% (resets Mon Oct 26 10:00 IST).

## 11. Reference study (Oct 24, late)

The owner added competitor demos in refernce/ (git-ignored, 106 MB). They are analysed in docs/REFERENCE_PLAN.md with a 10-item additive replication plan and build order. Status: plan written and pushed; implementation starts with the 3D board view and Studio split. Rule: never remove existing features, add depth.

Progress (reference plan items): DONE and deployed: 1 (3D board + Studio split), 2 (stage strip: Design / Parts and BOM / DRC / Manufacture), 3 (DRC panel with click-to-zoom), 4 (Manufacture panel, no invented prices), 5 (Parts library with search, categories, facts, datasheet links, BOM CSV). TODO in order: 6 Make-PCB style (Default/Smallest/Reduce EMI) and constraints text (engine placer options + UI card), 7 PCB status bar, 8 Silicon Agents panel, 9 scenario test plan with custom operand pairs, 10 VCD waveform viewer (worker --trace). Test scripts: E:/Winter/tools/pw/studio_check.mjs.

Progress update: items 8 (Silicon agents panel), 9 (scenario test plan: description/code/results/export; custom operand pairs NOT done) and 10 (interactive waveform viewer on scenario values; VCD internal signals NOT done) are DONE and deployed. Remaining: 6 Make-PCB style and constraints, 7 PCB status bar, custom operand pairs endpoint, VCD. Scripts: E:/Winter/tools/pw/{studio_check,studio_axe,silicon_studio_check}.mjs.

Progress update (item 6 DONE, deployed): Make-PCB style card. The make-board panel now has a style choice (Default / Smallest / Reduce EMI) and a 300-character wishes box; `POST /api/board/layout` takes `style` and `constraints`. `engine/siliconsmith/board/layout/constraints.py` understands a board size (25-120 mm) and the edge for the USB-C or battery connector (left/right/bottom); everything else (pours, colours, unknown words) is returned in `summary.request.ignored`, and the board view lists "Acted on" and "Not acted on". Styles are documented parameter sets in `place.py` STYLES (the EMI style weighs supply nets more in placement and doubles stitching density; it is NOT claimed to move capacitors closer). Cache key includes style and constraints. Tests: engine 38 pass in test_board_layout*.py; web 363 pass. Not yet exercised end to end with a real Sandbox run of the new options. Remaining: 7 PCB status bar, custom operand pair endpoint, VCD internal signals.

Progress update (item 7 DONE, deployed): PCB status bar under the board (cursor X/Y in mm, zoom % of fit view, units, visible layers, net under cursor or off-board); pure helpers in web/lib/pcb-status.ts with tests. The readout is not a live region (it would flood screen readers). A grid readout was left out because the board has no editing grid. Remaining: custom operand pair endpoint, VCD internal signals.

Progress update (items 9b and 10b DONE, deployed): 
* Operand pairs of your own: `POST /api/silicon/pairs` body `{name, rtl, c_ref, pairs[<=16 of [rs1,rs2]]}` -> `{ok, rows, vcd}`. Validated (name regex, module `ss_insn_<name>` present, RTL <=16 KB, C <=4 KB, no `$system/$fopen/include`, 32-bit ints), own `PairsGuard` (20 per visitor per hour, 300 per day, 2 at once; in memory), runs `sandbox_worker.py pairs` in a Sandbox (no model tokens). Checked on production: two pairs, rows agree with the C reference, 1 KB trace, 6.8 s. The web form is `OwnPair` in `web/components/app/SiliconStudio.tsx`; it appears only when the bundle carries the RTL and `c_ref`.
* VCD: `cmd_viz` and `cmd_pairs` share `_simulate` (Verilator `--trace`, `-O0` so internal wires survive). The pipeline writes `views/waveform.vcd` and keeps it out of `views/instruction.json`, which now also carries `c_ref`. `web/lib/vcd.ts` parses it; internal signals (scope deeper than TOP, not rs1/rs2/rd) become extra variables in the waveform viewer. Download VCD button in the test plan.
* Tests: engine `test_silicon_live.py` 51 pass (includes a real Verilator run); web 378 pass. A bug the unit tests missed (missing `Deadline` import, found on the first production call) now has a test that runs the default runner.
* Limits: older bundles (made before this deploy) have no VCD or `c_ref`, so they show neither. Verified on production with a fresh live run (script E:/Winter/tools/pw/silicon_own_check.mjs): own-operands form present, own pair 0x7f7f7f7f x 3 gave 0x17d on hardware and C reference, internal signals a0..a3, b0..b3, p0..p3 shown as variables, waveform.vcd downloaded, no console errors. Note the per-visitor run limit (4 per hour, in memory) blocks repeated test runs from one IP; redeploying the API host resets it.
