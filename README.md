# SiliconSmith

**Coding agents change code to fit the chip. SiliconSmith changes the chip to fit the code.**

SiliconSmith profiles a C hot loop, **invents a custom RISC-V instruction** for it, writes the hardware
(Verilog) and the software that uses it, **proves the hardware correct**, measures the real speedup and
area, and hands you a reviewable bundle (or pull request). Nemotron is the architect and the engineer;
every candidate CPU is built and verified in its own sandbox.

```bash
pip install -e 'engine[sandboxes]'          # from this repo (see "Run it locally")
siliconsmith accelerate w1 --area-budget 5
#  run r_20261021_101500 on contree
#    watch: https://<console>/runs/r_20261021_101500
#  -> siliconsmith-out/r_20261021_101500/{rtl/, include/, src/, REPORT.md}
```

> Built for the Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering track).
> License: Apache-2.0.

---

## What you get

A bundle you can merge, not a chat transcript:

| Path | What it is |
|---|---|
| `rtl/ss_insn_<name>.v` | the new instruction as a pure combinational unit (`rs1`, `rs2` → `rd`) |
| `rtl/ss_pcpi.v` | a drop-in decoder that attaches the units to PicoRV32's co-processor port |
| `include/ss_intrinsics.h` | C intrinsics (`.insn r 0x0B, …`) plus a C reference fallback for host builds |
| `src/…` | your kernel rewritten to use the instruction, verified bit-identical |
| `REPORT.md` | speedup, area, every proof, Nemotron usage and cost, and every rejected candidate with the reason |
| `run.ndjson` | the full event log, replayable in the run console |

The same engine is reachable three ways: the **CLI** (above), a **GitHub bot**
(`/siliconsmith accelerate <function>` on an issue → a PR with the bundle), and a **run console** in the
browser, where every run gets a URL showing the search tree, proofs, waveforms and diffs live.

## How it works

```
profile ──► Ultra proposes k instructions ──► each candidate CPU = a sandbox branch from its parent's checkpoint
                                                 │
                     Super implements RTL + C reference + rewritten kernel; independently writes a golden spec
                                                 │
            verification ladder ──────────── fail ──► Nano triages ──► Super repairs (≤2) ──► or pruned, with reason
                                                 │ pass
                     beam keeps the best ──► polish: smaller hardware (re-proven), faster software ──► next round
```

* **Search.** A beam search over CPUs. A node is a CPU: its parent's instructions + one new instruction
  + the software rewritten to use it. Each round, Nemotron 3 Ultra reads the remaining hot spots and
  proposes new instructions. The winners are then **polished by the agent itself**: an area pass
  (same function, less hardware, formally re-proven) and a software pass (same hardware, faster code).
* **Sandboxes.** On Nebius Token Factory Sandboxes, each candidate runs in its own microVM **started from
  its parent's checkpoint image**, and its result image becomes the checkpoint its children branch from,
  so build caches and verified state flow down the tree. Up to 50 run in parallel.
* **Nemotron, routed by difficulty.**

  | Model | Role |
  |---|---|
  | Nemotron 3 Ultra | architect: reads profiles and disassembly, proposes instructions, diagnoses hard failures |
  | Nemotron 3 Super | engineer: RTL, C reference, kernel rewrite, the independent golden spec, repairs, polish |
  | Nemotron 3 Nano | triage: turns raw tool logs into a precise diagnosis for the repair loop |

  Every call is logged with tokens and cost; `REPORT.md` totals them per model.

## The verification ladder (and what each label means)

Nothing reaches the bundle without passing every rung. The UI and report use exactly these claims:

| Rung | Check | Tool |
|---|---|---|
| L1 Builds | the RTL is Verilator `-Wall` clean; the patched source only *calls* intrinsics | Verilator |
| L2 Matches the C reference | RTL == C reference on edge cases + 1,000,000 random vectors; the rewritten kernel == the original on thousands of random calls (host differential test) | Verilator, GCC |
| L3 Formally proven | RTL ≡ an **independently written** golden spec for **all 2^64 inputs** (SAT miter). The spec is itself validated against the C reference first. On a counterexample, the agent is told whether the RTL or the spec is wrong. | Yosys + SAT |
| L4 Bit-identical output | the whole program runs on the modified CPU and its output hash equals the original CPU's | Verilator (full SoC) |
| L5 Area | Gowin synthesis of the full core; must stay inside the area budget | Yosys `synth_gowin` |
| L6 On silicon | the same design on a Tang Nano 9K FPGA | nextpnr-himbaechel, openFPGALoader |

Speedups are clock cycles on the same core against a **strong baseline**: PicoRV32 rv32im with the fast
multiplier, hardware divide and barrel shifter.

## Results

| Workload (real open-source code) | Baseline | Best found | Speedup | Area | Nemotron cost |
|---|---|---|---|---|---|
| TinyMaix `tm_dot_prod` (int8 NN layer) | 860,730 cycles | `dot4` | **3.32×** | +4.8% LUT | $0.33 |
| Monocypher `chacha20_rounds` | 133,255 cycles | (pending) | | | |

*(Updated from the hero runs; each row links to its replay and report.)*

## Run it locally

Requirements: Linux or WSL2, Python ≥ 3.11, a Nebius Token Factory API key.

```bash
sudo bash scripts/setup-toolchain.sh        # Verilator, Yosys, SymbiYosys, nextpnr, RISC-V GCC (OSS CAD Suite)
pip install -e 'engine[sandboxes,server]'
cp .env.example .env.local                  # NEBIUS_API_KEY, NEBIUS_PROJECT_ID, model IDs
siliconsmith hello                          # boots PicoRV32 in simulation
siliconsmith golden                         # hand-built example through the whole ladder (no LLM)
siliconsmith accelerate w1 --backend local  # the agent, verifying locally
siliconsmith accelerate w1 --backend contree  # the agent, every candidate in a Token Factory Sandbox
```

## Related work, and what is new here

* **Commercial custom-instruction flows** (Andes ACE/COPILOT, Cadence Tensilica) generate the processor,
  compiler support and simulator **after a human architect decides** what the instruction is.
* **Research agents** (CHIA, LACE) use LLMs to implement a *described* instruction extension;
  **CIDRE** automates instruction selection without an LLM.
* **SiliconSmith** closes the loop: it decides which instruction to build from profiles, implements the
  hardware and the software, **proves** the hardware against an independent spec, accounts for area,
  improves its own designs, and searches many candidate CPUs in parallel sandbox branches.

A useful reference point: TinyMaix ships a hand-written kernel for T-Head's Xuantie E907 built on the
vendor instruction `smaqa` (4× int8 multiply-accumulate). SiliconSmith arrives at the same idea (a 4-lane
int8 dot product) on its own. Without the accumulate, it fits PicoRV32's two-operand co-processor port.

## Repository layout

```
engine/      the agent (search, ladder, backends, Nemotron client, CLI)    hw/       PicoRV32 SoC + slot + testbench
workloads/   real kernels from TinyMaix and Monocypher, with harnesses     firmware/ bare-metal runtime
sandbox/     the image every candidate is verified in                      fpga/     Tang Nano 9K flow
web/         the run console                                               docs/     plan, event contract
```

## Licenses

SiliconSmith is Apache-2.0. Vendored or adapted code keeps its license: PicoRV32 (ISC),
TinyMaix (Apache-2.0), Monocypher (BSD-2-Clause or CC0-1.0).
