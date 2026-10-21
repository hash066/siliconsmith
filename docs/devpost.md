# SiliconSmith: Devpost submission text

Track: Coding and Agentic Engineering. Repo: https://github.com/hash066/siliconsmith (public with Apache-2.0 at submission).

## Tagline

Coding agents change code to fit the chip. SiliconSmith changes the chip to fit the code.

## What it does

Point SiliconSmith at a hot C loop. A Nemotron agent profiles it on a RISC-V core, **invents a custom instruction**, writes the
Verilog and the software that uses it, **proves the hardware correct**, measures speedup, area and clock, and opens a pull
request that changes your hardware. Every candidate CPU is checked in its own Token Factory Sandbox, started from its
parent's checkpoint image.

Real results on real open-source kernels (PicoRV32 rv32im with a fast multiplier; Fmax from nextpnr for a Tang Nano 9K,
median of 3 seeds, about ±8% seed noise):

| Kernel | Cycles | Wall-clock | Area | Run |
|---|---|---|---|---|
| TinyMaix int8 fully-connected layer (on Token Factory Sandboxes) | 4.04× | 3.76× | +4.83% | `r_w1_contree3` |
| TinyMaix, local backend (area polish also shrank the hardware) | 4.04× | 3.86× | +3.16% | `r_w1_final` |
| Monocypher ChaCha20 | 1.30× | 1.22× | +3.04% | `r_w2_final3` |

The agent found, unprompted, the same idea as TinyMaix's hand-written T-Head kernel (a 4-lane int8 dot product), and its polish phase then
beat our hand-built reference software (3.77× cycles). A full search costs $0.20 to $0.56 of Nemotron.

## How we used Nemotron and Token Factory

* **Nemotron 3 Ultra** is the architect: it reads the profile and disassembly and proposes instructions with the cycle arithmetic.
* **Nemotron 3 Super** is the engineer: Verilog, C reference, intrinsic, kernel rewrite, an independently written golden spec, repairs
  from compiler logs, failing vectors and formal counterexamples, and the polish passes (smaller hardware, faster software).
* **Nemotron 3 Nano** triages failures.
* All calls go through the Token Factory OpenAI-compatible endpoint, are logged as events with model, tokens, cost and latency, and
  add up to the cost panel in the run console.
* **Token Factory Sandboxes**: the verification worker runs in sandboxes. A child candidate starts from its parent's checkpoint image
  and its result is the next checkpoint (we assert this from the event log: 15 of 15 children in the headline run). We build our
  toolchain image inside Sandboxes (171 s, no local Docker).

## What is verified, and what is not claimed

Labels are earned: lint-clean; matches the C reference on 1,000,000 random vectors; **formally proven equivalent to an independent spec
for all 2^64 inputs** (Yosys SAT miter); whole-program output bit-identical to the baseline; then area and Fmax.
Not claimed: the FPGA rung (no board yet, shown as skipped), silicon, a compiler backend (software uses `.insn`), or a third operand
(PicoRV32's co-processor port has two source registers, which caps the ChaCha20 result).
Run-to-run variance is real and published: W1 wall-clock across runs ranged 3.17× to 3.86×.

## Built during the submission period

Everything: the engine (search, verification ladder, polish, Fmax), the Sandboxes backend, the HTTP API, the GitHub PR generator and
Action template, and the run console (Next.js). The hardware core is PicoRV32 (ISC); workloads are TinyMaix (Apache-2.0) and
Monocypher (BSD-2-Clause / CC0).

## Try it

* Run console and replays: https://siliconsmith.vercel.app (replays of real runs; they work without any backend or credits).
* CLI: `siliconsmith accelerate w1` (see the README).
* A real pull request the tool opened: https://github.com/hash066/TinyMaix/pull/1

## Feedback

See `docs/feedback.md`: Sandboxes activation and API findings, Nemotron JSON and thinking-token behaviour, measured latency and cost.
