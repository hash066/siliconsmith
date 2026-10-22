# SiliconSmith Workstation: a verified-agent workbench for hardware engineers

Written Oct 22 2026 (day 1 of 8). Deadline Oct 30 2026, 10:00 PT = 22:30 IST. Submit by Oct 29.
Supersedes `PLATFORM_PLAN.md`. Built with the ECC skills: frontend-design-direction (design contract, content states, rendered gate),
eval-harness (capability and regression evals, pass@k), cost-aware-llm-pipeline (routing, immutable cost ledger, narrow retries),
dashboard-builder (operator questions, no vanity panels).

**Standing rule: a workbench appears in the product only when it has produced a real, fully-verified run. No simulated screens, no fake data.**
The finished submission (`v1.0-submission` tag, ~93% done) stays the fallback; new work merges only through the gates in section 11.

---

## 1. The product in one paragraph

One workstation for people who make physical things, with three workbenches under one roof and one agent beside them:

* **Silicon**: invent and prove custom RISC-V instructions (built, real, 3 runs, 1 on Token Factory Sandboxes).
* **Board**: design a board's schematic, parts and firmware pin map together, then catch where they disagree (new).
* **Matter**: write the code that discovers a physical structure (a passive heat spreader), simulate it, and ship printable geometry (new).
* **Agent** (right side): Nemotron 3 Ultra / Super / Nano on Nebius Token Factory. It explains, starts, repairs and cites. It cannot declare anything "proven"; only the verifiers can.

One spine runs through all three: **intent, agent proposes, verifiers decide, evidence, artifacts**. The workstation shows the same shape
in every domain, so a user who learns one workbench already knows the others (like ElevenLabs' one-account, many-tools model, but for
hardware and with proofs).

## 2. The new user

**Who:** an embedded/hardware/mechanical engineer or maker who is good at their craft and tired of two things: copying unverified answers from a chatbot,
and doing 80% of the work by hand to be sure of the last 20%. **Job to be done:** "give me a design I can trust enough to build, and show me why."
**Why they stay:** every number has a provenance chip, every claim has a check, and every artifact reproduces from one command.

First-run flow (the 90-second story): open Workstation, pick a template, watch the agent propose and the verifiers light up, open an evidence chip,
ask the agent "why did candidate 4 fail?", export the bundle.

## 3. Design contract (frontend-design-direction)

| Field | Decision |
|---|---|
| Purpose | Operate and trust agent-built hardware designs in one place |
| Audience | Hardware/embedded/mechanical engineers, repeat users; scan: status, evidence, next action |
| Tone | Precision bench instrument: graphite, off-white ink, one phosphor signal colour, semantic red/amber; dense but quiet |
| Memorable detail | **The evidence chip**: a small calibration-sticker style tag on every number (tool, version, run, command) that opens the evidence drawer |
| Constraints | Existing Next.js 16 + Tailwind 4 app; tokens in `globals.css`; dark-first with light datasheet theme; WCAG AA; reduced-motion respected |
| First viewport | The workbench itself (canvas + agent), never a marketing hero |

Layout at 1440x900 (390x844 collapses the rails into tabs):

```
+----------------------------------------------------------------------------------------------+
| SiliconSmith  Project: env-sensor   [ Silicon | Board | Matter ]    run 3/3 proven   $0.21  (cost)|
+-----------+-----------------------------------------------------------+----------------------+
| Project   |  CANVAS (per workbench)                                    |  AGENT               |
| - Intent  |  Silicon: search tree + ladder                              |  model: auto (U/S/N) |
| - Runs    |  Board:   schematic graph + check matrix                    |  chat + tool calls   |
| - Library |  Matter:  field/geometry viewer + Pareto of candidates      |  [Run] needs confirm |
| - Templates|                                                            |  evidence chips      |
+-----------+-----------------------------------------------------------+----------------------+
| Timeline / events  |  Evidence drawer (tool, version, hash, reproduce command)                |
+----------------------------------------------------------------------------------------------+
```

### Content states (every surface must define these)

| State | Agent panel | Board checks | Matter viewer | Library | Run canvas |
|---|---|---|---|---|---|
| Loading | streaming skeleton, stop button | per-check spinner, stable matrix | solver progress per candidate | skeleton rows | tree grows from events |
| Empty | suggests 3 starter prompts and templates | "no design yet" + start from template | "no geometry" + template | explains evidence rule | "pick a template" |
| Error | names the failing call, offers retry or smaller task | failed check with the exact fact and part | candidate failed: reason + code error | entry fails reproduce: shows diff | node pruned with reason |
| Partial | shows tool results received, marks missing | passed/failed/unknown separated; unknown never counts as pass | some candidates done, others running | entry with missing artifact flagged | live + replayed mix labelled |
| Success | cites evidence ids; offers export | all required checks green + "author-curated facts" notice | winner + second-solver agreement | reproduce passed with timestamp | best node + bundle link |
| Permission / limit | "daily budget used: replays and Verify still work" | n/a | n/a | n/a | live run capped: replay offered |

Rendered finish gate: capture 390x844, 768x1024 and 1440x900; keyboard-only pass; visible focus; contrast; reduced motion;
long-content check (long mnemonics, long net names); then the evidence JSON + `check-evidence.js`. Source inspection alone never passes.

## 4. Shared kernel (what makes it one product)

Do **not** refactor the working Silicon engine. New domains are separate packages that reuse `llm.py`, `events.py`, and the sandbox job protocol:

```
engine/siliconsmith/        existing (silicon)
engine/siliconsmith/board/  new: parts library, netlist model, checks, agent loop
engine/siliconsmith/matter/ new: solver, generators, validators, agent loop
```

`DomainPack` contract (a convention, not a rewrite): `schemas`, `propose`, `implement`, `ladder` (ordered rungs, each a deterministic check
returning pass/fail/skipped + detail + evidence), `score`, `bundle`. Event contract **v2** is additive: `run.started.domain` and `run.started.ladder`
(the rung list with labels), `node.stage.stage` becomes a free string per domain, and `artifact.created {kind, path, sha256}`. v1.x streams stay valid, so
all existing replays keep rendering. The web reducer already derives everything from events.

## 5. Workbench: Silicon (exists) plus Library and Verify

* **Library**: proven instructions with evidence manifests (SHA-256 per artifact, tool versions, run id, reproduce command). Seed from real runs only:
  `dot4`, `dot4.sum`, `xor.rotl12`, `chacha.xor.rotl8`. `siliconsmith verify-entry <id>` reruns lint, vectors and the formal proof with no LLM (about 1 minute).
* **Verify**: paste Verilog + C reference (+ optional spec for the formal proof); the ladder runs in a Sandbox with networking off and size/time limits. No LLM cost.
* Templates: "int8 dot product", "ARX cipher rotates" (each linked to its real run).

## 6. Workbench: Board (BoardSmith-lite)

**Scope that can be real:** a netlist-level co-design check. **Not** PCB layout, routing, or fabrication. The label says so.

* **Input:** a template ("battery environmental sensor: ESP32 module, I2C temperature/humidity sensor, LiPo + USB-C charging, 48 h target") or a free-text brief.
* **Parts library (about 8 to 10 parts):** ESP32-WROOM-class module, BME280-class I2C sensor, LDO regulator, Li-ion charger IC, USB-C receptacle, pull-ups, LiPo cell, connector.
  Each part has pin table (name, number, capabilities, voltage limits), absolute and recommended ratings, peak/typical currents, source document and section.
  **Honesty:** facts are author-curated from public datasheets and standards (for example the I2C rise-time relation and the USB-C sink CC resistor rule); each record carries
  `citation_checked: false` until someone cross-checks it, and the UI says "author-curated, not independently verified" until then. Never invent a page number.
* **Agent output:** design JSON (parts, nets, MCU pin assignments), a firmware pin header (C), a BOM, and a KiCad netlist (`.net`) generated by our own code.
* **Ladder (exact labels):**

| Rung | Check (deterministic code) | Label shown only if passed |
|---|---|---|
| B1 | every connected pin exists in the part's pin table; required pins connected; no net with two drivers | "Netlist is well formed" |
| B2 | voltage domains within each pin's rating; peak current sum vs regulator limit; charger input vs USB 5 V | "Electrical limits respected (curated facts)" |
| B3 | I2C pull-up rise time vs the bus mode; USB-C sink CC pull-downs present | "Bus and connector rules satisfied (curated facts)" |
| B4 | firmware pin header vs netlist: same pin, same function; no input-only pin driven; no flash pins or strapping-pin hazard | "Firmware matches the netlist" |
| B5 | battery life from a duty-cycle model with the stated currents and the arithmetic shown | "Battery estimate meets target (model, not measured)" |

* **The demo that sells it:** the workstation injects one real fault (firmware says interrupt on GPIO12, netlist wires GPIO14; GPIO12 is also a strapping pin),
  B4 flags it with the fact and the part, the agent proposes a repair, the ladder reruns, B1 to B5 pass. The fault catalogue is 8 faults:
  pin mismatch, strapping-pin misuse, input-only pin used as output, I2C pull-up too large, missing USB-C CC resistors, regulator overload, over-voltage on a 3.3 V pin, I2C address collision.
* **Evidence:** every check result cites the part-fact record it used (`part:esp32.gpio12.strapping`), shown as an evidence chip.
* **Non-goals:** layout, EMC, thermal, real manufacturing, claiming "will work on a real board".
* **Effort:** about 3 days (parts library 0.5, checker 1, agent loop 0.5, UI graph and matrix 1).

## 7. Workbench: Matter (MatterCompiler-lite)

**Scope that can be real:** a 2D steady-state heat spreader under a material budget, printable as an extruded plate. The model writes geometry code; it does **not** write the physics.

* **Problem:** a plate of thickness t carries a square heat source (a chip) of Q watts; material fraction (volume) budget V; convection h on both faces to ambient T∞.
  Governing model: steady conduction with a through-thickness convective loss term, `-div(k t grad T) + 2 h (T - T∞) = q`, solved on a grid with a material mask `m(x,y)`.
* **Solver (ours, not the model's):** finite-volume sparse solve (SciPy). **Validated before anything else** against the analytic straight-fin solution and an analytic radial case, and a grid-convergence test. Thresholds fixed in advance: fin analytic within 1%, 2x refinement within 2%.
* **Agent job:** write **parametric geometry generators** (fin patterns, branching trees, radial spokes) as Python in a Sandbox (networking off). That is the safe-execution story: untrusted LLM-written code runs in Token Factory Sandboxes.
* **Search:** candidates run in parallel in Sandboxes; Pareto of peak temperature vs material used; Nemotron proposes the next generators from the failures (not random search).
* **Ladder (exact labels):**

| Rung | Check | Label |
|---|---|---|
| M1 | solver passes its validation suite (analytic + convergence), run in the same sandbox image | "Solver validated against analytic cases" |
| M2 | generator output is a valid mask: size, material within budget, connected to the source | "Geometry valid and within budget" |
| M3 | printability: minimum feature size, no isolated islands, no enclosed voids | "Printable (feature-size rule)" |
| M4 | winner re-solved with an independently written second solver and at 2x resolution, within thresholds | "Second solver agrees within 3%" |
| M5 | beats a stated baseline (plain rectangular fins of equal material) | "Beats baseline by X K" |

* **Artifacts:** STL (extruded mask), the generator code, a JSON of parameters and results, a report. Viewer: Three.js extruded plate coloured by temperature; candidate gallery; the evolution replay uses the same events.
* **Honest limits shown in the UI:** 2D model, steady state, stated h and k, not validated on a printed part, no airflow CFD.
* **Effort:** about 3.5 days (solver and validation 1, generators and sandbox loop 1, agent loop 0.5, viewer 1).

## 8. Agent panel (the Nebius-hosted agent)

* **Models (all on Token Factory):** Ultra (plan, architect, diagnose failures), Super (tool calls, repairs, code), Nano (summaries, intent routing).
  Auto-router by task complexity with a manual override; the active model badge is always visible.
* **Tools (JSON-schema validated):** read-only and automatic: `library.search`, `evidence.get`, `run.explain_failure`, `board.check`, `matter.simulate_preview`.
  Actions need a click and show a cost estimate first: `run.start`, `verify.run`, `artifact.export`.
* **Cannot lie:** answers that contain "verified/proven/passes" must carry an evidence id; the renderer downgrades or flags uncited claims. Only verifier output can set a status.
* **Context:** the structured project state and recent events, summarised by Nano, not raw logs.
* **Cost (cost-aware-llm-pipeline):** immutable ledger (each call returns a new ledger, no shared mutable counter), per-turn token cap, per-visitor and daily caps (daily cap already in the API),
  retry only on transient errors (429, 5xx, connection), never on 400/401. Prompt caching only if a spike shows Token Factory supports it.
* **Hosting without waiting for a VM:** the agent endpoint is a Next.js route handler on Vercel calling Token Factory with a server-side key (never sent to the browser).
  The key and budget live in Vercel environment variables; limits need a small store (Vercel KV) or a conservative per-instance fallback.
* **Open spike:** whether the Nemotron models on Token Factory support OpenAI-style function calling. If not, use the JSON "action" protocol we already use for the engine.

## 9. Hosting plan (so judges can test)

| Capability | Where it runs | Needs Nebius compute VM? |
|---|---|---|
| Replays of real runs, Library, evidence drawer | Vercel static | no |
| Agent chat and explanations | Vercel route handler, Token Factory | no |
| Verify (Silicon), Board checks, Matter preview solve | Sandboxes, started from a Vercel Python function (start, return id, client polls) | no, if the spike below passes |
| Full Forge search (about 20 min) | engine on a VM | yes; until then replay, and the live one is the CLI |

Spike (day 2): can a Vercel Python function start a Sandbox run and return an operation id that a second invocation polls? If yes, judges can run real verification and real simulations with no VM.
If your Nebius permission request is granted, the VM kit in `deploy/nebius/` is used for full searches.

## 10. Evals (eval-harness): defined before building

| Eval | Type | Grader | Target |
|---|---|---|---|
| Silicon regression: engine tests (22), replay contract tests, `verify-entry` on 4 entries | regression | code | pass^3 = 100% |
| Board fault detection: 8 injected faults | capability | code (deterministic) | 8/8 detected, 0 false positives on the clean design |
| Board agent: template to design passing B1 to B5 | capability | code | pass@3 >= 80% over 5 runs |
| Board repair: agent repairs each injected fault | capability | code | pass@3 >= 75% |
| Matter solver validation (analytic, convergence) | capability | code | all within thresholds |
| Matter agent: beats equal-material rectangular-fin baseline | capability | code | at least 1 of 3 runs |
| Matter second solver agreement | capability | code | within 3% on the winner |
| Agent panel: tool-call schema validity | capability | code | >= 95% |
| Agent panel: uncited "proven" claims after filtering | regression | rule | 0 |
| Cost per agent session | cost | code | < $0.05 |
| UI: rendered finish gate at 3 viewports | regression | evidence JSON + checker | pass |

Rule: any eval that fails at its gate is reported as failed in the docs; thresholds are not edited after seeing results.

## 11. Schedule and gates (Oct 22 to 29)

Parallel sessions on disjoint files (one writer per file set): **S1** web shell + agent panel (`web/`), **S2** Board (`engine/siliconsmith/board/`),
**S3** Matter (`engine/siliconsmith/matter/`), **S0** (me) Silicon Library/Verify, spikes, hosting, integration.

| Day | S0 | S1 | S2 | S3 |
|---|---|---|---|---|
| Oct 22 | tag `v1.0-submission`; branch `workstation`; evals written | design contract + tokens + shell skeleton | parts library schema + 3 parts | solver + analytic validation tests |
| Oct 23 | spikes: function calling; serverless Sandboxes start/poll; Library manifests + `verify-entry` | sidebar/rails, workbench switcher, evidence drawer | netlist model + B1 to B3 | solver converged; mask validators |
| Oct 24 | hosting decision gate | agent panel UI + `/api/agent` | B4 to B5 + fault injection | generators in Sandbox + candidate loop |
| Oct 25 | **GATE:** each new workbench has one real run with all rungs, or it is cut | Library + Verify pages | Board agent loop + repair | Matter agent loop + second solver |
| Oct 26 | integrate events v2 into the console | Board canvas (graph + matrix) | demo fault script | Matter viewer |
| Oct 27 | integration freeze, evals run, rendered gate, load test | polish | cross-check part facts | polish |
| Oct 28 | merge if green; redeploy; secret scan; video capture | | | |
| Oct 29 | video, Devpost text, repo public, **submit** | | | |

Cut order if time runs out: (1) second new workbench, (2) Verify page, (3) Matter 3D viewer (keep 2D), (4) templates. Never cut: the evidence rule, the honest labels, the replays of real runs.

Merge rule: `workstation` merges to `main` only if all gate evals pass, labels are honest, no secret in the diff, and the hosted load test still passes. Otherwise `v1.0-submission` is submitted.

## 12. Dashboard rules (dashboard-builder) for every workbench canvas

Each canvas answers four operator questions, in this order; a panel that does not answer one is removed.

| Question | Silicon | Board | Matter |
|---|---|---|---|
| Is it proven? | ladder rungs | check matrix B1 to B5 | M1 to M5 |
| Where is the bottleneck? | hot loop share, stage timing | worst-margin check | hottest region on the plate |
| What changed? | diff vs parent node | diff vs previous design | diff vs previous generator |
| What now? | polish, stack, export | repair, export netlist | next generator, export STL |

Cost and tokens live in the right rail, not on the canvas.

## 13. Outside testers (optional, 2 to 3 people)

One engineer on Board, one designer or fashion person on Matter (they can judge the visual story), one general user on Silicon. 15 minutes each, same script:
find an evidence chip, ask the agent why something failed, export an artifact. Record time-to-understand and confusion points; fix the top three. Quote someone in the Devpost text only with their permission and exactly as said.

## 14. How it maps to the four judging criteria

| Criterion | What the judge sees |
|---|---|
| Technological implementation | Nemotron routed across three sizes; Sandboxes run generated code and per-candidate verification; deterministic verifiers; reproducible evidence |
| Design | One coherent workstation, a signature evidence chip, states designed for failure and partial data |
| Potential impact | Hardware engineers get designs they can trust and re-verify; three real workflows, not a demo script |
| Quality of the idea | Agents that write code whose output is a chip, a board or a physical object, and that cannot claim what they have not proven |

## 15. Risks

| Risk | Mitigation |
|---|---|
| Two new engines plus shell in 8 days | parallel sessions, hard Oct 25 gate, cut order above, `v1.0-submission` fallback |
| Wrong datasheet fact in the Board library | `citation_checked` flag shown in the UI; small curated set; testers cross-check; no page numbers invented |
| Matter solver trusted without validation | validation suite runs first and gates M1; second solver and refinement for the winner |
| Function calling unsupported by Nemotron | JSON action protocol (already used) |
| Serverless cannot start/poll Sandboxes | Verify and checks run in the CLI; replays and agent chat still hosted |
| Untrusted generator code | Sandboxes, networking off, time and memory limits, no secrets in the sandbox |
| Public agent endpoint spends credits | server-side key, per-visitor and daily caps, replay fallback |
| A tile promises something not built | roadmap labels; test that fails if a workbench has no real run |
