> **Status (Oct 24 2026):** historical planning document, kept for the record. Current state: `docs/HANDOFF_LATEST.md` and `docs/EVALUATION.md`.

# SiliconSmith: master build plan

> **Coding agents change code to fit the chip. SiliconSmith changes the chip to fit the code.**
> It searches dozens of candidate processor designs in parallel Token Factory Sandboxes, and proves every one before it ships.

| | |
|---|---|
| Hackathon | Nebius x NVIDIA Global AI Hackathon, Coding & Agentic Engineering track |
| Target | **Grand Prize ($20k)**. One winner across all four tracks. |
| Hard deadline | **Fri Oct 30 2026, 10:00 PT = 22:30 IST** |
| Our submit target | **Oct 30, 12:00 IST** (10.5 h buffer) |
| Judging | Dec 1–15. The hosted demo must still work then. |
| Plan version | v1, Oct 20 2026 |

---

## 0. The product: what a user actually gets

The deliverable is **code in your repo**: a pull request containing the custom-instruction RTL, the C intrinsics header, the patched kernel, and a proof + benchmark report. It reaches the user through four surfaces, all driving the same engine:

| Surface | Who / when | What it does |
|---|---|---|
| **CLI** (`pipx install siliconsmith`) | Hardware/firmware engineer at the terminal | `siliconsmith accelerate src/kernel.c --area-budget 5%` → runs the search (local or Token Factory Sandboxes) → writes the bundle / opens the PR → prints a run URL |
| **GitHub integration** (Action + PR comment command) | Team workflow | Comment `/siliconsmith accelerate tm_dot_prod` on a PR or issue → the search runs in sandboxes → the bot opens a PR with RTL + intrinsics + patch + proof report |
| **Web run viewer** | Anyone with the run URL | Live branch tree, inspector, proofs, waveforms, cost; report page. This is the CI dashboard for the agent, *not* a mock-up |
| **MCP server** (stretch) | Other coding agents (Claude Code, Codex, Cursor, Nemotron agents) | Tools: `profile`, `propose_instructions`, `verify_instruction`, `accelerate` |

The demo video shows all of them: terminal command → run URL → tree grows → PR lands on GitHub → FPGA runs it.

## 1. How each scoring criterion gets earned

The four criteria are equally weighted. **Technological Implementation breaks ties**, so it gets the most depth.

| Criterion (official wording, shortened) | What earns it | What the judge *sees* in the video and demo |
|---|---|---|
| **Technological Implementation**: how well it's built and how effectively it uses Token Factory / AI Cloud + Nemotron | A beam search over **Contree sandbox branches**: every candidate CPU is a branch forked from its parent's checkpoint image, with up to 50 concurrent. **Nemotron routing:** Nano does triage, Super writes code, Ultra designs the architecture. The verification ladder runs inside the sandboxes. | Live branch tree; "sandboxes active: 37"; per-model token and cost panel; checks turning green; a counterexample repaired on camera |
| **Design**: a complete, coherent product, not a technical proof of concept | A hosted web app: landing → live run → report → "try your own C". A real pull request against a real repo. Replay mode, so the demo always works. Polished visuals using the design skills. | A product someone could adopt tomorrow: paste code, get verified hardware + PR |
| **Potential Impact**: a credible, specific case for a real audience, solved *as demonstrated* | Audience: RISC-V / FPGA / edge-AI chip teams. Pain: picking a custom instruction takes weeks of architect time, and today's vendor tools (e.g. Andes ACE/COPILOT) still need a human to decide. Demonstrated on a **real open-source int8 kernel**. The honest metric is **wall-clock speedup = cycles × Fmax**. | Before/after on a real model kernel, area cost, Fmax, and the FPGA on a desk |
| **Quality of the Idea**: creative, non-obvious use of Token Factory + Nemotron; genuine understanding | Sandboxes were designed for searching over *code patches*. We use them to search over *processor designs*. We position against prior work (CHIA, LACE, CIDRE, Andes ACE): they implement an instruction a human chose, and we *invent* it, then prove it. | A "Related work" slide and README section; formal proofs; area/Fmax accounting that architects will respect |

---

## 2. Scope

### Must-have (MVP, demo-critical)
1. **Hardware harness**: PicoRV32 (rv32im, fast multiplier, counters) + PCPI custom-instruction slot, Verilator testbench, bare-metal firmware runtime, `rdcycle` benchmarking.
2. **Tool layer** (`ss` CLI, JSON outputs): `profile`, `build`, `lint`, `unit`, `prove`, `e2e`, `synth`, `bench`. It runs identically on the local WSL distro and in a Contree sandbox.
3. **Verification ladder** (honest labels; see §3.5).
4. **Nemotron agent**: propose → implement → verify → repair, with structured outputs.
5. **Search**: beam search over sandbox branches, with a Pareto front and an area budget.
6. **Event stream + persistence** (NDJSON) + **replay**.
7. **Web app**: landing, live run view (tree + inspector + metrics + cost), report.
8. **Hero workload W1**: an int8 NN kernel from a real open-source repo.
9. **Submission package**: public repo (OSS license at top), README, ≤3-min video, Devpost text, Nebius feedback.

### Should-have (big score multipliers)
10. **Second workload W2** (CRC32 / SHA-256 / similar) to prove generality.
11. **PR output** against a fork of the real repo: RTL + header + patched kernel + proof report.
12. **"Try your own C"**: a constrained single-function input, run in a sandbox with networking off, rate-limited.
13. **FPGA proof**: the winning design on a Tang Nano 9K, with UART cycle counts. Needs the board ordered on Oct 20.
14. **Fmax from nextpnr** (Gowin), so the speedup accounts for clock degradation.

### Stretch
15. Multi-cycle PCPI instructions (state, accumulators).
16. C↔RTL formal equivalence via EBMC/hw-cbmc.
17. Auto-generated architecture "design review" narrative (Ultra) as a PDF in the PR.

### Explicit non-goals
- Real LLVM/GCC backend changes. The intrinsic header uses `.insn` and that's enough; we say so honestly.
- Custom silicon or tape-out.
- Generic HLS (C→Verilog of whole functions). That's a crowded field and not our idea.

---

## 3. Architecture

```
                    ┌──────────────────────── web (Next.js on Vercel) ───────────────────────┐
                    │ Landing · Live Run (tree, inspector, metrics, cost) · Report · Try-C    │
                    └───────────────▲───────────────────────────────┬────────────────────────┘
                                    │ SSE events (NDJSON schema)     │ REST: start run / replay
                    ┌───────────────┴───────────────────────────────▼────────────────────────┐
                    │ engine (Python, FastAPI)                                                │
                    │  Orchestrator ─ BeamSearch ─ NodeWorker×N ─ EventBus ─ RunStore(NDJSON) │
                    │       │                │                                                │
                    │  Nemotron router       │ SandboxBackend (interface)                     │
                    │  (Token Factory API)   ├── ContreeBackend  (prod: Token Factory Sandboxes)
                    │   Nano/Super/Ultra     ├── NebiusJobsBackend (fallback)                 │
                    │                        └── LocalBackend    (dev: WSL distro)            │
                    └────────────────────────────────┬───────────────────────────────────────┘
                                                     │ runs `ss <tool>` → JSON
                    ┌────────────────────────────────▼───────────────────────────────────────┐
                    │ sandbox image (Dockerfile): Ubuntu 24.04 + OSS CAD Suite + RISC-V GCC   │
                    │ /work: hw/ (picorv32 + pcpi slot) · firmware · workload · ss CLI       │
                    └────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Repo layout
```
siliconsmith/
  hw/            picorv32 (vendored, ISC), pcpi_slot.v template, testbench (Verilator C++), formal/ (sby)
  firmware/      start.S, link.ld, runtime (uart, rdcycle), ss_intrinsics.h (generated)
  workloads/     w1_int8_nn/, w2_crc/, user/ — each: kernel.c, inputs, golden, manifest.json
  engine/        siliconsmith/ (python pkg): tools/, agent/, search/, sandbox/, events/, api/
  sandbox/       Dockerfile, image build scripts
  web/           Next.js app
  fpga/          Tang Nano 9K top, constraints, build script
  docs/          PLAN.md, contracts/events.md, architecture.md, feedback.md, related-work.md
  scripts/       setup-wsl.ps1, setup-toolchain.sh, demo helpers
  runs/          (gitignored) run logs; selected hero runs copied to web/public/replays
```

### 3.2 The search: the core idea
- **Node** = a CPU configuration (a set of custom instructions, each with RTL + C reference + intrinsic) + a software patch + scores. **Root** = baseline.
- **Expand(node):** Ultra receives the node's *remaining* hot spots (profile + disassembly + source) and proposes **k** instruction candidates (JSON). Each candidate becomes a **child branch**: a Contree operation started **from the parent's checkpoint image**. Super implements it, the ladder runs, and the result is saved as a new checkpoint image.
- **Repair:** on failure, Super gets the structured error (compile log / failing vector / counterexample trace) and gets up to **2 repairs**. If it still fails, Ultra diagnoses once. Otherwise the node dies (red in the UI; the reason is kept).
- **Beam:** keep the top-**B** feasible children by score; expand to depth ≤ **3** (stacking instructions).
- **Score:** `wall_speedup = (base_cycles / cycles) × (fmax / base_fmax)`. Feasible ⇔ all ladder rungs pass ∧ `area_delta ≤ budget`. We track the Pareto front (speedup vs area).
- **Default run:** k=8 at depth 1, B=3, k=5 deeper → ~40 candidates, ≤50 concurrent sandboxes.

### 3.3 Nemotron routing (Token Factory, OpenAI-compatible API)
| Model | Role | Why |
|---|---|---|
| Nemotron 3 **Nano** | Hotspot brief from profile/disassembly; failure triage (classify logs); edge-case vector ideas | Cheap, fast, high volume |
| Nemotron 3 **Super** | Implement RTL in the PCPI template; C reference; intrinsic; kernel patch; repairs | Strong code generation at low cost |
| Nemotron 3 **Ultra** | Propose instructions (architect); beam decisions; counterexample diagnosis; final design report | Deep reasoning where it matters |

- Every call is logged as an `llm.call` event: model, role, tokens, cost, latency. That powers the cost panel and proves platform usage.
- Structured output is validated with pydantic, with retry on invalid JSON.
- **The product's agent is Nemotron only.** Claude Code is used to *build* SiliconSmith, never inside it.

### 3.4 Contree (Token Factory Sandboxes) usage
- **Image:** built from `sandbox/Dockerfile` (`contree build`), tagged `siliconsmith-base`.
- **Prepare once:** baseline built + profiled → checkpoint image `root`.
- **Branch:** each child operation starts from the parent's image, and its result image becomes the child's checkpoint.
- **Isolation:** user-submitted C runs with `networking.enabled=false`.
- **Concurrency:** up to the account limit (50 during beta). The orchestrator uses a semaphore.
- **Fallback:** `NebiusJobsBackend` (Serverless Jobs, same image) and `LocalBackend` (WSL), behind the same interface.

### 3.5 Verification ladder (UI labels must be exactly this honest)
| Rung | Check | Tool | UI label |
|---|---|---|---|
| L1 | RTL lint-clean, firmware builds | Verilator `--lint-only`, GCC | "Builds" |
| L2 | RTL unit == C reference semantics on edge cases + 1M random vectors | Verilator unit harness | "Matches C reference (1,000,000 vectors)" |
| L3 | **Formal:** unit ≡ independent reference-spec RTL for *all inputs* (miter, SAT) + PCPI handshake properties | SymbiYosys | "Formally proven equivalent to spec" |
| L4 | Whole workload output bit-identical to the baseline core | Verilator full SoC | "Bit-identical output" |
| L5 | Area (cells/LUTs/FFs) and Fmax | Yosys `synth`, `synth_gowin`, nextpnr-himbaechel | "+3.9% LUTs · 41 MHz" |
| L6 | Runs on real FPGA | Tang Nano 9K | "Verified on silicon (FPGA)" |

### 3.6 Event contract
See `docs/contracts/events.md`. It's the single contract between the engine and the web app, so the frontend can be built in parallel against mock and replay data.

---

## 4. Milestones (each has an acceptance test)

| # | When | Deliverable | Acceptance |
|---|---|---|---|
| **M0** | Oct 20 | Repo, WSL toolchain on E:, vendored deps, ECC agents/skills in `.claude/`, `.env.example`, Contree access check | `make -C hw hello` prints "hello" from PicoRV32 in Verilator |
| **M1** | Oct 21 | Baseline harness: SoC (rv32im + fast mul + counters + PCPI slot), firmware runtime, W1 workload + golden | `ss bench --workload w1` → deterministic cycles + output hash JSON |
| **M2** | Oct 21–22 | **Golden path by hand:** one custom instruction (int8 dot4) through L1–L5 | All rungs green, speedup > 1, JSON report |
| **M3** | Oct 22 | Tool layer final + sandbox image + ContreeBackend with checkpoints | Same JSON from sandbox as local; a child forked from a parent image sees the parent's files |
| **M4** | Oct 23 | Nemotron single-branch agent loop (propose → implement → ladder → repair) | Agent finds a ≥2× instruction for W1 within budget, no human input |
| **M5** | Oct 24 | Beam search + concurrency + EventBus + RunStore + replay | A ≥30-node run completes; NDJSON replays identically |
| **M6** | Oct 20→26 (parallel) | Web app: landing, run view, report, try page; design-system pass | Real replay renders; a11y audit clean; playwright-cli screenshots (desktop + mobile) reviewed |
| **M7** | Oct 26–27 | W2 workload; packaged CLI (`siliconsmith accelerate`); GitHub Action + `/siliconsmith` PR command opening a PR on a fork of TinyMaix; Try-your-C | W2 speedup shown; a PR command on the fork produces a bot PR |
| **M8** | Oct 27–28 | Hosting + hardening: deploy, rate limits, budget caps, replay fallback, load test, security review; FPGA if the board arrived | Hosted URL survives the load test; spend cap enforced |
| **M9** | Oct 28–29 | README, architecture diagram, related work, Nebius feedback, **video**, Devpost text | Video ≤ 3:00, uploaded public; all checklist items ticked |
| **M10** | Oct 30, ≤12:00 IST | **Submit** | Devpost confirmation |

**Parallel tracks**
- A: engine/hardware (M0–M5, M7)
- B: web (M6), starting now against mock events
- C: FPGA (M8), when the board arrives
- D: story/video (M9)

---

## 5. Web app: design and screens

**Direction:** "precision lab instrument". It should feel like an oscilloscope crossed with a modern dev tool.
- **Colour:** graphite near-black canvas, off-white ink, **one** signal accent (phosphor lime) + semantic red/amber. Dark-first; light theme supported.
- **Type:** Geist (UI) + Geist Mono / JetBrains Mono (every number, every code block). Numbers are tabular.
- **Motion:** branches *grow*; numbers *tick*; rungs light up in sequence; never decorative-only. Respect `prefers-reduced-motion`.
- **Skills used:**
  - `taste-skill` (direction + critique);
  - awesome-design-skills `mono` / `refined` / `futuristic` as references;
  - ECC `frontend-design-direction`, `make-interfaces-feel-better`, `motion-*`, `design-system`;
  - Vercel `web-design-guidelines` for the audit;
  - `playwright-cli` for screenshot QA.

**Screens**
1. **Landing:** hook line, an auto-playing replay of the hero run as the background, two CTAs: *Watch a run* · *Try your code*. A three-step explainer. Related-work positioning.
2. **Live run:** the main screen.
   - Left: the **branch tree** (d3-hierarchy + custom SVG, animated).
   - Right: the **inspector** for the selected node:
     - instruction card (mnemonic, semantics, rationale);
     - ladder rungs;
     - tabs for Verilog / C reference / intrinsic / patch diff;
     - **counterexample waveform** (SVG from VCD) on failure.
   - Top: the metrics bar (best wall-speedup, area Δ, Fmax, cycles, sandboxes active).
   - Right rail: **Nemotron cost panel** (Nano/Super/Ultra tokens + $).
   - Bottom: event ticker.
3. **Report:** Pareto chart, before/after bars, the final instruction set, proofs, download bundle, PR link, FPGA photo/video.
4. **Try your C:** an editor (single function + input generator), presets, rate-limit notice; it starts a live run or shows a cached one.
5. **How it works:** architecture diagram, Token Factory + Nemotron usage, honest-labels explainer.

---

## 6. Demo video (≤ 3:00)
| t | Shot |
|---|---|
| 0:00 | Hook: "Coding agents optimize code for chips. This one changes the chip." A real int8 kernel on RISC-V: N cycles. |
| 0:15 | One command / one click: `siliconsmith accelerate w1 --area-budget 5%` |
| 0:25 | Profile heatmap → Ultra's hotspot brief → 8 instruction cards fan out |
| 0:45 | **Branch tree grows**; "sandboxes active: 37"; rungs turning green |
| 1:15 | **A proof fails** → counterexample waveform → Super repairs → proof passes |
| 1:40 | Beam expands winners; Pareto front; best: X× wall-clock at +Y% LUTs |
| 2:05 | The generated PR: RTL, intrinsic, patched kernel, proof report |
| 2:25 | **Tang Nano 9K on the desk** printing cycles before/after (or the bit-identical FPGA run) |
| 2:45 | Cost panel: "whole design search: $Z on Token Factory". Close: "Change the chip, not just the code." |

Made with ECC `remotion-video-creation` for the intro/outro and titles; real screen capture for everything else. No fake footage.

---

## 7. Submission checklist
- [ ] Public repo, **OSS license visible at the top** (Apache-2.0), README with setup + run instructions
- [ ] README: how Nemotron (Nano/Super/Ultra) is used, where Token Factory + Sandboxes accelerated the work, other Nebius services
- [ ] Working demo URL (hosted app; replay works without credits)
- [ ] Public YouTube video ≤ 3:00 showing Token Factory + Nemotron usage
- [ ] Track: Coding and Agentic Engineering
- [ ] Feedback on Token Factory / Sandboxes / AI Cloud / Nemotron (`docs/feedback.md`), aiming for a Most Valuable Feedback prize too
- [ ] Third-party licences respected (PicoRV32 ISC, workload repo licence, ECC MIT)
- [ ] No secrets in the repo (gitleaks scan)

---

## 8. Budget
| Pool | Amount | Plan |
|---|---|---|
| Token Factory credits | $125 | Dev ~$70 · hero runs ~$20 · **reserve $25 for the judging window** · buffer $10. Per-run spend cap in the orchestrator. |
| Nebius AI Cloud credits | $100 | Fallback Serverless Jobs; API hosting only during judging if needed |
| Sandboxes | free in beta | Main compute |
| Hosting | $0 | Vercel (web). API host decided at M8 (cheapest compliant option). |

Ultra ≈ $1/$3, Super ≈ $0.30/$0.90 and Nano ≈ $0.06/$0.24 per M tokens (in/out), from aggregator listings. **Verify in the console.**

---

## 9. Risks and fallbacks
| Risk | Likelihood | Fallback |
|---|---|---|
| Contree access not activated in time | Med | Email contree@nebius.com on day 0; NebiusJobsBackend (same image); LocalBackend for dev |
| Nemotron produces broken RTL | High (early) | Constrained PCPI template; structured errors; repair loop; Ultra diagnosis; few-shot from the M2 golden path |
| Formal equivalence on multipliers times out | Med | Bound widths (int8 lanes), per-lane miters, timeouts → fall back to the L2 label (never overclaim) |
| Credits run out during judging | Med | Replay mode is the default on the landing page; live runs behind a rate limit + daily cap |
| FPGA board late | Med | L6 is stretch; show nextpnr Fmax + bit-identical sim |
| Speedup looks "too easy" | Med | Strongest baseline (rv32im fast mul); wall-clock with Fmax; area cost shown |
| Visual quality not "wow" | Med | Design track starts day 0; screenshot critique loops with taste-skill + playwright-cli |

---

## 10. Tooling we lean on
- **Claude Code + ECC** (copied into `.claude/`):
  - agents: architect, planner, code-reviewer, python-reviewer, typescript-reviewer, react-reviewer, cpp-reviewer, security-reviewer, e2e-runner, performance-optimizer, silent-failure-hunter, build-error-resolver, tdd-guide, a11y-architect, doc-updater;
  - skills: frontend-design-direction, make-interfaces-feel-better, motion-*, design-system, dashboard-builder, e2e-testing, browser-qa, verification-loop, eval-harness, cost-aware-llm-pipeline, remotion-video-creation, ui-demo, benchmark-methodology.
- **Design skills:** taste-skill, awesome-design-skills, vercel web-design-guidelines, playwright-cli.
- **Load test:** the user's "hundreds of customers" repo (path pending), or k6 as the fallback.

## 11. Needs from the user (blocking marked ⛔)
1. ⛔ Put `NEBIUS_API_KEY` and `NEBIUS_PROJECT_ID` in `siliconsmith/.env.local` (never paste keys into chat). Then run `contree auth ls`; if it says `inactive`, email contree@nebius.com with the project ID.
2. ⛔ Confirm the exact Nemotron 3 model IDs available in your Token Factory console.
3. Order a **Sipeed Tang Nano 9K** (+ USB-C data cable) today.
4. GitHub: repo name + account (it goes public before submission).
5. Path to the "hundreds of customers" load-test repo.
6. Who records the video voice-over.
