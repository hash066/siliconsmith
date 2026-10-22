# SiliconSmith Studio: from one tool to a platform of verified agents

Written Oct 22 2026. Hard deadline: Oct 30 2026, 10:00 PT (22:30 IST). Today is day 1 of 8.
Status of the base product: about 93% complete, honest, public-ready (see README). **This plan must never put that submission at risk.**

## 0. The idea in one paragraph

The valuable thing we built is not "a RISC-V tool". It is a **verified-agent engine**: an LLM proposes, implements and repairs candidates; a
**verification ladder** that the model cannot talk its way past decides what is true; a **search** runs candidates in isolated sandboxes; and
everything that survives ships with an **evidence bundle**. Hardware instructions are the first **domain pack**. Studio is the product shell
around the engine: a sidebar of tools like ElevenLabs, graph/workflow templates like Comfy, and a library where every entry is backed by evidence.
The rule that makes it impressive instead of hand-wavy: **a tile exists in Studio only if it runs for real.** Ideas that do not run yet
are shown as a labelled roadmap, never as working features.

## 1. What is real, what is a roadmap (honest labels)

| Studio area | Status by Oct 29 | Basis |
|---|---|---|
| **Forge** (the search console) | real, already built | `/runs/<id>`, 3 real runs, 1 on Token Factory Sandboxes |
| **Library** (proven instructions with evidence) | real, buildable in ~1.5 days | 4 formally proven instructions already exist in the bundles |
| **Templates** (workflow presets) | real, ~1 day | saved search configs + the real run each produced |
| **Verify** (paste your own instruction, we prove it) | real, ~1.5 days, no LLM cost | the ladder already runs standalone; runs in a Sandbox with networking off |
| **Lab: MatterCompiler-lite** (heat-sink generator) | optional, ~4 days, decision gate Oct 25 | needs a validated solver library; see section 5 |
| **Roadmap: GhostDriver** | roadmap card only | needs real hardware and traces we do not have |
| **Roadmap: BoardSmith** | roadmap card only | KiCad flow plus a datasheet evidence library; too large for 8 days |

## 2. Studio shell (web)

Sidebar (ElevenLabs-style), dark "lab instrument" language we already have:

1. **Home**: what you can do, recent runs, the three results.
2. **Forge**: start or watch a search (replay today, live once hosted). The current run console, unchanged in substance.
3. **Library**: browse proven instructions. Each card: mnemonic, what it computes, RTL, spec, speedup, area, the run that found it,
   the proof, and a **Reproduce** command. Filter by workload, speedup, area, verified rung.
4. **Templates**: one-click presets (for example "int8 dot product for NN inference", "ARX cipher rotates", "bring your own kernel (CLI)").
   A template is a saved search config plus the real run that proves it works. Starting one is a real run when the engine is hosted, otherwise a replay.
5. **Verify**: paste Verilog plus a C reference, get the ladder run in a sandbox (lint, vectors, formal if you also paste a spec). Cheap, interactive, judge-testable.
6. **Labs / Roadmap**: clearly marked. Only items that truly run appear under Labs.

Graph view (Comfy-like): the existing search tree already is a graph. Add a "Workflow" view of the pipeline
(Profile, Propose, Implement, Ladder, Polish, Time, Bundle) as nodes with live status. Pure presentation of real events; no fake edges.

## 3. The Evidence Library (answers "not just hallucinating")

Every claim the product makes points at an **evidence record**: `evidence/<id>/manifest.json` with SHA-256 of each artifact
(RTL, spec, C reference, patch, proof log, event log), tool versions (Verilator, Yosys, nextpnr, GCC), the run id, backend,
and the exact command to reproduce. `siliconsmith verify-entry <id>` re-runs lint, vectors and the formal proof from the stored artifacts,
with no LLM, in about a minute. Library entries seeded from real runs only:

* `dot4` and `dot4.sum` (TinyMaix), `xor.rotl12` and `chacha.xor.rotl8` (ChaCha20).

This is our version of "people put the shapes into the library by hand": the library is hand-checkable, reproducible and refuses
entries without a passing proof. A tester can verify an entry themselves.

## 4. Hosting so judges can test it (the "looks fake" problem)

Replays prove it happened; live runs prove it works. Order of preference:

1. **Nebius VM** once your permission request is granted (kit already in `deploy/nebius/`, never run on a real VM).
2. If Nebius stays blocked: run Fmax inside Sandboxes (the image already has Yosys and nextpnr), which makes the API a thin Python service
   that fits any small container host. The product still runs on Token Factory (Nemotron plus Sandboxes), which is what the rules require.
3. Always: **Verify** and **Reproduce** use no LLM credits, so judges can use them freely. Live Forge runs stay capped
   (one active run, per-IP and daily budget; already implemented).

Decision gate: Oct 24. If neither 1 nor 2 is up by then, Studio ships with replay Forge plus live Verify (via Sandboxes) and says so.

## 5. The optional second domain: MatterCompiler-lite

Only if the base Studio work is done and green by Oct 25. Scope that can be real in four days:

* Domain pack for a **2D passive heat spreader** under a volume budget.
* The physics is **not written by the model**. We ship a small steady-state conduction-plus-convection solver and **validate it against the
  analytic fin solution and a grid-convergence test** before anything else (this is the "evidence library" for physics).
* Nemotron writes **parametric geometry generators**; candidates run in parallel in Sandboxes; the winner is re-checked with a second,
  independently written solver; manufacturability checks (minimum feature size, connectivity); output STL plus the code.
* Visual: a Three.js viewer replaying candidate geometries evolving, with the same event contract as Forge.
* Honest limits to state: 2D, steady state, a stated convection coefficient; "verified" means "agrees with an analytic case and a second solver within X%", not "validated on a real printed part".

If it is not producing a real run with a real second-solver check by Oct 25, it is cut and stays on the roadmap.

## 6. Why GhostDriver and BoardSmith stay on the roadmap

* **GhostDriver**: the story is excellent but its proof is a device coming alive on real hardware. We have no device, no captured traffic and
  an eight-day clock. A fake or simulated "device" would be exactly the kind of overclaim we avoid.
* **BoardSmith**: the cross-domain check (firmware pin vs PCB net vs datasheet limit) is the right idea, but it needs a KiCad flow and a datasheet
  evidence library with accurate citations. Done wrong it fabricates specs. Roadmap with the design written down.

Both appear as roadmap cards with what each would need, so the platform story is visible without claiming it.

## 7. Day plan (today is Oct 22)

| Day | Work | Gate |
|---|---|---|
| Oct 22 | This plan; freeze `main` as `v1.0-submission` (tag); start branch `studio` | you approve scope |
| Oct 23 | Evidence manifests and `verify-entry`; seed 4 library entries from real runs | `verify-entry` passes for all 4 |
| Oct 24 | Studio shell: sidebar, Library, Templates; hosting decision | live engine up, or fallback chosen |
| Oct 25 | **Verify** page (sandbox, no network); workflow view of the pipeline | decision: MatterCompiler-lite go or cut |
| Oct 26 to 27 | MatterCompiler-lite if go; otherwise polish, tests with 2 to 3 outside testers, fix top issues | one real run, or cut |
| Oct 28 | Merge only if all green; redeploy; re-run load test; final scans | freeze |
| Oct 28 to 29 | Record video, Devpost text, public repo, submit by Oct 29 | submitted |

Merge rule: `studio` merges to `main` only if tests pass, labels are honest, and the load test still passes. Otherwise `v1.0-submission` is what gets submitted.

## 8. Outside testers (optional, 2 to 3 people)

One engineer, one non-engineer (for example fashion). Fifteen minutes each, a fixed script: find a proven instruction in the Library, verify it,
watch a run, explain what happened in their own words. Record time-to-understand and confusion points. Use a quote in the Devpost text only with
the tester's permission and exactly as said. Fix the top three problems found.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Scope creep breaks the finished submission | `v1.0-submission` tag; merge gate; second domain is cuttable |
| Nebius compute stays blocked | thin-API fallback (section 4); Verify and Reproduce still live |
| Verify runs untrusted Verilog | Sandboxes, networking off, time and size limits, no secrets in the sandbox |
| A library entry that does not reproduce | entries are generated only from passing runs and re-verified in CI |
| Overclaiming a roadmap item | labelled cards; a test that fails if a Labs tile has no real run |
