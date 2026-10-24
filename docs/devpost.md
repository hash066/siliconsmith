# Hardwright: Devpost submission text

Track: Coding and Agentic Engineering. Repo: https://github.com/hash066/siliconsmith (Apache-2.0). Live: https://siliconsmith.vercel.app

## Tagline

Agents that design hardware, and prove it.

## Inspiration

AI assistants state hardware facts with total confidence and are often wrong: a pin that selects the boot mode, a heat sink that cannot reach its target, a "faster"
instruction nobody proved. A wrong answer costs a dead board or a lost week. We wanted an agent that **cannot claim what a checker has not returned**.

## What it does

Hardwright is a workstation for hardware makers. You describe what you want in plain words, in a chat on the left; a preview on the right shows the result.

* **Board.** Describe a sensor board. The agent drafts a netlist, five deterministic checks (B1 to B5) judge it, and it becomes a **real routed 2-layer KiCad board**
  you can zoom: pads, tracks, ground pour, silkscreen. If the firmware says the wake button is on GPIO12 but the board wires GPIO14, the wrong pad is marked on the
  board and the agent fixes it. You also get a schematic, Gerbers, the KiCad file, BOM and pick-and-place. KiCad's own design-rule check: **0 errors**.
* **Matter.** "A heat sink for a 5 W chip." A validated finite-volume solver, cross-checked by an independent finite-element solver, produces a 3D part coloured by
  temperature and a printable STL, compared side by side with plain fins that use the same material. It reports a loss as plainly as a win.
* **Silicon.** "Make this loop faster." In about two minutes, live: Nemotron proposes a custom RISC-V instruction, writes the Verilog and the software that uses it, and a
  Token Factory Sandbox proves it (lint, a million test vectors, a **Yosys SAT proof for every possible input**, whole-program output check). Real result on the public
  site: **3.32× fewer cycles for +4.8% area**, with a circuit view, a waveform on real operand pairs and a before/after loop.

Every project is saved with its own chat, shows a **Workflow** of connected steps with real status, lists **who verified what** (tool, version, result), and exports as one zip.
It is also an **open-source package and MCP server**, so Claude Code, Cursor or Codex can call the same checkers.

## How we used Nemotron and Token Factory

* **Nemotron 3 Ultra** (architect and diagnosis), **Super** (engineer: Verilog, C, repairs, the independent golden spec) and **Nano** (triage), all through the Token Factory
  OpenAI-compatible endpoint with **native tool calling**: the chat agent performs real actions in the app (open a workbench, set parameters, run a check, move a pin) and
  reports the real cost of each turn ($0.003 to $0.02). Model choice is routed by difficulty.
* **Token Factory Sandboxes** are where everything model-written runs: the live Silicon proof, and the routing of every generated board (a custom image with KiCad 7, Java and
  Freerouting that we built inside Sandboxes). The full Silicon search runs each candidate from its parent's checkpoint image (21 runs, up to 8 at once).
* The evidence rule is enforced in code: UI claims carry evidence ids and the agent's answers are post-checked for invented commands or claimed runs that did not happen.

## What is verified, and what is not claimed

Verified: lint, 1,000,000 vectors, formal proof for all 2^64 inputs, whole-program output, area (Silicon); KiCad 7 DRC, autorouter completion, five netlist checks, pin tables
cross-checked against KiCad's symbol library, a catalogue of 8 injected wiring faults (Board); two independent solvers and equal-material baselines (Matter).
Not claimed: that a board works (it is netlist level, not fabricated or electrically tested), 3D or CFD accuracy (2D steady state, not a measurement), clock speed in live runs (cycles
and area only; the recorded searches include it), the FPGA rung, silicon, a compiler backend. Matter gains over baselines are small (+0.1 to +0.5 K recorded) and the app shows
losses. Run-to-run variance is real and published.

## Challenges

KiCad 7 has no `kicad-cli pcb drc` and its SES importer only works inside the GUI; Freerouting needs a full JRE and a display; Sandboxes start with `HOME` empty and KiCad refuses to
run. We found a live-bundle bug (`name` vs `path`) only by running the real thing. All are in `docs/feedback.md`.

## What's next

Schematic export to `.kicad_sch`, more parts in the library (each needs a cross-checked pad map), boards with more than two layers, and putting the Silicon proofs behind the same MCP server.

## Built during the submission period

All of it: the three workbenches, the agent, the Sandbox pipelines, the app, the package. Hardware core PicoRV32 (ISC); workloads TinyMaix (Apache-2.0) and Monocypher (BSD-2-Clause / CC0);
KiCad libraries (CC-BY-SA 4.0 with library exception); Freerouting (GPL-3.0, separate program in the Sandbox image).

## Try it

* App (no sign-up, $0.50 of demo credit): https://siliconsmith.vercel.app
* From your agent: https://siliconsmith.vercel.app/connect (`claude mcp add hardwright -- hardwright mcp`)
* A real pull request the Silicon engine opened: https://github.com/hash066/TinyMaix/pull/1
* Feedback on Token Factory, Sandboxes and Nemotron: `docs/feedback.md`; strict evaluation: `docs/EVALUATION.md`.
