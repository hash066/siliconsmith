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
