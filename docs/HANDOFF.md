# SiliconSmith: handoff for the next agent

Written Oct 21 2026 by the main build session, merging context from the main session and the web-app
side session (`local_5d23965b`, "SiliconSmith web app (run viewer) against event contract").
All work was stopped on the user's request before this was written: no processes are running and
nothing is mid-edit.

**Read this whole file first, then `docs/PLAN.md` (the master plan) and `docs/contracts/events.md`
(the engine↔web contract).** Where this file and PLAN.md disagree, this file is newer.

---

## 0. TL;DR

* **What:** SiliconSmith is an agent that profiles C hot loops, **invents a custom RISC-V instruction**,
  writes the Verilog plus the software that uses it, **proves it correct**, measures speedup and area,
  and outputs a mergeable bundle or PR. Nemotron (via Nebius Token Factory) is the brain. Every
  candidate CPU is verified in its own Token Factory Sandbox branch.
* **Why:** Nebius x NVIDIA Global AI Hackathon, Coding & Agentic Engineering track. Target: **Grand
  Prize ($20k)**. **Hard deadline Fri Oct 30 2026, 10:00 PT = 22:30 IST. Submit by Oct 30, 12:00 IST.**
* **State:**
  * The engine works end-to-end locally, and the agent autonomously finds `dot4`: **3.32× at +4.8%
    area** on TinyMaix, formally proven, bit-identical output.
  * The hand-built reference gets **3.77× at +3.2%**. The new "polish" phase was built to close
    that gap, but it is **not yet validated in a live LLM run**.
  * The web console is about 60% done on an uncommitted branch.
  * The Sandboxes backend is coded and tested locally, but **Nebius hasn't activated Sandboxes on the
    project** (blocker, needs a human email).
* **Next, in order:**
  1. Human blockers (§7).
  2. Polish run.
  3. Fmax wiring.
  4. W2 run.
  5. Merge and finish the web app.
  6. Engine API + hosting.
  7. GitHub bot PR.
  8. Sandboxes run.
  9. FPGA.
  10. README, video, submit (§8).

---

## 1. Hackathon facts (verified Oct 20 from Devpost)

* Site: https://nebiusglobalaihackathon.devpost.com/ (rules at `/rules`). Judging Dec 1–15; winners ~Jan 11 2027.
* **Must** run on Nebius Token Factory or Nebius AI Cloud and use ≥1 NVIDIA open model (Nemotron).
  Calling Nemotron through a third party (OpenRouter, Hugging Face) does **not** count.
* Coding track wording: *"agents that write, run, and test code in Token Factory."* Token Factory
  **Sandboxes** is the featured tool.
* Stage 1 is pass/fail on track fit. Stage 2 has **four equally weighted criteria; ties break in this order**:
  1. **Technological Implementation**: how well it's built and how effectively it uses Token Factory/AI Cloud + Nemotron.
  2. **Design**: "a complete, coherent product experience, not just a technical proof of concept".
  3. **Potential Impact**: a credible, specific case for a real audience, *"based on what's demonstrated"*.
  4. **Quality of the Idea**: a creative, non-obvious use of Token Factory + Nemotron, and genuine understanding of the problem.
* Prizes: Grand $20k (one winner across all 4 tracks), 2nd $10k, 3rd $6k. The Coding track winner gets a
  Jetson Orin Nano. **Most Valuable Feedback: 10 × $100**, so write `docs/feedback.md` carefully.
* Deliverables:
  * public YouTube video ≤ 3:00;
  * public repo with an OSS license visible at the top;
  * README with setup instructions;
  * a working demo URL or test build;
  * a description of how Nemotron and Token Factory were used;
  * feedback on Nebius/NVIDIA tools.
* Judges (23) are mostly Nebius DevRel/PM, NVIDIA software engineers (several "System Software"
  titles) and Tavily engineers: **generalists, not chip architects.** The first 20 seconds of the video matter most.

## 2. The product (settled with the user; don't re-litigate)

* **The core product is the CLI** (`siliconsmith accelerate …`). It writes a **bundle**: `rtl/*.v`,
  `include/ss_intrinsics.h`, `src/` (patched kernel), `REPORT.md` and `run.ndjson`.
* **GitHub bot:** commenting `/siliconsmith accelerate <fn>` opens a PR with the bundle. In the demo
  it opens a PR on a fork of TinyMaix.
* **Web run console:** every run has a URL `/runs/<id>` with a live/replay tree, inspector, proofs,
  waveforms, diffs and Nemotron cost. It's the review page, like a GitHub Actions run page, and it's
  what judges see.
* **MCP server** (stretch): wraps the CLI so Claude Code, Cursor or Codex can call SiliconSmith.
* One-line pitch: **"Dependabot for your CPU: it opens a PR that changes your hardware."** Tagline:
  *"Coding agents change code to fit the chip. SiliconSmith changes the chip to fit the code."*
* **Hard rule:** the product's agent is **Nemotron only** (Nano/Super/Ultra on Token Factory). Claude
  Code builds SiliconSmith; it must never be inside it.

## 3. Current state

### 3.1 Results so far (real numbers; use these, don't invent)

| What | Result |
|---|---|
| W1 baseline (TinyMaix `tm_dot_prod`, 64×512 int8 FC on PicoRV32 rv32im + fast mul) | 860,730 cycles; output hash `c729ebe8` |
| Hand-built golden `dot4.s8` (`siliconsmith golden`) | 228,382 cycles, **3.77×**, **+3.16% LUT-equiv**, +4 DSP, all rungs pass |
| Agent run `r_m4_first` | 3 candidates, all pruned (prove error, lint fail, 0.85×); $0.098 |
| **Agent run `r_m4_second`** (complete; current best hero replay) | 14 nodes, 13.3 min, **$0.327**, 321k tokens. Best **n1 `dot4` 3.32× +4.83%**. Pareto: n1, n5 `dot2.lo` 2.16× +1.21%, n5.2 `dot2.hi` stacked 2.59× +4.13%. Pruned with reasons: formal counterexample (n3), patched-software mismatches (n2, n4, n5.4), compile error (n6), over budget (n5.1), no gain (all n1.x) |
| Agent run `r_m5_polish` | **Killed mid-round-1 by the user's stop.** Partial log only (209 lines). Re-run it. |
| W2 baseline (Monocypher ChaCha20, 16 blocks = 1 KiB) | 133,255 cycles; hash `4c7a06b8`; **`rotl32` = 48.6%** of cycles, `chacha20_rounds` 36% |
| Baseline Fmax (Tang Nano 9K P&R, nextpnr-himbaechel) | seed1 62.40 / seed2 73.15 / seed3 71.03 MHz; **±8% seed noise**; 77–106 s per P&R; 36% LUT4, 92% BSRAM |

Why the agent lags the golden (diagnosed):
* Its RTL sums four products in a 32-bit adder chain; the golden uses minimal 17/18/19-bit adders.
* Its loop unrolls 2× with byte-offset addressing; the golden unrolls 4× with word pointers.

The **polish phase** (§5.4) targets exactly these. Also, round-2 proposals after `dot4` all gave 0
gain. PicoRV32's PCPI port has only 2 source registers, so there's no accumulate (T-Head's `smaqa`
reads 3). Treat that as an architectural ceiling and say so in the README.

### 3.2 Repo and branches

* Main checkout: `E:\Winter\siliconsmith` (branch `main`, HEAD `2289deb`, **local only, never pushed**).
* One uncommitted file there: `scripts/fmax_baseline.py` (the Fmax timing script; commit it).
* Web worktree: `E:\Winter\siliconsmith-web`, branch `feat/web-app`, which **points at old main
  `70bd3d6`, has no commits, and has `web/` untracked**. See §6.
* **Secret incident:** an earlier `.env.example` contained a real `NEBIUS_API_KEY`. Main was
  rewritten; no reachable commit contains it (verified with `git log -p --all`). However:
  * The old commits **`4ea7c36` and `f19e578` still exist locally as unreachable objects.** Before the
    first push, run `git reflog expire --expire=now --all && git gc --prune=now`, then gitleaks.
  * Recommend the user **rotates that key anyway**. It was never pushed, but it was written to disk in git objects.
  * `.git/hooks/pre-commit` blocks commits that contain key-like strings. Never commit any `.env*`
    except a blank `.env.example`.
* Commit attribution: end every commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The local commits use
  `-c user.name="siliconsmith" -c user.email="therayyn16@gmail.com"`.

### 3.3 Code map (engine = `engine/siliconsmith/`)

| File | Role |
|---|---|
| `cli.py` | `siliconsmith` / `ss` entry point: `hello`, `bench <w> [--profile --disasm]`, `golden`, `run`, **`accelerate`** (search + bundle; flags `--k --k-child --beam --depth --area-budget --concurrency --vectors --backend {local,subprocess,contree} --no-polish --run-id --out`) |
| `search.py` | Beam search. Each round: Ultra proposes; children develop concurrently; repair loop; then **polish chain** (area, then software) on the top-B; best/Pareto; events |
| `ladder.py` | Verification ladder. `evaluate()` (new instruction or area polish: `require_gain`, `shrink_vs`), `evaluate_software()` (software polish), `measure()`, `host_check()` (differential test vs original), `check_patch_hygiene()` |
| `backends.py` | `EvalJob` (with `mode` = instruction/area/software, JSON round-trip), `evaluate_job()` (single dispatch), `LocalBackend`, `SubprocessBackend` (exact sandbox protocol, live stage streaming), `ContreeBackend` (Token Factory Sandboxes: run from the parent's image, non-disposable, child image = checkpoint) |
| `worker.py` | Sandbox-side entry: `python -m siliconsmith.worker baseline <w>` / `eval <job.json>`. Prints `SS_STAGE {…}` / `SS_OUTCOME {…}` lines |
| `bundle.py` | Writes the deliverable bundle + `REPORT.md` (honest labels, per-model cost, rejected candidates, provenance) |
| `llm.py`, `config.py` | Nemotron client (OpenAI-compatible Token Factory), budget, `llm.call` events, prices; settings from `.env.local` |
| `agent/prompts.py`, `agent/schemas.py` | Role prompts (architect, implement, spec, repair, triage, **polish area/sw**) and pydantic schemas |
| `hwgen.py` | Custom-instruction slot generator: `ss_pcpi.v` dispatcher, `ss_insn_<name>.v`, `ss_intrinsics.h` (custom-0 opcode `0x0B`, funct3 0, funct7 = id) |
| `tools/build.py`, `tools/verify.py`, `tools/profile.py`, `tools/workload.py`, `tools/fpga.py` | GCC/Verilator builds (content-hash cached); lint/unit/prove (Yosys SAT miter)/synth (`synth_gowin`); PC-histogram profiler + hot disassembly; workload loading; Tang Nano 9K P&R/Fmax/bitstream |
| `examples/dot4_s8/` | Hand-built golden solution (RTL, spec, C ref, patch): a regression test and few-shot example |
| `events.py` | EventBus: NDJSON to `runs/logs/<run>.ndjson` + `subscribe()` queues (for SSE) |

Other directories:
* `hw/` (PicoRV32 vendored, ISC; `ss_core.v`, `ss_soc.v` with UART/EXIT/REGION MMIO; `tb/tb.cpp`)
* `firmware/` (start.S, link.ld, runtime.h/.c)
* `workloads/w1_tinymaix_fc/`, `workloads/w2_monocypher_chacha20/`, each with `manifest.json`,
  `main.c`, the patchable file and `host_check.c`
* `fpga/` (Tang Nano 9K top, `.cst`, linker)
* `sandbox/Dockerfile`
* `scripts/` (setup, probes, `tail_run.py`, `hostcheck_orig.py`, `fmax_baseline.py`)
* `.claude/` (curated ECC agents and skills, §12)

Tests: `engine/tests/` has **16 passing** (`SS_SLOW=1` runs the toolchain tests, about 4 min). They
cover the worker protocol parity (subprocess == in-process), the polish modes (area shrinks and
re-proves; software speeds up with the proof shown as skipped), patch hygiene, and the bundle/report.

## 4. Environment: how to run things (and the gotchas we hit)

* Laptop: Windows 11, i7-12700H, 16 GB, RTX 3050.
  * **C: has only ~7 GB free. Never install or build anything big on C:.**
  * E: has ~180 GB free.
* **Toolchain lives in a dedicated WSL distro `siliconsmith` on `E:\WSL\siliconsmith`** (Ubuntu 24.04):
  * OSS CAD Suite in `/opt/oss-cad-suite` (Verilator 5.05, Yosys 0.70, SymbiYosys, nextpnr-himbaechel, openFPGALoader);
  * `gcc-riscv64-unknown-elf` (13.2, rv32im multilib);
  * Python 3.12 venv `/opt/ss-venv`, with the engine installed editable plus `contree-sdk==0.3.6`, fastapi, openai, pydantic, pytest.
* Run engine commands as root in a **login** shell. The PATH for OSS CAD comes from `/etc/profile.d/ocs.sh`:
  ```bash
  wsl -d siliconsmith -u root -- bash -lc 'cd /mnt/e/Winter/siliconsmith/engine && /opt/ss-venv/bin/siliconsmith hello'
  ```
* From **Git Bash**:
  * prefix with `MSYS_NO_PATHCONV=1`;
  * use **single quotes**, otherwise Git Bash expands `$PATH`;
  * don't override PATH (the login shell sets it).
* **PowerShell** mangles inline Python: write a script file and run it instead.
* Windows Python prints cp1252, so set `PYTHONIOENCODING=utf-8` when printing event details (they contain `·` and `‑`).
* `pkill -f pattern` inside `bash -c` kills its own shell. Use the bracket trick: `pkill -f "[s]iliconsmith accelerate"`.
* Scratch/caches default to `/var/tmp/ss-runs` (fast native WSL disk; `paths.RUNS`, override `SS_RUNS`).
  Run logs always go to repo `runs/logs/` (gitignored). Copy hero runs into `web/public/replays/`.
* Secrets and config live in `E:\Winter\siliconsmith\.env.local` (gitignored, already filled by the user):
  * Nebius key and project ID, base URL;
  * model IDs;
  * `SS_BACKEND`, `SS_MAX_CONCURRENCY`, `SS_RUN_BUDGET_USD` (per-run cap), `SS_DAILY_BUDGET_USD`.
  * Default model IDs in `config.py`: `nvidia/Nemotron-3-Ultra-550b-a55b`,
    `nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`.
* Typical commands (inside WSL, `engine/` dir):
  * `siliconsmith bench w2 --profile --disasm`
  * `siliconsmith golden`
  * `siliconsmith accelerate w1 --k 6 --k-child 4 --beam 2 --depth 2 --concurrency 4 --run-id r_x --out /mnt/e/Winter/siliconsmith/runs/bundles`
  * `python -m pytest -q tests` (`SS_SLOW=1` for the toolchain tests)
* Long runs (10–20 min) go in the background. Summarize them from `runs/logs/<id>.ndjson` (see the
  snippet pattern in `scripts/tail_run.py`).
* **Docker Desktop** is healthy again; a restart fixed a hang. **Its disk image is on C:**, so don't
  build images until the user moves it to E: (§7).
* GitHub CLI is logged in as **`hash066`** (scopes: repo, workflow, gist, read:org). **Don't create repos,
  fork, push or open PRs without the user's explicit OK.**

## 5. Architecture quick reference

### 5.1 Search
* A node is a CPU: parent ISA + one new instruction + rewritten software.
* Round 1:
  1. Ultra proposes `k_root`.
  2. Children develop concurrently, each with up to 2 repairs, plus an independent spec rewrite when
     a counterexample blames the spec.
  3. The top `beam` are kept and **polished**.
  4. Later rounds propose `k_child` per frontier node.
* Score = speedup in cycles (Fmax not wired yet, §8 task 3).
* Best = max (speedup, −area). The Pareto front is over (speedup, area).

### 5.2 Ladder (and the exact honest labels; never overclaim)
* Stage order: `implement → lint → unit → e2e → bench → prove → synth`.
* L1 lint = Verilator `-Wall`, plus patch hygiene (the patch may only *call* `ss_*`).
* L2 unit = RTL == C reference on edge cases + 1M random vectors, **plus the host differential test**
  (rewritten kernel == original on 5,000 random calls).
* L3 prove = Yosys SAT miter: RTL ≡ an **independently written** spec RTL for all 2^64 inputs. The
  spec is validated against C first, and counterexamples are attributed to RTL or spec.
* L4 e2e = full-SoC output hash == baseline.
* bench = must beat the parent by ≥1%.
* L5 synth = `synth_gowin` area within budget.
* L6 FPGA = not done.

### 5.3 Sandboxes (Contree)
* `ContreeSync()` reads `NEBIUS_API_KEY` and `NEBIUS_PROJECT_ID`.
* Running a command: `sdk.images.use(ref).run(shell=…, files={"/tmp/ss_job.json": bytes}, timeout=3600,
  disposable=False, truncate_output_at=16 MiB).wait()` returns `.stdout`, `.exit_code` and `.uuid`
  (the new checkpoint image).
* The root image must be `siliconsmith-base:latest`, built from `sandbox/Dockerfile`, which copies
  `hw/ firmware/ workloads/ engine/` to `/work`.
* Limits seen via `get_token_info()`: 50 concurrent instances, 3600 s max per run, 12 GB per layer.
  **All permissions are currently `False`.**
* Docs: https://docs.tokenfactory.nebius.com/sandboxes/overview (index at `/llms.txt`; build image:
  `/sandboxes/cli/tutorial/build.md`; import from registry: `/sandboxes/sdk/python_sdk/images.md`).
  The CLI is `contree` and is **not installed yet**.

### 5.4 Polish (contract v1.2; built and tested, not yet live-run)
After each round, for each winner there's a chain:
* **Area polish**, `kind:"area"`: same function, less hardware. It must not slow down, must shrink
  (LUT-equiv, DSP), and is **re-proven** against the same spec. `patch_diff` holds the RTL diff.
* Then **software polish**, `kind:"software"`: same hardware, faster code, must stay bit-identical.
  `prove` is emitted as **`skipped`** ("hardware unchanged: formal proofs carry over").

Each polish step gets up to 2 attempts, and its LLM calls use `role:"polish"`.

### 5.5 Event contract
* `docs/contracts/events.md`, currently **v1.2**. The web validator in `web/lib/contract.ts` only knows v1.1.
* Check after any engine change: polish spawning emits **repeated `node.expanded` for the same parent**,
  each time with the growing child list. Make sure the web reducer and validator accept that, or emit
  it once.

## 6. Web app: state from the web session (`E:\Winter\siliconsmith-web\web`)

* **Stack:**
  * Next.js **16.3.8** (App Router, **breaking changes vs older Next**: read
    `node_modules/next/dist/docs/` before writing code; `next dev` rewrites `web/AGENTS.md`, so commit it);
  * React 19.3, TypeScript 6, Tailwind 4.3 (`@tailwindcss/postcss`), `motion` 13.5, `d3-hierarchy`,
    `shiki` 4.4 (JS regex engine, custom themes), Geist fonts, vitest 4.
* **Built:**
  * `lib/run-state.ts`: a pure reducer, events → tree/ladders/metrics/costs/sandboxes; drops
    duplicates by `seq`; 17 vitest tests incl. contract conformance of both replays.
  * `lib/contract.ts`: a v1.1 validator.
  * `lib/controller.ts`: replay player plus live SSE `${NEXT_PUBLIC_ENGINE_URL}/api/runs/{id}/events`,
    both feeding the same store.
  * `lib/highlight.ts`, `format.ts`, `labels.ts` (honest ladder labels), `hooks.ts`.
  * Components:
    * `run/`: BranchTree, OutlineTree, NodeGlyph, Inspector, Ladder, Waveform (counterexample SVG),
      CostPanel, MetricsStrip, EventTicker, Player, RunConsole;
    * `charts/`: Pareto, BeforeAfter, Trace;
    * `report/Report.tsx`;
    * `landing/HeroInstrument.tsx` (in progress);
    * `site/` Brand + SiteChrome; `ui/Code.tsx`.
  * Routes: `app/page.tsx` (landing, partly done), **`app/runs/[id]/page.tsx`** (run console; note
    **`/runs/`**, not `/run/`), `app/runs/[id]/report/page.tsx`.
  * Replays: `public/replays/r_mock_demo.ndjson` (generated by `scripts/gen-mock-replay.ts`, a seeded
    discrete-event sim with ≤50 sandboxes; any `r_mock*` id shows a **"Demo data" badge**) and
    `r_m4_first.ndjson` (real).
  * QA screenshots in `web/qa/` (run-demo-cex/end, run-real, at 1440 and 390). `scripts/qa-shots.mjs`
    wraps playwright-cli.
* **Not done (from its brief):**
  1. **Commit.** Fast-forward `feat/web-app` to current main (`2289deb`), commit only `web/`, then the
     main session merges. Delete the junk file **`web/setTimeout(r`**. Gitignore `web/.playwright-cli/`
     and `tsconfig.tsbuildinfo`.
  2. **Contract v1.2:** render polish nodes (dashed edge, "area"/"sw" tag), show `skipped` prove as
     inherited, and the RTL diff for area polish. Update the validator and types.
  3. **Real hero replay:** add `runs/logs/r_m4_second.ndjson` now, and the polish run when it exists.
     Make the landing hero auto-play the best real run (not mock) once one exists.
  4. Finish **landing** (hook, 3-step explainer, prior-work comparison; the web session had verified
     CHIA/LACE/CIDRE before writing claims), then **`/how`** (architecture, Token Factory + Nemotron
     usage, honest-labels explainer), then **`/try`** (C editor + presets; POST to the engine when
     `NEXT_PUBLIC_ENGINE_URL` is set, else a disabled state linking to the replay).
  5. Run the **web-design-guidelines** audit and fix the findings. Do **two screenshot-critique passes**
     at 1440/390 with `taste-skill-leonxlnx`. Make `npm run build` and `npm test` green.
  6. Report anything the engine must emit that the contract doesn't cover.
* **Design direction (keep):**
  * "precision lab instrument": graphite near-black, off-white ink, **one** phosphor-lime accent plus
    semantic red/amber;
  * Geist + Geist Mono, tabular numbers, oscilloscope-grid hints;
  * motion with purpose (branches grow, numbers tick, rungs light in sequence);
  * dark-first with a light "datasheet" theme; respect `prefers-reduced-motion`;
  * **no NVIDIA/Nebius logos** (text mentions only).

## 7. Blockers that need the human (ask once, clearly)

1. **⛔ Token Factory Sandboxes activation.**
   * The key authenticates, but every permission is `false`.
   * The user must email **contree@nebius.com** with the project ID (never the key). The draft is
     ready in the main session's chat, and can go to Gmail drafts if they want.
   * Re-check with `/opt/ss-venv/bin/python scripts/contree_probe.py`, which prints the permissions.
   * **Fallback if still off by about Oct 26:**
     * Nebius **Serverless Jobs** running the same image, via a new `NebiusJobsBackend`; needs a
       registry push, so Docker on E:.
     * Otherwise, run `--backend subprocess` and say so honestly.
2. **Move Docker Desktop's disk to E:** (Settings → Resources → Advanced → Disk image location →
   `E:\Docker`). Needed before building `sandbox/Dockerfile` (about 3 GB).
3. **GitHub permission:**
   * (a) create **private** `hash066/siliconsmith` and push (after the reflog purge, §3.2);
   * (b) fork `sipeed/TinyMaix` for the bot-PR demo.
   * The repo must be **public with the Apache-2.0 license visible** before submission.
4. **Tang Nano 9K** (Sipeed, GW1NR-9) + USB-C data cable: ordered? It's needed for L6, the "on silicon" video shot.
5. Path to the user's "hundreds of customers" load-test repo. Only a k6 script was found, in
   `E:\Projects\Hackathon\Blockquest\ai-agent-wallet-project\load-tests`.
6. Who records the voice-over. Recommend the user rotates the old Nebius key (§3.2).
   * Also flagged to the user: a folder name under `Documents\Codex\2026-10-03\` looks like an OpenAI
     project key, so that key should be rotated.

## 8. The path to 100%: ordered tasks with acceptance criteria

1. **Housekeeping (10 min).** Commit `scripts/fmax_baseline.py`. Re-run the tests.
2. **Polish live run on W1.**
   * Command: `accelerate w1 --k 6 --k-child 4 --beam 2 --depth 2 --run-id r_w1_hero`.
   * Accept: polish nodes appear; the best node is ≥ the golden (aim for ≥3.7× at ≤+3.5%).
   * If round 2 keeps giving 0 gain, use `--depth 1` for the hero run.
   * Fix prompt or ladder issues you find and keep the failures honest. They are demo material
     ("the ladder caught N wrong designs").
3. **Fmax → wall-clock speedup.**
   * Wire `tools/fpga.place_and_route` in:
     * the baseline Fmax at run start, as the median of 3 seeds → `run.baseline.fmax_mhz`;
     * at run end, Fmax for the best and Pareto nodes (median of 3 seeds) → a **new event
       `node.timing {node_id, fmax_mhz, wall_speedup, seeds}`**. Document it as contract v1.3 and
       render it in the web app. Don't re-emit `node.scored`.
   * Put it in `REPORT.md` too.
   * Seed noise is ±8%, so always report the median and the seed count.
4. **W2 hero run** (`accelerate w2 …`). Expect rotate or xor-rotate instructions (`rotl32` is 49%).
   Stacking across rounds should matter here (4 rotate amounts: 16, 12, 8, 7). Then update the README results table.
5. **Merge the web app** (§6.1), then finish §6.2–6.6. Copy the hero replays into `web/public/replays/`.
6. **Engine HTTP API** (needed for live mode and /try). This is `engine/siliconsmith/api.py`, FastAPI:
   * `POST /api/runs {workload, config}` starts a Search in a thread;
   * `GET /api/runs/{id}/events` is SSE from `EventBus.subscribe()`, one event per `data:`;
     `seq` lets the client dedupe;
   * `GET /api/runs` lists runs;
   * enforce `SS_DAILY_BUDGET_USD`, a per-IP rate limit, and a whitelist of workloads.
   * Try-your-C is a **stretch**: it needs a generic harness generator (a fixed function signature + an
     input generator + an auto `host_check`). If time is short, ship /try as presets that start real
     runs on w1/w2.
7. **GitHub bot + the TinyMaix PR** (the "real PR on a real repo" shot).
   * Add `siliconsmith pr <bundle> --repo <clone> --map tm_dot.h=src/arch_rv32ss.h`. It branches,
     copies the RTL into e.g. `hw/siliconsmith/`, adds a new arch header in TinyMaix style (like
     `src/arch_rv32p.h`; check how TinyMaix selects `TM_ARCH` in `include/tm_port.h` /
     `src/tm_layers.c`), commits, pushes the fork and runs `gh pr create` with `REPORT.md` as the body.
   * Plus a GitHub Action (`.github/workflows/siliconsmith.yml`) triggered by an issue comment
     `/siliconsmith accelerate <fn>`. It installs the toolchain with `scripts/setup-toolchain.sh`, runs
     with the `NEBIUS_API_KEY` secret, and opens the PR.
   * **PR descriptions end with:** `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   * Needs the user's OK (§7.3).
8. **Sandboxes for real** (when activated).
   1. Build and tag `siliconsmith-base:latest`, via the `contree` CLI build from `sandbox/Dockerfile`,
      or by building with Docker on E:, pushing to a registry and using `images.oci` import.
   2. `contree_probe.py` → `accelerate w1 --backend contree --concurrency 20`.
   * Accept: real image UUIDs in `sandbox.op` events, children start from the parent's image, and the
     "sandboxes active" count is visible in the console.
   * Do the hero video run on contree.
9. **FPGA (L6)**, if the board arrives.
   1. `fpga.place_and_route(…, bitstream=True)`
   2. `openFPGALoader -b tangnano9k ss.fs` (pass USB into WSL with `usbipd-win`).
   3. Capture UART at 115200 showing baseline vs custom cycles.
   * Film it. Wire the result as ladder L6 = "Verified on silicon (FPGA)" for the winner only.
10. **Hosting.**
    * Web on **Vercel** (the user has the Vercel MCP connected); replay-only must work with no backend
      and no credits.
    * Engine API: run it only when needed (a Nebius VM or Serverless endpoint during the demo and
      judging, within the $100 AI Cloud credit), or keep live mode off and rely on replays plus the
      CLI. Decide by cost.
    * Load test the hosted site (the user's repo, or k6). Then a security review (ECC
      `security-reviewer`): no secrets client-side, rate limits, SSRF-free.
11. **Story.**
    * README: fill the results table; link the replays; add an architecture diagram; keep the honest
      labels; add the related-work section (already drafted) and an explicit "limitations" section
      (PCPI 2-operand ceiling, `.insn` not LLVM, simulation + FPGA not ASIC).
    * `docs/feedback.md`: Sandboxes activation UX, SDK 0.3.6 notes (the Mini-SWE-Agent adapter issue
      noted in their cookbook, permissions shown in `get_token_info` but not explained), model JSON
      reliability, latency and costs measured.
    * **Video ≤3:00** (PLAN §6 storyboard, with the real CLI → console → PR → FPGA). Use ECC
      `remotion-video-creation` for titles and `ui-demo` for screen captures.
    * Devpost text.
12. **Submit** by Oct 30, 12:00 IST.
    * Before that: purge the reflog, run gitleaks, make the repo public, check the license is visible,
      and **re-verify the demo URL works logged-out**.
    * Track: Coding and Agentic Engineering.
    * Include "what was built during the submission period". Everything was built Oct 20–30.

Parallelizable: 5 and 7 can run in parallel sessions with 2–4 (disjoint files: `web/` vs `engine/`).
**Never run two writers on the same files.**

## 9. Budget (credits)

* **Token Factory: $125.**
  * Prices: Ultra $1/$3, Super $0.30/$0.90, Nano $0.06/$0.24 per M tokens.
  * A full run costs about $0.30–0.60. Spent so far is under $1.
  * Reserve **$25 for the Dec 1–15 judging window**; keep `SS_RUN_BUDGET_USD` caps on.
* **Nebius AI Cloud: $100.** Use it for Serverless Jobs fallback and demo hosting; nothing spent.
* Sandboxes are free during the beta.

## 10. Risks

| Risk | Fallback |
|---|---|
| Sandboxes not activated | Serverless Jobs backend (same image); otherwise the subprocess backend, stated honestly |
| Agent < golden | Polish phase; then compare honestly in the README ("the agent reached X; hand-tuned reached 3.77×") |
| Fmax noise flips a comparison | Median of 3 seeds; report wall-clock only for final nodes |
| Credits run out during judging | Replay-first site; live runs rate-limited and budget-capped |
| Board doesn't arrive | Show nextpnr Fmax + bit-identical simulation; L6 stays "skipped" |
| Overclaiming (judges include NVIDIA engineers) | Use only the exact ladder labels; publish limitations |

## 11. Rules for the next agent

* Nemotron-only inside the product. **Honest labels only.** Never fake footage or numbers. Mock replays carry the "Demo data" badge.
* **No secrets in git, chat or logs.**
* Ask before outward-facing actions: push, repo creation, fork, PR, publish, deploy, sending email.
* Keep C: free. Work on E: and in WSL.
* One writer per set of files. The web work stays in `web/` on `feat/web-app` until merged.
* Commit small and often, with the attribution line from §3.2.

## 12. ECC skills and agents: what they're for here

They're copied into `siliconsmith/.claude/` from `D:\Leave\EL\AIML\third_party\ECC` (MIT; ~70 agents
and 311 skills there if more are needed). They load automatically for sessions opened in
`E:\Winter\siliconsmith`.

**Use these:**

| Skill / agent | Use it for |
|---|---|
| `taste-skill-leonxlnx` (Leonxlnx taste-skill v2) | Art direction and the **screenshot look-and-fix loop** for the landing and console. Its real-browser inspector catches "AI-made" slop. Run before every visual sign-off |
| `design-refs/{mono,refined,futuristic,premium,sleek}` (awesome-design-skills) | Reference token sets for the "lab instrument" direction. Borrow, don't copy wholesale |
| `frontend-design-direction`, `make-interfaces-feel-better`, `design-system` | Product-specific direction, polish details (spacing, hit areas, states), token extraction and audit |
| `motion-foundations` → `motion-patterns` / `motion-advanced` | Motion tokens, springs, reduced-motion, SVG path drawing (tree growth, rung sequencing) |
| `web-design-guidelines` (Vercel) | The UI compliance audit. It fetches the latest rules from GitHub, so run it on `web/` before shipping |
| `browser-qa`, `e2e-testing` + **playwright-cli** (`npm i -g @playwright/cli`) | Screenshot QA at 1440/390, a11y, and a smoke test of the hosted URL |
| `ui-demo`, `remotion-video-creation` | Recording the console demo; building the video's titles, captions and charts |
| `verification-loop`, `eval-harness` | Pre-merge gate (build, types, tests, security grep); and an eval set for the agent (e.g., "finds ≥3× on w1 in ≤N calls", pass@k) |
| `cost-aware-llm-pipeline` | Nemotron routing, budgets and prompt-caching ideas for llm.py |
| `dashboard-builder` | Layout heuristics for the metrics strip and cost panel |
| Agents: `architect`, `planner` | Before big changes (API server, GitHub bot) |
| Agents: `python-reviewer`, `typescript-reviewer`, `react-reviewer`, `cpp-reviewer` | Code review per language |
| Agents: `security-reviewer`, `silent-failure-hunter` | Before hosting; error-swallowing in the engine |
| Agents: `e2e-runner`, `build-error-resolver`, `tdd-guide`, `performance-optimizer`, `a11y-architect`, `doc-updater` | As named |

**Ignore:**
* `taste` (ECC): music-video aesthetics.
* `benchmark-methodology`: competitor scoring.

**Other resources:**
* `_vendor/` (gitignored): picorv32, TinyMaix, Monocypher, vercel-agent-skills, awesome-design-skills, taste-skill, playwright-cli.
* PicoRV32 README: the PCPI interface.
* TinyMaix `src/arch_rv32p.h`: the T-Head `smaqa` reference.
* Related work to cite:
  * CHIA, arXiv 2606.27350;
  * LACE, arXiv 2608.02915;
  * CIDRE, arXiv 2509.15782;
  * Andes ACE/COPILOT.

## 13. Memory

The user's Claude memory (`C:\Users\asus\.claude\projects\E--Winter\memory\nebius-nvidia-hackathon.md`)
has the hackathon decisions. Update it with the final state when you finish a milestone. The Amazon
"Stoop" hackathon (deadline Oct 23) is a separate project in `E:\Winter\stoop`; don't touch it.
