# Hardwright

**Agents that design hardware, and prove it.**

Hardwright is a workstation for people who make hardware: describe a heat sink, a sensor board or a slow loop in plain words, and a
Nemotron agent builds it. Every claim it makes has to pass a checker it cannot argue with, so you get a part, a board or an instruction
you can open in a real tool, plus the evidence for it. It also ships as an **open-source Python package, command-line tool and MCP server**
so any coding agent can use the same checkers.

> Built for the Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering).
> **Try it, no sign-up: https://siliconsmith.vercel.app** · Apache-2.0
> Use the checkers from your terminal or editor: https://siliconsmith.vercel.app/connect

```bash
pip install "hardwright[matter] @ git+https://github.com/hash066/siliconsmith#subdirectory=engine"
claude mcp add hardwright -- hardwright mcp        # or: codex mcp add ... / Cursor / VS Code (see /connect)
hardwright board check --template fault_gpio12_vs_gpio14     # exit 1: the firmware uses a boot-strapping pin
```

---

## Three workbenches, one idea

The idea: **an AI may say what it likes, but it may only claim what a deterministic verifier returned.** Each workbench ends in something
you can open in a real tool, and each result carries the tool, the version and the verdict behind it.

| Workbench | You say | You get | Verified by |
|---|---|---|---|
| **Board** | "A battery ESP32 sensor board with a BME280 and USB-C charging; check it against its firmware." | A **routed 2-layer KiCad board** you can zoom, a schematic, a report card, Gerbers, KiCad file, BOM, pick-and-place. The wrong pin is marked on the pad. | Five netlist checks (B1 to B5: well formed, electrical rules, bus rules, firmware pins vs netlist and boot-strapping hazards, battery estimate), KiCad 7 design-rule check, the autorouter's completion |
| **Matter** | "A heat sink for a 5 W chip, 40 mm square, under 70 C." | A 3D part coloured by temperature, a printable **STL**, and a side-by-side with plain fins that use the same material | A finite-volume solver validated on analytic cases, an independent finite-element solver, printability rules, equal-material baselines (M1 to M5) |
| **Silicon** | "Make this loop faster with a custom RISC-V instruction." | A new instruction written **live**: Verilog, C intrinsic, rewritten kernel, a circuit view of the hardware, a waveform on real operand pairs, a before/after loop | Verilator lint, 1,000,000 test vectors, a **Yosys SAT proof for every possible input**, whole-program output check, cycle count and area |

Around them: a **chat agent** (Nemotron 3 Ultra, Super and Nano on Nebius Token Factory, with native tool calling) that performs actions in the app
and reports what it spent; **projects** (each workbench is a folder of projects with its own chat and settings); a **Workflow** tab that shows every
project as connected steps with their real status; a **Verified-by ledger** on every Proof tab; **one-click zip** of a project; and $0.50 of demo
credit per visitor from a $25 pool.

## What is real

Everything below ran for real and is reproducible; numbers are from the run logs and the test suites.

* **Board.** The three example boards (clean, wiring fault, strapping-pin fault) route fully with **0 KiCad errors** (15 silkscreen warnings), 48 × 36 mm.
  Boards for **any** design are made on request in a **Token Factory Sandbox** that has KiCad, Java and Freerouting: a custom design routed in **107 s**
  with 0 errors, measured on the public site. Placement is deterministic code (not a model), so a board is reproducible. Pin tables are cross-checked
  against KiCad's own symbol library. The checker is tested against a catalogue of 8 injected wiring faults.
* **Silicon, live.** A real run on the public site: Nemotron Ultra proposes, Super implements, a Sandbox proves it. TinyMaix int8 dot product:
  **3.32× fewer cycles for +4.8% area** (another run 2.69×), about 2 minutes and $0.04 of model tokens; ChaCha20: 1.14×. The recorded 20-minute full searches
  (with clock-speed estimates) reached **4.04× cycles / 3.76× wall-clock** on TinyMaix ([pull request](https://github.com/hash66/TinyMaix/pull/1)).
* **Matter.** Gains over an equal-material plain-fin plate are small and we say so: +0.1 to +0.5 K in the recorded evaluations, and the app will show a loss
  ("1.3 K hotter than plain fins") rather than hide it.
* **Tests.** Engine 640 passed (14 skipped), web 339 passed, axe accessibility 0 violations, layout shift 0.03, strict first-time-user pass in
  `docs/EVALUATION.md`.

## Honest limits

* The board check is **netlist level**. It does not prove a board works; the routed board is **not fabricated or tested electrically**. Part facts are
  author-curated, each with a `citation_checked` flag. 2 layers, 0.2 mm tracks, 0.15 mm clearance.
* Matter is **2D steady state** with stated constants: not CFD, not a measurement. "Validated" means agreement with analytic cases, nothing more.
* A live Silicon run skips clock-speed (place and route) so it reports **cycles and area, not wall-clock**; the recorded searches do include it.
  The FPGA rung (L6) was not run on a board. Software calls the instruction through inline assembly, not a compiler backend.
* The agent can be wrong: its answers are checked against the verifiers and say so when a check fails. Rate limits and the shared credit pool are per server instance.
* Run-to-run variance is real and published: TinyMaix wall-clock across our runs ranged 3.17× to 3.86×.

## Use it from your coding agent

The `hardwright` package (in `engine/`, Apache-2.0) is offline and free: no model, no network, no API key. Every check answers `pass`, `fail` or `unknown`;
only `pass` is a claim.

```python
import hardwright as hw
hw.board_check(template="fault_gpio12_vs_gpio14")["passed"]                       # False (B4)
hw.board_fix_pin(template="fault_gpio12_vs_gpio14", function="wake_btn", pin="GPIO14")["passed"]   # True
hw.matter_simulate(power_w=5, stl_path="heat-sink.stl")["peak_c"]
```

MCP tools: `board_templates`, `board_get_template`, `board_check`, `board_fix_pin`, `board_parts`, `matter_simulate`. Verified with the official MCP Python client.
Setup lines for Claude Code, Codex, Cursor, VS Code and Claude Desktop: `hardwright mcp --setup` or https://siliconsmith.vercel.app/connect.

## How it is built

```
browser ──► Next.js app (Vercel)                         chat agent: Nemotron Ultra / Super / Nano (Token Factory, tool calling)
              │  /api/board|matter|silicon/* (proxy)       actions: open workbench, set parameters, check, simulate, run live
              ▼
         Python API host (Vercel, FastAPI)  ──►  Token Factory Sandboxes
           Board checker, Matter solver               siliconsmith-base   : Verilator, Yosys, RISC-V GCC  (Silicon proofs)
           live Silicon pipeline                      siliconsmith-kicad  : KiCad 7, Java, Freerouting    (routed boards)
```

* **Nemotron.** Ultra is the architect (proposals, diagnosis), Super the engineer (Verilog, C, repairs, the independent spec), Nano triages. Every call is logged
  with tokens and cost; a chat turn costs about $0.003 to $0.02, a live Silicon run $0.04 to $0.07.
* **Token Factory Sandboxes.** Everything model-written (Verilog, C) runs only inside a Sandbox: the live Silicon run, and the routing of every generated board.
  The full search runs each candidate from its parent's checkpoint image (21 Sandbox runs, up to 8 at once, in the headline run).
* **The evidence rule.** A claim in the UI carries an evidence id (`part:esp32.gpio12.strapping`, `board:fault_gpio12_vs_gpio14#B4`, `run:...`). The agent's
  answers are post-checked: an invented command or a claimed run that did not happen is flagged.
* **Library.** `evidence/` holds three verified instructions that anyone can re-check with no model: `siliconsmith verify-entry dot4-tinymaix`.

## Run it locally

Requirements: Python 3.11+, Node 22, and for the full pipelines Linux or WSL2.

```bash
pip install -e "engine[matter,dev]"            # the checkers, CLI and MCP server
pytest engine/tests/test_hardwright_pkg.py      # package, CLI and MCP tests (no toolchain needed)
cd web && npm install && npm run dev            # the app; the hosted API is used unless LOCAL_PYTHON_API is set

# the full engine (Silicon search, KiCad layout) needs the toolchain:
sudo bash scripts/setup-toolchain.sh            # Verilator, Yosys, nextpnr, RISC-V GCC
pip install -e "engine[all]" && cp .env.example .env.local     # NEBIUS_API_KEY, NEBIUS_PROJECT_ID
siliconsmith accelerate w1 --backend contree    # the full Silicon search, every candidate in a Token Factory Sandbox
python -m siliconsmith.board.layout.build_sandbox_image         # build the KiCad Sandbox image (once)
```

Deploy notes, the Sandbox image recipes and every gotcha we hit are in `docs/HANDOFF_LATEST.md` and `docs/feedback.md`.

## Repository layout

```
engine/hardwright/          the open-source package: Python API, CLI, MCP server
engine/siliconsmith/        board/ (checker, layout, Sandbox routing), matter/ (solver), live/ (live Silicon), search, ladder, backends
engine/tests/               640 tests          engine/scripts/    build_boards.py (precomputes the template boards)
web/                        the app (Next.js)  web/public/boards/ the routed template boards
workloads/ hw/ firmware/    real kernels (TinyMaix, Monocypher), PicoRV32 SoC, runtime
evidence/                   verified instructions (re-checkable without a model)
docs/                       EVALUATION.md (strict evaluation), HANDOFF_LATEST.md, plans, feedback.md, video.md, devpost.md
```

## Related work, and what is new here

Commercial custom-instruction flows (Andes, Cadence Tensilica) build the processor after a human decides the instruction; research agents (CHIA, LACE) implement a
described extension; AI circuit-design tools (Flux Copilot and others) generate a design without a verifier that can refuse it. Hardwright puts a **deterministic
verifier between the model and every claim**, across chips (formal proof), boards (KiCad rules plus firmware-versus-datasheet checks) and matter (two independent solvers),
and ends each in a file you can open elsewhere.

## Licenses

Apache-2.0. Vendored or adapted code keeps its license: PicoRV32 (ISC), TinyMaix (Apache-2.0), Monocypher (BSD-2-Clause or CC0-1.0), KiCad footprints and symbols
(CC-BY-SA 4.0 with the library exception) and Freerouting (GPL-3.0, used only as a separate program inside the Sandbox image, never linked or redistributed here).
