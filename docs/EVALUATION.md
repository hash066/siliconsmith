# Strict evaluation: Hardwright, from the judges' and the user's side

Oct 23 2026. Method: ECC `browser-qa` (smoke, interaction, visual, accessibility), `verification-loop` (build, types, tests, security, diff),
`eval-harness` thinking (pass/fail per criterion, evidence per claim). Run against the LIVE production site as a logged-out visitor, read-only except
one small agent turn (about $0.007 of demo credit). Raw output: `runs/audit/*` (gitignored), scripts in `E:\Winter\tools\pw\audit*.mjs`.

## 1. Verdict

**SHIP WITH FIXES.** The product works end to end for a real visitor, which is rare for a hackathon entry. It is not yet a complete submission:
the repo is private, the README and Devpost text still describe the old product, there is no video, and the credit balance is wrong in production.

## 2. What was tested and what happened (evidence)

| Area | Result |
|---|---|
| Landing `/` | 200; LCP 546 ms cold desktop; no console errors; no failed requests; no horizontal overflow at 1440 or 390 |
| Landing links | 12 of 14 resolve; **2 fail**: repo link 404 (repo is private), TinyMaix PR link had a typo `hash66` (fixed in `098bfce`, not yet deployed) |
| Bench games (real engines) | Shape-the-spreader returned a real result (78.8 C); pass at 1440 and 390 |
| `/app` first visit | 5-step tour appears, completes, is remembered, does not reappear (1440 and 390) |
| Workbenches | Matter, Silicon and Board all open with real content; Matter deep link with `autorun=1` returns a real simulation with M1 to M5 and baselines |
| Board in the app | check returns B1 to B5; B4 fails on the GPIO12 fault with evidence ids |
| **Agent (live, real key)** | loaded the fault template, ran the check, answered "B4 fails: wake_btn on GPIO12 strapping pin, netlist wires GPIO14", cited `board:fault_gpio12_vs_gpio14#B4`, showed cost **$0.007 (6,741 in, 90 out, Ultra)**; refused to overclaim in the bait test; the key appears in none of 4 pages or their scripts |
| **Credits** | **FAIL**: after that turn the pill still said "$0.50 left" (per-instance memory, serverless instances differ) |
| Performance | app CLS **0.137 + 0.049** (limit 0.1): FAIL; LCP and weight fine (landing 602 KB, app 45 KB) |
| Accessibility (axe wcag2a/aa/22aa) | **serious**: color-contrast on the landing nav button, the active sidebar label and tree items at 390; scrollable demo pane not keyboard reachable. No critical. Keyboard: visible focus on the first 8 tab stops (tour) |
| Build and tests | `tsc` clean; web 225 tests; engine 559 passed, 14 skipped; `next build` green |
| Security | no key in client bundles; hosted API blocks the model-spending `/run` routes; rate limits and caps are per instance (stated in the UI) |

## 3. Scorecard against the four judging criteria (strict; where a point is lost, why)

| Criterion | Score | What earns it | What loses points |
|---|---|---|---|
| **Technological implementation** | **8 / 10** | Nemotron routed across Ultra, Super and Nano with native tool calling; Token Factory Sandboxes run per-candidate verification with checkpoint images (15 of 15 children start from the parent image, asserted from the log); formal SAT proofs, validated FV and FEM solvers, deterministic Board checks; evals that report their own failures; a live agent that performs actions and reports real cost | judges cannot start a live Silicon search (Nebius compute blocked; replays only); only one run used Sandboxes; credits are not durable; Board agent reliability sits at its thresholds, not above; Fmax place-and-route runs outside Sandboxes |
| **Design** | **8 / 10** | follows the reference's landing structure with our own identity; playable real-data games; tour, resizable panes, workflow bar, evidence chips, Cursor-like agent; honest states everywhere | CLS 0.19 in the app; 4 serious contrast and focus findings; first run of Matter is empty; the Board connection graph is a hairball; no video yet |
| **Potential impact** | **6.5 / 10** | a specific audience (embedded and hardware engineers) and a real pain (agents that state hardware facts with confidence); reproducible evidence; a real PR on a real repo | scope is narrow and honest: netlist-level Board, 2D steady-state Matter with +0.1 to +0.5 K margins, two harnessed Silicon workloads, nothing on silicon, no user testing evidence |
| **Quality of the idea** | **8.5 / 10** | "agents that cannot claim what they have not proven" across chips, boards and matter, with an evidence rule enforced in code and in the UI | three workbenches can read as diluted unless Silicon (strongest) leads the story |

## 4. Submission completeness (Devpost requirements)

| Requirement | State |
|---|---|
| Public repo, OSS licence visible at the top | **NOT MET**: repo is private and the new work is unpushed (Apache-2.0 detected by GitHub) |
| README with setup | **STALE**: still the SiliconSmith framing |
| Working demo URL | MET: https://siliconsmith.vercel.app |
| Public video of 3 minutes or less | **NOT MET**: script exists (`docs/video.md`, written for the old UI); footage of the old console only |
| How Nemotron and Token Factory were used | PARTIAL: `docs/devpost.md` is stale |
| Feedback on Nebius/NVIDIA tools | MET: `docs/feedback.md` (add Hardwright-era findings) |
| No secrets in the repo | MET at last scan; re-scan before pushing |

## 5. Blockers, ranked

1. **Repo private and the new work unpushed.** Judges cannot see any of it. Needs the owner's go-ahead (reword merge-commit messages first).
2. **README and Devpost describe the old product.** Rewrite around Hardwright with the evidence library told as "a personal library of verified instructions".
3. **No video.** Needs a new script for the app (tour, agent action, Bench) and the owner's voice-over.
4. **Credit balance wrong in production** (fix in progress: signed per-visitor cookie ledger; the shared $25 pool needs a durable store to be exact).
5. **Accessibility and layout shift** (fixes in progress).

## 6. Path to "a complete product"

* Fixes in flight: credits ledger, CLS, contrast, keyboard, first-run Matter and Board, graph layout, landing contrast and links.
* Then: merge, redeploy, re-run this audit (target: 0 serious axe, CLS below 0.1, credits decreasing across turns, all links 200 once public).
* Then: docs (README, Devpost, feedback), video, outside testers (one engineer on Board, one designer on Matter), push, public, submit.
* Optional upgrade that would raise the Technology and Impact scores: Nebius compute (judges start a live Silicon search); a durable credit store (Vercel KV or Upstash); one outside tester's real task and quote with permission.

## 7. Update, Oct 24 2026: first-time-user pass on the merged build (live production)

Merged the app redesign, the web agent panel and live Silicon into `workstation`; engine 590 passed (14 skipped), web 274 passed, `tsc` and `next build` clean. Then ran newcomer tasks against https://siliconsmith.vercel.app.

| Acceptance task | Result |
|---|---|
| 1. Heat sink and STL | PASS. Prompt card, real agent turn (about $0.005), honest verdict ("no better than plain fins"), `heat-sink.stl` 124,884 bytes downloaded at 1440 and 390 |
| 2. Board fault found and fixed by the agent | FAILED first, then fixed. The fix turn resent a 2 KB design, hit invalid JSON and the 1,200-token cap, and ended with no answer. Added a small-argument `board_fix_pin` tool and a 2,400-token turn cap. Retest: found 4 of 5, moved wake_btn GPIO12 to GPIO14, 5 of 5, said it was a built-in example, $0.016 |
| 3. Live Silicon | PASS after three host fixes. w1 TinyMaix: 3.32x cycles, +4.8% area, 103 s, $0.04 model cost, bit-identical, formally proven. w2 ChaCha20: 1.14x, +2.3% area, 112 s, $0.07. Streaming works through the site proxy |

Host fixes found by this pass: the pasted key carried whitespace (stripped in config), the Sandbox SDK also needs `NEBIUS_PROJECT_ID` in the API project (without it every Sandbox call is `ForbiddenError`), and models sometimes put raw control characters in JSON strings (parser now tolerant).

Measured (Chrome headless, desktop 1440 and phone 390): axe wcag2a/aa/22aa 0 violations on start and workspace; no horizontal overflow; no console errors; CLS 0.064 desktop and 0.061 phone (was 0.134 and 0.248 before reserving header and result space).

Still open: README and Devpost for Hardwright, video, outside testers, push and public repo, durable credit pool, ESP32 footage. Known newcomer friction: the agent's first board reply says "you need to click Run" and also asks permission (clumsy wording); on a phone the first-visit tip covers part of the chat until dismissed.

## 8. Update, Oct 24 2026 (later): outcome work from docs/OUTCOME_PLAN.md, measured on production

| Plan item | State | Evidence |
|---|---|---|
| Board: a real routed PCB | DONE for the three built-in examples; not for a new design drafted by the agent | 48 x 36 mm, 2 layers, fully routed, **KiCad 7.0.11 DRC 0 errors** (15 silkscreen warnings); B4 marker on the right ESP32 pad (14 vs 13). Pipeline: deterministic placement, Freerouting 1.9.0, KiCad exports (Gerber/drill zip, positions, BOM, SVG, `.kicad_pcb`). 23 layout tests including a full KiCad run with a pad-for-pad round trip and rotation maths checked against KiCad. Pin tables cross-checked against KiCad's own symbol library |
| Board: viewer with markers | DONE | layers, ground pour, net highlight, check markers on pads, zoom to the failing pad, layout files in Downloads |
| Silicon: show the hardware | DONE for live runs | real run on the public site: `views/instruction.json` made in the Sandbox (Yosys word-level netlist: 4 multipliers + 3 adders; 2,047 simple gates, longest path 43; 8 operand pairs simulated against the C reference), before/after loop, proof explainer |
| Matter: 3D | already present (rotatable extruded plate with temperature colours); baseline side-by-side NOT added | |
| Workflow tab (ComfyUI-style) | DONE for all three workbenches | cards with real status; full graph over the window |
| Deliverables and Verified-by | DONE | "Everything as one zip" (opens in standard unzip, 12 files for a board project); Verified-by ledger on each Proof tab |
| Board: schematic view, `.kicad_sch` | NOT DONE (stretch) | |
| Board: layout for a design the agent drafts live | NOT DONE: KiCad cannot run on Vercel; would need a Sandbox image with KiCad, Java and Freerouting | |
| Silicon: waveform from a VCD | Replaced by a table-waveform of simulated operand pairs (real Verilator runs); no VCD file | |

Bugs found by looking: live Silicon bundle files carried `name` while the app read `path` (Silicon Files and anything built on them were empty in production); the first Board layout exported silkscreen as nothing (KiCad 7 calls footprint shapes `MGRAPHIC`); KiCad 7 has no `kicad-cli pcb drc` (DRC runs through pcbnew); Freerouting needs a full JRE and a virtual display.

Measured: axe 0 violations and CLS 0.03 at 1440 and 390; tests: engine 631 passed (14 skipped), web 328 passed.

## 9. Update, Oct 24 2026 (evening): the three gaps from section 8 are closed

| Item | State | Evidence |
|---|---|---|
| Routed board for a design the agent drafts or the user edits | DONE | KiCad, Java, Xvfb and Freerouting live in a Token Factory Sandbox image (`siliconsmith-kicad:latest`, built by `board/layout/build_sandbox_image.py`, Freerouting jar SHA-256 checked). The host places the parts, ships the job, and the Sandbox routes and checks. Measured through the public site: custom design -> fully routed 40 x 44 mm board, **KiCad 0 errors, 107 s**, Gerbers downloadable. Endpoint `POST /api/board/layout` streams progress and heartbeats; costs no model tokens; limited per visitor and overall (in memory); cached by netlist. 15 new tests (host, errors, endpoint) run without KiCad by replaying a real board |
| Board schematic view | DONE (SVG, symbols and net labels from the netlist, firmware/netlist mismatch marked on the MCU, "Download as SVG") | tests on the real template netlists: every connection appears as a labelled pin, no symbol overlaps. NOT done: a `.kicad_sch` file |
| Matter baseline side by side | DONE | the engine now returns the equal-material plain-fin plate as a viewer artifact; its peak equals the reported baseline peak (tested); both plates share one colour scale |

Found while doing it: Sandboxes start with HOME empty and KiCad refuses to run without one (set HOME in the image build and in the worker command). Layout files are served from the API host's cache of the last 8 boards; nothing is stored.

Measured: engine 640 passed (14 skipped), web 339 passed.

## 10. Update, Oct 24 2026 (night): replicating the reference products (docs/REFERENCE_PLAN.md)

Added, all on top of what existed, deployed and checked on production:

| Reference idea | Hardwright addition | Check |
|---|---|---|
| Split mechanical (3D) + electronics (PCB, schematic) workspace | Board "3D" view and a "Studio" split (layout beside 3D); 3D built from the real board geometry, labelled approximate | board3d tests on the real board; axe 0 |
| Design pipeline strip (brief, parts, BOM, PCB, DRC, export) | Stage strip: Design, Parts and BOM, DRC, Manufacture, each with a real status dot | browser run |
| DRC with locations | DRC panel: KiCad's findings grouped by type, click a finding to zoom to it on the board | parsed the real report; location conversion tested |
| Manufacturing quote | Manufacture panel: ready-to-send checks, board specification read from the board, Gerber download, links to PCBWay, JLCPCB and OSH Park quote pages. **No prices are shown: we have no quote** | browser run |
| Component search and library | Parts panel: search, categories, pins, facts with source status, datasheet links (the sources recorded in the library), BOM table and CSV, "Ask the agent to add it" | real part files in tests |
| Agent suite | Silicon "The agents" panel: Architect (Ultra), Engineer (Super), Triage (Nano), Prover (Sandbox) with the run's own calls, tokens and cost | real live run: architect/engineer/prover done, triage not needed |
| Test plan with scenarios | Silicon "Test plan": 8 named scenarios, each with Description, Code, Results, and Export CSV | real live run: 8 of 8 passed |
| Waveform viewer | Interactive viewer: variables to show or hide, step and play, zoom, cursor readout | real live run: play moves the cursor |

Not yet (in REFERENCE_PLAN.md): "Make PCB board?" card with Default / Smallest / Reduce EMI and constraints text (needs engine placer options); PCB status bar; running your own operand pair as a new scenario (needs a Sandbox endpoint); internal-signal waveforms from a Verilator VCD.

Measured: engine tests unchanged (parts-list and isolation fixes), web 356 passed; axe 0 serious on all six Board views at 1440 and 390 with no horizontal overflow.
