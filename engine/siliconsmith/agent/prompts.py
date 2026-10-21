"""Prompts for the Nemotron roles. The few-shot example is deliberately a DIFFERENT instruction
(sad4.u8, sum of absolute byte differences) so the agent must invent, not copy, its answers."""

from __future__ import annotations

ARCH_CONTEXT = """\
TARGET CPU: PicoRV32 (RV32IM, multi-cycle, no caches, single-cycle RAM).
Approximate cycles per instruction on this core: ALU/shift 3, branch 3 (taken 5),
load/store 5, MUL (fast multiplier) 5-6, custom PCPI instruction 5-7.
The baseline is the strongest stock configuration (fast multiplier, divider, barrel shifter).

CUSTOM-INSTRUCTION SLOT (hard constraints):
- R-type on the RISC-V custom-0 opcode: rd = f(rs1, rs2). Two 32-bit source registers in,
  one 32-bit result out. The old value of rd is NOT available (no in-place accumulate).
- Implemented as ONE purely combinational unit (result registered by the slot): no state,
  no memory access, no multi-cycle FSM, no side effects.
- Area is measured with Yosys synth_gowin (Gowin GW1N FPGA). Multipliers map to MULT9X9 DSP
  blocks (an 8x8 signed multiply costs one). Area budget counts LUTs + ALUs.
- Software calls it through a generated intrinsic: uint32_t ss_<name>(uint32_t rs1, uint32_t rs2).
- The patched C must give BIT-IDENTICAL results to the original for ALL inputs.
"""

ARCHITECT_SYSTEM = (
    "You are a senior CPU micro-architect who designs RISC-V instruction-set extensions for "
    "embedded and edge-AI cores. You reason quantitatively about cycles saved versus area spent, "
    "and you only propose instructions that fit the hardware constraints exactly.\n\n" + ARCH_CONTEXT
)

ARCHITECT_USER = """\
WORKLOAD: {workload_title}
{workload_summary}

BASELINE: {baseline_cycles} cycles in the measured region. Area budget: +{area_budget}% LUT-equivalent \
(baseline {baseline_luts} LUT+ALU).
{current_isa}
HOTSPOTS (share of executed instructions in the measured region):
{hotspots}

HOT DISASSEMBLY (executions per instruction, then address and instruction):
{disassembly}

THE CODE YOU MAY CHANGE ({patchable_name}):
```c
{patchable_src}
```
{avoid}
TASK: Propose {k} DISTINCT custom instructions that would most reduce total cycles of the measured \
region within the area budget. Cover genuinely different ideas (not variants of one idea). For each, \
give the exact semantics as the C body of `uint32_t f(uint32_t rs1, uint32_t rs2)` using fixed-width \
types (int8_t, uint8_t, int16_t, int32_t, uint32_t), explain the cycle math briefly, and how the \
software would use it. Rank by expected speedup.

Reply with ONLY a JSON object:
{{"hotspot_analysis": "2-4 sentences on where the cycles go and why",
  "proposals": [{{"name": "c_identifier", "mnemonic": "asm.mnemonic", "title": "short title",
                  "semantics_c": "C body", "rationale": "1-3 sentences with cycle math",
                  "how_software_uses_it": "1-2 sentences", "est_speedup": 1.0, "est_area_pct": 0.0}}]}}
"""

IMPLEMENTER_SYSTEM = (
    "You are an expert RTL and embedded-C engineer. You write synthesizable Verilog-2005 that "
    "lints clean under Verilator -Wall, and C that is bit-exact with its specification.\n\n" + ARCH_CONTEXT
)

FEW_SHOT = r"""\
EXAMPLE (a different instruction, for format only):
Proposal: sad4.u8 — sum of absolute differences of the 4 unsigned byte lanes of rs1 and rs2.
RTL:
module ss_insn_sad4_u8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire [7:0] d0 = (rs1[ 7: 0] > rs2[ 7: 0]) ? rs1[ 7: 0] - rs2[ 7: 0] : rs2[ 7: 0] - rs1[ 7: 0];
	wire [7:0] d1 = (rs1[15: 8] > rs2[15: 8]) ? rs1[15: 8] - rs2[15: 8] : rs2[15: 8] - rs1[15: 8];
	wire [7:0] d2 = (rs1[23:16] > rs2[23:16]) ? rs1[23:16] - rs2[23:16] : rs2[23:16] - rs1[23:16];
	wire [7:0] d3 = (rs1[31:24] > rs2[31:24]) ? rs1[31:24] - rs2[31:24] : rs2[31:24] - rs1[31:24];
	assign rd = {22'd0, {2'b00, d0} + {2'b00, d1} + {2'b00, d2} + {2'b00, d3}};
endmodule
c_ref:
uint32_t acc = 0;
for (int i = 0; i < 4; i++) {
	uint8_t a = (uint8_t)(rs1 >> (8 * i)), b = (uint8_t)(rs2 >> (8 * i));
	acc += (a > b) ? (uint32_t)(a - b) : (uint32_t)(b - a);
}
return acc;
Software use (inside a patched function): sum += ss_sad4_u8(((const uint32_t*)p)[i], ((const uint32_t*)q)[i]);
"""

RTL_RULES = """\
RTL RULES: module name exactly `ss_insn_{name}` with ports `input wire [31:0] rs1, input wire [31:0] rs2, \
output wire [31:0] rd` (you may use `output reg [31:0] rd` with always @*). Verilog-2005 only, purely \
combinational, every bit of rd defined, explicit widths, use $signed() for signed math, no initial blocks, \
no delays, no system tasks, no latches, no other modules.
C RULES: c_ref is the BODY of `uint32_t f(uint32_t rs1, uint32_t rs2)` (no signature), fixed-width types \
only, no undefined behaviour (no signed overflow, no out-of-range shifts). In the patched file include \
"ss_intrinsics.h" (already included in the original) and call `ss_{name}(a, b)`. Keep the exact function \
signatures and the bit-identical contract; handle tails and any size. Do not add other includes. \
`ss_{name}()` and every `ss_ref_*()` are GENERATED into ss_intrinsics.h: never define, declare or \
#define any name starting with `ss_` in the patched file.\
"""

IMPLEMENT_USER = """\
{few_shot}
NOW IMPLEMENT THIS PROPOSAL:
name: {name}    mnemonic: {mnemonic}    title: {title}
semantics (C body of uint32_t f(uint32_t rs1, uint32_t rs2)):
```c
{semantics_c}
```
rationale: {rationale}
software use: {how_software_uses_it}

Custom instructions already in this CPU (you may also call them): {existing}

{rtl_rules}

CURRENT CONTENT OF THE PATCHABLE FILE {patchable_name} (rewrite it to use the new instruction):
```c
{patchable_src}
```

Reply with ONLY a JSON object:
{{"rtl": "full Verilog module", "c_ref": "C body", "patched_files": {{"{patchable_name}": "full new file"}}, \
"notes": "1 sentence"}}
"""

SPEC_SYSTEM = (
    "You are a verification engineer. You write the most naive, obviously-correct Verilog reference "
    "model of a C function, never optimized, so it can serve as a golden model for formal equivalence."
)

SPEC_USER = """\
Write a Verilog-2005 module named exactly `ss_spec_{name}` with ports `input wire [31:0] rs1, \
input wire [31:0] rs2, output reg [31:0] rd`, purely combinational (always @*), that computes EXACTLY \
this C function for every input:

```c
uint32_t f(uint32_t rs1, uint32_t rs2) {{
{c_ref}
}}
```

Style: mirror the C line by line with integer loop variables and full 32-bit intermediate arithmetic \
(sign-extend explicitly where the C casts to signed types). No cleverness, no shared logic.

Reply with ONLY a JSON object: {{"spec_rtl": "full Verilog module"}}
"""

REPAIR_USER = """\
Your previous implementation FAILED at stage `{stage}`.

ERROR:
```
{error}
```
{diagnosis}
PREVIOUS RTL:
```verilog
{rtl}
```
PREVIOUS c_ref:
```c
{c_ref}
```
PREVIOUS {patchable_name}:
```c
{patched}
```

Fix the root cause. Keep the instruction's intent (name `{name}`). If the C reference itself was wrong, \
fix it too. {rtl_rules}

Reply with ONLY a JSON object:
{{"rtl": "full Verilog module", "c_ref": "C body", "patched_files": {{"{patchable_name}": "full new file"}}, \
"notes": "1 sentence: what was wrong"}}
"""

POLISH_AREA_USER = """\
This custom instruction is CORRECT and formally verified. Make its hardware SMALLER without changing \
what it computes for any input (it will be formally re-proven against the same specification).

Synthesis of the whole core with this unit: {luts} LUT+ALU, {dsps} DSP blocks, {ffs} flip-flops.

C reference (the exact function, must not change):
```c
{c_ref}
```
Current RTL:
```verilog
{rtl}
```
Typical wins: minimal bit widths at every adder (a sum of four 16-bit products needs 18 bits, not 32), \
a balanced adder tree, sign-extend only at the output, share logic between lanes, avoid redundant \
casts. Keep the exact module name and ports. {rtl_rules}

Reply with ONLY a JSON object: {{"rtl": "full Verilog module", "title": "5-8 words", "notes": "1 sentence"}}
"""

POLISH_SW_USER = """\
The CPU now has these custom instructions (call them through their intrinsics): {isa}. \
The hardware is final. Make the SOFTWARE that uses them faster on this in-order RISC-V core \
(PicoRV32, ~3-4 cycles per instruction, so every instruction in the loop counts).

Remaining hot spots (share of the measured region):
{hotspots}

Hot disassembly (per-PC fetch counts):
```
{disassembly}
```
Current {patchable_name}:
```c
{patchable_src}
```
Typical wins: unroll so each iteration issues 4+ intrinsic calls, walk word pointers instead of \
recomputing byte offsets, keep independent partial sums, hoist invariant work, cheap tail handling. \
Look at the disassembly: every instruction that is not a load or a custom instruction is overhead. \
Concretely: use `const uint32_t *pa, *pb` that are incremented ONCE per iteration (`pa += 4`) and \
loaded with constant offsets `pa[0]..pa[3]` (the compiler then emits `lw rd, 4*k(ptr)` with no address \
arithmetic), compute the loop end pointer once (`end = pa + n_words`) and compare pointers instead of \
counting an index, and avoid `i >> 2`, `i + 16 <= cnt` style per-iteration arithmetic. Unroll 4x or 8x. \
Output must stay bit-identical for every size, including sizes that are not multiples of 4 or 16, and \
pointers keep the alignment the original assumes. Keep exact function signatures; include only \
what the original includes; never define ss_* names.

Reply with ONLY a JSON object: {{"patched_files": {{"{patchable_name}": "full new file"}}, \
"title": "5-8 words", "notes": "1 sentence"}}
"""

TRIAGE_SYSTEM ="You summarize hardware/software build failures for an engineer dashboard. Be precise and brief."

TRIAGE_USER = """\
Stage `{stage}` failed for custom instruction {mnemonic}. Log tail:
```
{log}
```
Reply with ONLY a JSON object: {{"stage": "{stage}", "summary": "one sentence for the UI", \
"likely_cause": "short", "fix_hint": "short"}}
"""
