> **Status (Oct 24 2026):** historical planning document, kept for the record. Current state: `docs/HANDOFF_LATEST.md` and `docs/EVALUATION.md`.

# App UX v2: prompt first, chat on the left, preview on the right (Lovable-style)

Oct 23 2026. Replaces the pane/dashboard layout of `/app`. The landing page stays. Backend, verifiers and honesty rules stay.

## Why

The first version of `/app` was a professional dashboard: three resizable panes, a workflow bar, JSON editors, check matrices, a recorded run that auto-plays. A new person cannot tell what to do. The owner said it plainly: if they cannot understand it, they cannot help anyone else use it.

## The user

A maker, student or junior embedded engineer with an idea in words and no hardware team. They have never heard of "rungs". They want: *describe it, see it, trust it, download it.* Compare Lovable: a prompt box, then chat on the left and a live preview on the right.

## The flow (three screens, no more)

1. **Start (`/app`)**: one big centred prompt box, "What do you want to make?". Under it three example cards, one per workbench, each a real, working prompt:
   * Matter: "A heat sink for a 5 W chip, 40 mm square, under 70 C."
   * Board: "A battery ESP32 sensor board with a BME280 and USB-C charging; check it against its firmware."
   * Silicon: "Make this loop faster with a custom RISC-V instruction." (kernel picker: TinyMaix dot product or ChaCha20)
   A small row of chips lets the user pick Auto, Matter, Board or Silicon (default Auto: the agent routes the prompt). Credits pill and a sign-in-free "How it works" link in the corner. No sidebar on this screen, no tour modal over a dense UI; the tour is 3 short coach marks on the next screen.
2. **Workspace**: after the first prompt the page shifts: **chat on the left (about 38%), preview on the right**. Nothing else is visible by default.
   * Left: the conversation. The agent narrates in plain language ("I will model a 5 W chip on a 40 mm plate"), shows one-line progress chips (Designing, Checking, Proving) that expand to details, and ends with a plain verdict and a next-step suggestion. Input box at the bottom with suggested follow-ups ("Make it cooler", "Use radial spokes", "Fix the failing check").
   * Right: the **Preview** with three tabs only: **Preview**, **Files**, **Proof**. A header shows the workbench and a green/amber/red verdict in plain words.
   * Everything advanced (JSON design, parameters, scope and limits, evidence facts, model choice) lives behind one "Advanced" drawer. No resizable panes, no workflow bar, no run list.
3. **Result actions** (in the Preview header): Download (STL / netlist+header+BOM / RTL+patch+report zip), Share link, Start over.

## What each workbench shows in the Preview

* **Matter**: a large rotatable 3D part (the existing viewer), coloured by temperature, with peak temperature, material used and a one-line verdict against plain fins ("1.3 K cooler than plain fins" or "does not beat plain fins"). Three simple controls (power, size, fins) that re-run the free solver. Files: STL, parameters JSON. Proof: rungs M1 to M5 in plain words.
* **Board**: a **report card** (not a graph): each check as a card with a tick or cross and one plain sentence ("Button wired to pin 14 but firmware says pin 12: the board will not boot reliably"), a "Fix it" button that asks the agent to repair, a simple block diagram (MCU, power, USB, sensor) drawn from the real design, and the firmware pin header. Files: pin header, BOM, KiCad netlist. Proof: rungs B1 to B5 in plain words with fact ids on demand.
* **Silicon**: **a live run, not a replay.** The user picks a kernel (or pastes a small C function from the supported set), the agent proposes a custom instruction, writes the Verilog and the rewrite, and the verifiers run live in Token Factory Sandboxes (lint, a million-vector test, formal proof, whole-program output check, cycle count). The Preview shows the instruction card, the proof stages ticking off in real time, and the measured speedup. Files: RTL, C intrinsic, patched kernel, report. Proof: the ladder. A recorded 20-minute full search is only a small "See a full recorded search" link under Proof, never auto-playing.

## Copy rules

Plain words first; jargon second in a tooltip ("rung" is called "check"; "formally proven" shows "Proved for every possible input"). Max two short lines of text in any card. Verdict colours: green = passed every check that ran, amber = some checks unknown or limited, red = a check failed.

## Live Silicon (new, required)

A bounded single-candidate pipeline in Token Factory Sandboxes, hosted as a Python function (no VM): Ultra proposes one instruction for the chosen workload, Super implements RTL, C reference, spec and the kernel rewrite, the existing worker evaluates it in a Sandbox (lint, unit, prove, whole-program e2e, bench, synth area), up to two repairs, hard caps (about $0.15 and 4 minutes). Streams v2 events (`node.stage`, `llm.call`, `sandbox.op`, `node.scored`) so the UI shows real progress. Fmax place-and-route is skipped (the toolchain is not in the function), so the result states cycle speedup and area, not wall-clock. It needs the Token Factory key in the Python API project (owner adds it) and the existing `siliconsmith-base:latest` image.

## Acceptance (the product is "done" when this passes)

A person who has never seen the product, with no help, in under 3 minutes each: (1) makes a heat sink and downloads the STL; (2) checks a sensor board, finds the fault and gets it fixed by the agent; (3) runs a Silicon instruction live and reads the verdict. Measured with 3 outside testers (one engineer, one designer, one non-technical). Failure = they ask "what do I do now?". Fix until they do not.

## What is cut from the default UI

Resizable panes, the workflow bar, the recorded-run list, the JSON editor, the check matrix, the connection-graph hairball, the Model selector (moves to Advanced), the old Tour modal (replaced by 3 coach marks), any auto-playing replay.
