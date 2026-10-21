// Instruction library for the mock replay (r_mock_demo).
// dot4.s8's RTL, C reference, intrinsic and kernel patch are copied from the real hand-built
// golden path (runs/golden/dot4_s8). Everything else is invented but written to be plausible:
// PCPI units with rs1/rs2 in and rd out, Gowin-style area, honest failure modes.

import type { Proposal } from "../lib/events.ts";

export interface InstructionSpec {
  mnemonic: string;
  title: string;
  operands: Proposal["operands"];
  rationale: string;
  est_speedup: number;
  est_area_pct: number;
  /** C reference body (inside `static inline uint32_t ss_ref_<sym>(uint32_t rs1, uint32_t rs2) { ... }`). */
  cBody: string;
  /** RTL per attempt; the last entry is used for any later attempt. */
  rtl: string[];
  /** Extra intrinsic text (e.g. a read/clear helper for stateful units). */
  intrinsicExtra?: string;
  stateful?: boolean;
}

export const sym = (mnemonic: string) => mnemonic.replace(/\./g, "_");

export function semanticsC(spec: InstructionSpec): string {
  return `static inline uint32_t ss_ref_${sym(spec.mnemonic)}(uint32_t rs1, uint32_t rs2) {\n${spec.cBody}\n}`;
}

const DOT4_FIXED = `// dot4.s8: rd = sum over 4 byte lanes of signed(rs1.b[i]) * signed(rs2.b[i])
module ss_insn_dot4_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [15:0] p0 = $signed(rs1[ 7: 0]) * $signed(rs2[ 7: 0]);
	wire signed [15:0] p1 = $signed(rs1[15: 8]) * $signed(rs2[15: 8]);
	wire signed [15:0] p2 = $signed(rs1[23:16]) * $signed(rs2[23:16]);
	wire signed [15:0] p3 = $signed(rs1[31:24]) * $signed(rs2[31:24]);
	wire signed [17:0] s01 = p0 + p1;
	wire signed [17:0] s23 = p2 + p3;
	wire signed [18:0] s   = s01 + s23;
	assign rd = {{13{s[18]}}, s};
endmodule`;

// First attempt: the adder tree is one bit too narrow. 4 x (-128 * -128) = 65536 overflows a
// 17-bit signed sum. Exactly one input pair triggers it, so 1M random vectors pass; SAT does not.
const DOT4_BUGGY = `// dot4.s8: rd = sum over 4 byte lanes of signed(rs1.b[i]) * signed(rs2.b[i])
module ss_insn_dot4_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [15:0] p0 = $signed(rs1[ 7: 0]) * $signed(rs2[ 7: 0]);
	wire signed [15:0] p1 = $signed(rs1[15: 8]) * $signed(rs2[15: 8]);
	wire signed [15:0] p2 = $signed(rs1[23:16]) * $signed(rs2[23:16]);
	wire signed [15:0] p3 = $signed(rs1[31:24]) * $signed(rs2[31:24]);
	wire signed [16:0] s01 = p0 + p1;
	wire signed [16:0] s23 = p2 + p3;
	wire signed [16:0] s   = s01 + s23;
	assign rd = {{15{s[16]}}, s};
endmodule`;

const DOT4_C = `\tint32_t acc = 0;
\tfor (int i = 0; i < 4; i++)
\t\tacc += (int32_t)(int8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
\treturn (uint32_t)acc;`;

const DACC_INTRINSIC = (name: string) => `/* ${name}: funct3=1 returns the accumulator and clears it */
#ifdef __riscv
static inline uint32_t ss_${sym(name)}_rd(void) {
	uint32_t rd;
	__asm__ volatile(".insn r 0x0B, 1, FUNCT7, %0, x0, x0" : "=r"(rd));
	return rd;
}
#endif`;

function daccRtl(name: string, accBits: number, note: string): string {
  const top = accBits - 1;
  return `// ${name}: acc += dot4(rs1, rs2) (funct3=0); rd = acc, acc = 0 (funct3=1)
// ${note}
module ss_insn_${sym(name)} (
	input  wire        clk,
	input  wire        resetn,
	input  wire        valid,
	input  wire [2:0]  funct3,
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [15:0] p0 = $signed(rs1[ 7: 0]) * $signed(rs2[ 7: 0]);
	wire signed [15:0] p1 = $signed(rs1[15: 8]) * $signed(rs2[15: 8]);
	wire signed [15:0] p2 = $signed(rs1[23:16]) * $signed(rs2[23:16]);
	wire signed [15:0] p3 = $signed(rs1[31:24]) * $signed(rs2[31:24]);
	wire signed [18:0] dot = (p0 + p1) + (p2 + p3);
	reg  signed [${top}:0] acc;
	wire signed [${top}:0] acc_next = acc + dot;
	always @(posedge clk) begin
		if (!resetn)
			acc <= 0;
		else if (valid)
			acc <= (funct3 == 3'd1) ? 0 : acc_next;
	end
	assign rd = (funct3 == 3'd1) ? {{${32 - accBits}{acc[${top}]}}, acc} : {{${32 - accBits}{acc_next[${top}]}}, acc_next};
endmodule`;
}

export const INSTRUCTIONS: Record<string, InstructionSpec> = {
  "dot4.s8": {
    mnemonic: "dot4.s8",
    title: "Packed int8 dot product",
    operands: { rs1: "4×int8", rs2: "4×int8", rd: "int32" },
    rationale:
      "tm_dot_prod is 95.7% of the measured region. Every four MACs cost eight byte loads, four multiplies and four adds; packing four int8 lanes per register turns those 16 instructions into two word loads, one dot4.s8 and one add.",
    est_speedup: 3.4,
    est_area_pct: 3.0,
    cBody: DOT4_C,
    rtl: [DOT4_BUGGY, DOT4_FIXED],
  },
  "dot2.s8": {
    mnemonic: "dot2.s8",
    title: "Dual-lane int8 dot product",
    operands: { rs1: "2×int8 (low half)", rs2: "2×int8 (low half)", rd: "int32" },
    rationale:
      "Half the multipliers of a four-lane dot for a bit more than half the gain. A cheap point on the area curve in case the four-lane tree does not fit the budget.",
    est_speedup: 2.0,
    est_area_pct: 1.4,
    cBody: `\tint32_t acc = 0;
\tfor (int i = 0; i < 2; i++)
\t\tacc += (int32_t)(int8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      `// dot2.s8: rd = signed(rs1.b0)*signed(rs2.b0) + signed(rs1.b1)*signed(rs2.b1)
module ss_insn_dot2_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [15:0] p0 = $signed(rs1[ 7:0]) * $signed(rs2[ 7:0]);
	wire signed [15:0] p1 = $signed(rs1[15:8]) * $signed(rs2[15:8]);
	wire signed [16:0] s  = p0 + p1;
	assign rd = {{15{s[16]}}, s};
endmodule`,
    ],
  },
  "mul2.s8": {
    mnemonic: "mul2.s8",
    title: "Dual int8 multiply into packed int16",
    operands: { rs1: "2×int8 (low half)", rs2: "2×int8 (low half)", rd: "2×int16" },
    rationale:
      "Two products per instruction with no adder tree, so it stays off the critical path. The kernel still adds the two halves in software.",
    est_speedup: 1.6,
    est_area_pct: 2.2,
    cBody: `\tint16_t p0 = (int16_t)((int8_t)rs1 * (int8_t)rs2);
\tint16_t p1 = (int16_t)((int8_t)(rs1 >> 8) * (int8_t)(rs2 >> 8));
\treturn ((uint32_t)(uint16_t)p1 << 16) | (uint16_t)p0;`,
    rtl: [
      `// mul2.s8: rd = {int16(rs1.b1*rs2.b1), int16(rs1.b0*rs2.b0)}
module ss_insn_mul2_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [15:0] p0 = $signed(rs1[ 7:0]) * $signed(rs2[ 7:0]);
	wire signed [15:0] p1 = $signed(rs1[15:8]) * $signed(rs2[15:8]);
	assign rd = {p1, p0};
endmodule`,
    ],
  },
  "dot4p.s8": {
    mnemonic: "dot4p.s8",
    title: "Pipelined packed int8 dot (2 cycles)",
    operands: { rs1: "4×int8", rs2: "4×int8", rd: "int32" },
    rationale:
      "Same semantics as a single-cycle four-lane dot, with a register between the multipliers and the adder tree. A hedge in case the combinational tree lands on the critical path and costs Fmax.",
    est_speedup: 3.2,
    est_area_pct: 3.4,
    cBody: DOT4_C,
    rtl: [
      `// dot4p.s8: dot4.s8 semantics, products registered (2-cycle latency)
module ss_insn_dot4p_s8 (
	input  wire        clk,
	input  wire        valid,
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output reg         ready,
	output wire [31:0] rd
);
	reg signed [15:0] p0, p1, p2, p3;
	always @(posedge clk) begin
		p0 <= $signed(rs1[ 7: 0]) * $signed(rs2[ 7: 0]);
		p1 <= $signed(rs1[15: 8]) * $signed(rs2[15: 8]);
		p2 <= $signed(rs1[23:16]) * $signed(rs2[23:16]);
		p3 <= $signed(rs1[31:24]) * $signed(rs2[31:24]);
		ready <= valid;
	end
	wire signed [18:0] s = (p0 + p1) + (p2 + p3);
	assign rd = {{13{s[18]}}, s};
endmodule`,
    ],
  },
  "dot4.u8s8": {
    mnemonic: "dot4.u8s8",
    title: "Mixed-sign dot product (u8 × s8)",
    operands: { rs1: "4×uint8", rs2: "4×int8", rd: "int32" },
    rationale:
      "If activations are post-ReLU they are non-negative; an unsigned activation lane drops the sign extension and matches common int8 inference ISAs.",
    est_speedup: 3.5,
    est_area_pct: 2.9,
    cBody: `\tint32_t acc = 0;
\tfor (int i = 0; i < 4; i++)
\t\tacc += (int32_t)(uint8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      `// dot4.u8s8: rd = sum over 4 lanes of unsigned(rs1.b[i]) * signed(rs2.b[i])
module ss_insn_dot4_u8s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [16:0] p0 = $signed({1'b0, rs1[ 7: 0]}) * $signed(rs2[ 7: 0]);
	wire signed [16:0] p1 = $signed({1'b0, rs1[15: 8]}) * $signed(rs2[15: 8]);
	wire signed [16:0] p2 = $signed({1'b0, rs1[23:16]}) * $signed(rs2[23:16]);
	wire signed [16:0] p3 = $signed({1'b0, rs1[31:24]}) * $signed(rs2[31:24]);
	wire signed [18:0] s  = (p0 + p1) + (p2 + p3);
	assign rd = {{13{s[18]}}, s};
endmodule`,
    ],
  },
  "dacc.s8": {
    mnemonic: "dacc.s8",
    title: "Accumulating dot4 (internal accumulator)",
    operands: { rs1: "4×int8", rs2: "4×int8", rd: "int32 running sum" },
    rationale:
      "After packing, one add per dot remains in the loop and every dot depends on the sum register. Keeping the running sum inside the unit removes both.",
    est_speedup: 4.6,
    est_area_pct: 4.9,
    cBody: `\t/* stateful: acc += dot4(rs1, rs2); funct3=1 reads and clears (see ss_dacc_s8_rd) */
\tstatic int32_t acc;
\tfor (int i = 0; i < 4; i++)
\t\tacc += (int32_t)(int8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      daccRtl("dacc.s8", 32, "first attempt: the read path forgets to clear (funct3 compare uses the stale bit)").replace(
        "acc <= (funct3 == 3'd1) ? 0 : acc_next;",
        "acc <= acc_next;",
      ),
      daccRtl("dacc.s8", 32, "32-bit accumulator"),
    ],
    intrinsicExtra: DACC_INTRINSIC("dacc.s8"),
    stateful: true,
  },
  "daccn.s8": {
    mnemonic: "daccn.s8",
    title: "Accumulating dot4, narrow accumulator",
    operands: { rs1: "4×int8", rs2: "4×int8", rd: "int32 running sum" },
    rationale:
      "A 512-element int8 dot stays within 24 bits, so a narrow accumulator should do and saves about half a percent of area against the 32-bit design.",
    est_speedup: 4.6,
    est_area_pct: 4.6,
    cBody: `\tstatic int32_t acc;
\tfor (int i = 0; i < 4; i++)
\t\tacc += (int32_t)(int8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      daccRtl("daccn.s8", 24, "24-bit accumulator"),
      daccRtl("daccn.s8", 25, "25-bit accumulator: 512 x 16384 = 2^23 needs 25 signed bits"),
    ],
    intrinsicExtra: DACC_INTRINSIC("daccn.s8"),
    stateful: true,
  },
  "daccs.s8": {
    mnemonic: "daccs.s8",
    title: "Accumulating dot4, carry-save partials",
    operands: { rs1: "4×int8", rs2: "4×int8", rd: "int32 running sum" },
    rationale:
      "Keeps the accumulator in carry-save form so the carry chain leaves the critical path, and reuses dot4.s8's multiplier tree to stay inside the budget.",
    est_speedup: 4.5,
    est_area_pct: 4.9,
    cBody: `\tstatic int32_t acc;
\tfor (int i = 0; i < 4; i++)
\t\tacc += (int32_t)(int8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      `// daccs.s8: accumulator held as (sum, carry); resolved on read (funct3=1)
module ss_insn_daccs_s8 (
	input  wire        clk,
	input  wire        resetn,
	input  wire        valid,
	input  wire [2:0]  funct3,
	input  wire [18:0] dot,        // shared with ss_insn_dot4_s8
	output wire [31:0] rd
);
	reg  [31:0] cs_s, cs_c;
	wire [31:0] d = {{13{dot[18]}}, dot};
	wire [31:0] s_next = cs_s ^ cs_c ^ d;
	wire [31:0] c_next = ((cs_s & cs_c) | (cs_s & d) | (cs_c & d)) << 1;
	always @(posedge clk) begin
		if (!resetn || (valid && funct3 == 3'd1)) begin
			cs_s <= 0; cs_c <= 0;
		end else if (valid) begin
			cs_s <= s_next; cs_c <= c_next;
		end
	end
	assign rd = cs_s + cs_c;
endmodule`,
    ],
    intrinsicExtra: DACC_INTRINSIC("daccs.s8"),
    stateful: true,
  },
  "dacc2.s8": {
    mnemonic: "dacc2.s8",
    title: "Accumulating dual-lane dot",
    operands: { rs1: "2×int8 (low half)", rs2: "2×int8 (low half)", rd: "int32 running sum" },
    rationale: "dot2.s8 with the running sum kept inside the unit: the cheapest accumulator that could fit beside it.",
    est_speedup: 2.5,
    est_area_pct: 3.4,
    cBody: `\tstatic int32_t acc;
\tfor (int i = 0; i < 2; i++)
\t\tacc += (int32_t)(int8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      `// dacc2.s8: acc += dot2(rs1, rs2) (funct3=0); rd = acc, acc = 0 (funct3=1)
module ss_insn_dacc2_s8 (
	input  wire        clk,
	input  wire        resetn,
	input  wire        valid,
	input  wire [2:0]  funct3,
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [15:0] p0 = $signed(rs1[ 7:0]) * $signed(rs2[ 7:0]);
	wire signed [15:0] p1 = $signed(rs1[15:8]) * $signed(rs2[15:8]);
	reg  signed [31:0] acc;
	wire signed [31:0] acc_next = acc + (p0 + p1);
	always @(posedge clk) begin
		if (!resetn)
			acc <= 0;
		else if (valid)
			acc <= (funct3 == 3'd1) ? 0 : acc_next;
	end
	assign rd = (funct3 == 3'd1) ? acc : acc_next;
endmodule`,
    ],
    intrinsicExtra: DACC_INTRINSIC("dacc2.s8"),
    stateful: true,
  },
  "sum4.s8": {
    mnemonic: "sum4.s8",
    title: "Horizontal int8 lane sum",
    operands: { rs1: "4×int8", rs2: "unused", rd: "int32" },
    rationale:
      "Sums four signed bytes in one step. TinyMaix pairs int8 dots with an input-sum term for asymmetric zero points; a lane sum removes three adds per word there.",
    est_speedup: 1.1,
    est_area_pct: 0.6,
    cBody: `\t(void)rs2;
\tint32_t acc = 0;
\tfor (int i = 0; i < 4; i++)
\t\tacc += (int32_t)(int8_t)(rs1 >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      `// sum4.s8: rd = sum of the four signed bytes of rs1
module ss_insn_sum4_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire [9:0] s;
	assign s  = rs1[7:0] + rs1[15:8] + rs1[23:16] + rs1[31:24];
	assign rd = {{22{s[9]}}, s};
endmodule`,
      `// sum4.s8: rd = sum of the four signed bytes of rs1
module ss_insn_sum4_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [9:0] s = $signed({{2{rs1[ 7]}}, rs1[ 7: 0]}) + $signed({{2{rs1[15]}}, rs1[15: 8]})
	                    + $signed({{2{rs1[23]}}, rs1[23:16]}) + $signed({{2{rs1[31]}}, rs1[31:24]});
	assign rd = {{22{s[9]}}, s};
	wire unused = &{1'b0, rs2};
endmodule`,
    ],
  },
  "dot2.s16": {
    mnemonic: "dot2.s16",
    title: "Packed int16 dot product",
    operands: { rs1: "2×int16", rs2: "2×int16", rd: "int32" },
    rationale:
      "A reusable 16-bit dot for int16 layers. On int8 data the kernel must sign-extend bytes into halfwords first, so the gain here is modest.",
    est_speedup: 1.5,
    est_area_pct: 2.9,
    cBody: `\tint32_t acc = (int32_t)(int16_t)rs1 * (int16_t)rs2;
\tacc += (int32_t)(int16_t)(rs1 >> 16) * (int16_t)(rs2 >> 16);
\treturn (uint32_t)acc;`,
    rtl: [
      `// dot2.s16: rd = rs1.h0*rs2.h0 + rs1.h1*rs2.h1 (signed)
module ss_insn_dot2_s16 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire signed [31:0] p0 = $signed(rs1[15: 0]) * $signed(rs2[15: 0]);
	wire signed [31:0] p1 = $signed(rs1[31:16]) * $signed(rs2[31:16]);
	assign rd = p0 + p1;
endmodule`,
    ],
  },
  "ldot4.s8": {
    mnemonic: "ldot4.s8",
    title: "dot4 with post-increment loads",
    operands: { rs1: "pointer (activations)", rs2: "pointer (weights)", rd: "int32" },
    rationale:
      "Loads dominate what is left of the loop. Fusing both word loads and the pointer bumps into the dot would remove three instructions per dot4.",
    est_speedup: 4.9,
    est_area_pct: 2.1,
    cBody: `\tconst uint32_t a = *(const uint32_t*)rs1, b = *(const uint32_t*)rs2;
\tint32_t acc = 0;
\tfor (int i = 0; i < 4; i++)
\t\tacc += (int32_t)(int8_t)(a >> (8 * i)) * (int32_t)(int8_t)(b >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      `// ldot4.s8: rd = dot4(mem[rs1], mem[rs2])
module ss_insn_ldot4_s8 (
	input  wire        clk,
	input  wire        valid,
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output reg  [31:0] rd
);
	always @(posedge clk)
		if (valid) rd <= dot4(pcpi_mem_rdata, pcpi_mem_rdata2);
endmodule`,
      `// ldot4.s8: rd = dot4(mem[rs1], mem[rs2]) — adds a memory port to the PCPI slot
module ss_insn_ldot4_s8 (
	input  wire        clk,
	input  wire        valid,
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] pcpi_mem_addr,
	input  wire [31:0] pcpi_mem_rdata,
	output reg  [31:0] rd
);
	assign pcpi_mem_addr = rs1;
endmodule`,
    ],
  },
  "tail4.s8": {
    mnemonic: "tail4.s8",
    title: "Masked tail dot (1–3 lanes)",
    operands: { rs1: "1–3×int8", rs2: "1–3×int8", rd: "int32" },
    rationale:
      "Handles sizes not divisible by four without the scalar tail loop. No gain at size 512, but it keeps the patched kernel general for other layer shapes.",
    est_speedup: 1.0,
    est_area_pct: 0.6,
    cBody: `\t/* funct3 = number of live lanes (1..3) */
\tint32_t acc = 0;
\tfor (int i = 0; i < 3; i++)
\t\tacc += (int32_t)(int8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
\treturn (uint32_t)acc;`,
    rtl: [
      `// tail4.s8: dot over the low funct3 lanes (1..3); shares dot4.s8's multipliers
module ss_insn_tail4_s8 (
	input  wire [2:0]  funct3,
	input  wire [15:0] p0, p1, p2,     // products from ss_insn_dot4_s8
	output wire [31:0] rd
);
	wire signed [17:0] s = $signed(p0)
	                     + (funct3 > 3'd1 ? $signed(p1) : 18'sd0)
	                     + (funct3 > 3'd2 ? $signed(p2) : 18'sd0);
	assign rd = {{14{s[17]}}, s};
endmodule`,
    ],
  },
  "tail2.s8": {
    mnemonic: "tail2.s8",
    title: "Masked tail dot (1–2 lanes)",
    operands: { rs1: "1–2×int8", rs2: "1–2×int8", rd: "int32" },
    rationale: "A two-lane tail helper that fits beside dot2.s8 and dot4.s8 with almost no area.",
    est_speedup: 1.0,
    est_area_pct: 0.4,
    cBody: `\tint32_t acc = (int32_t)(int8_t)rs1 * (int8_t)rs2;
\tacc += (int32_t)(int8_t)(rs1 >> 8) * (int8_t)(rs2 >> 8);
\treturn (uint32_t)acc;`,
    rtl: [
      `// tail2.s8: rd = dot over 1..2 low lanes (funct3 = lanes)
module ss_insn_tail2_s8 (
	input  wire [2:0]  funct3,
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output reg  [31:0] rd
);
	reg [1:0] lane;
	always @* begin
		case (funct3)
			3'd1: lane = 2'd1;
			3'd2: lane = 2'd2;
		endcase
		rd = $signed(rs1[7:0]) * $signed(rs2[7:0])
		   + (lane == 2'd2 ? $signed(rs1[15:8]) * $signed(rs2[15:8]) : 0);
	end
endmodule`,
      `// tail2.s8: rd = dot over 1..2 low lanes (funct3 = lanes)
module ss_insn_tail2_s8 (
	input  wire [2:0]  funct3,
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	wire two = (funct3 == 3'd2);
	wire signed [15:0] p0 = $signed(rs1[ 7:0]) * $signed(rs2[ 7:0]);
	wire signed [15:0] p1 = two ? $signed(rs1[15:8]) * $signed(rs2[15:8]) : 16'sd0;
	wire signed [16:0] s  = p0 + p1;
	assign rd = {{15{s[16]}}, s};
endmodule`,
    ],
  },
  "pk2.s8": {
    mnemonic: "pk2.s8",
    title: "Pack two int8 into int16 lanes",
    operands: { rs1: "int8 (low byte)", rs2: "int8 (low byte)", rd: "2×int16" },
    rationale: "Builds sign-extended int16 lane pairs from byte data in one step, for int16-lane helpers stacked on this CPU.",
    est_speedup: 1.0,
    est_area_pct: 0.3,
    cBody: `\treturn ((uint32_t)(uint16_t)(int16_t)(int8_t)rs2 << 16) | (uint16_t)(int16_t)(int8_t)rs1;`,
    rtl: [
      `// pk2.s8: rd = {sext16(rs2.b0), sext16(rs1.b0)}
module ss_insn_pk2_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	assign rd = {{8{rs1[7]}}, rs1[7:0], {8{rs2[7]}}, rs2[7:0]};
endmodule`,
      `// pk2.s8: rd = {sext16(rs2.b0), sext16(rs1.b0)}
module ss_insn_pk2_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output wire [31:0] rd
);
	assign rd = {{8{rs2[7]}}, rs2[7:0], {8{rs1[7]}}, rs1[7:0]};
endmodule`,
    ],
  },
};

export function proposalFor(mnemonic: string): Proposal {
  const s = INSTRUCTIONS[mnemonic];
  if (!s) throw new Error(`unknown instruction ${mnemonic}`);
  return {
    mnemonic: s.mnemonic,
    title: s.title,
    semantics_c: semanticsC(s),
    operands: s.operands,
    rationale: s.rationale,
    est_speedup: s.est_speedup,
    est_area_pct: s.est_area_pct,
  };
}

export function rtlFor(mnemonic: string, attempt: number): string {
  const r = INSTRUCTIONS[mnemonic].rtl;
  return r[Math.min(attempt, r.length - 1)];
}

/** Intrinsics header for a CPU's cumulative instruction set, in the style of hwgen.py. */
export function intrinsicsFor(set: string[]): string {
  const parts = [`/* AUTO-GENERATED by SiliconSmith (hwgen.py). Do not edit by hand. */`, `#pragma once`, `#include <stdint.h>`];
  set.forEach((m, funct7) => {
    const s = INSTRUCTIONS[m];
    const n = sym(m);
    parts.push(
      `
/* ${m}: ${s.title} (custom-0, funct7=${funct7}) */
static inline uint32_t ss_ref_${n}(uint32_t rs1, uint32_t rs2) {
${s.cBody}
}
#ifdef __riscv
static inline uint32_t ss_${n}(uint32_t rs1, uint32_t rs2) {
	uint32_t rd;
	__asm__${s.stateful ? " volatile" : ""}(".insn r 0x0B, 0, ${funct7}, %0, %1, %2" : "=r"(rd) : "r"(rs1), "r"(rs2));
	return rd;
}
#else
#define ss_${n} ss_ref_${n}
#endif`,
    );
    if (s.intrinsicExtra) parts.push(s.intrinsicExtra.replace("FUNCT7", String(funct7)));
  });
  return parts.join("\n") + "\n";
}

const HEADER_DIFF = `--- a/tm_dot.h
+++ b/tm_dot.h
@@ -1,16 +1,6 @@
-/* tm_dot_prod: verbatim from TinyMaix src/arch_cpu.h (TM_ARCH_CPU, INT8).
- * https://github.com/sipeed/TinyMaix  (commit 0532ece)
- *
- * Copyright 2022 Sipeed Technology Co., Ltd. All Rights Reserved.
- * Licensed under the Apache License, Version 2.0 (the "License");
- * you may not use this file except in compliance with the License.
- * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
- * Unless required by applicable law or agreed to in writing, software distributed under
- * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
- * ANY KIND, either express or implied.
- *
- * SiliconSmith: this is the ONLY file the agent may rewrite for this workload.
- * Contract: same signature, bit-identical *result for all inputs. Inputs are 4-byte aligned.
+/* tm_dot_prod rewritten for the SiliconSmith INSN custom instruction.
+ * Original: TinyMaix src/arch_cpu.h (Apache-2.0, Copyright 2022 Sipeed Technology Co., Ltd.)
+ * Same signature and bit-identical result; inputs are 4-byte aligned.
  */
 #pragma once
 #include <stdint.h>`;

const BODY_OLD = `-    sumtype_t sum=0;
     uint32_t i = 0;
-    uint32_t cnt = (size>>3)<<3;  //8
-    for(; i+8-1 <cnt; ){
-        sum += sptr[i]*kptr[i];i++;
-        sum += sptr[i]*kptr[i];i++;
-        sum += sptr[i]*kptr[i];i++;
-        sum += sptr[i]*kptr[i];i++;
-        sum += sptr[i]*kptr[i];i++;
-        sum += sptr[i]*kptr[i];i++;
-        sum += sptr[i]*kptr[i];i++;
-        sum += sptr[i]*kptr[i];i++;
-    }
-    for(; i <size; i++){
-        sum += sptr[i]*kptr[i];`;

function bodyDiff(insn: string, newLines: string): string {
  return `${HEADER_DIFF.replace("INSN", insn)}
@@ -20,25 +10,20 @@
 typedef int32_t sumtype_t;
 #define TM_INLINE __attribute__((always_inline)) static inline

-//sum = SUM(Ai*Bi)
 TM_INLINE void tm_dot_prod(mtype_t* sptr, mtype_t* kptr,uint32_t size, sumtype_t* result)
 {
${BODY_OLD}
${newLines}
     *result = sum;
-    return;
 }
`;
}

// Real golden-path patch (runs/golden/dot4_s8, candidate vs baseline tm_dot.h).
const DOT4_BODY = (fn: string) => `+    const uint32_t* s4 = (const uint32_t*)sptr;
+    const uint32_t* k4 = (const uint32_t*)kptr;
+    sumtype_t sum = 0;
+    uint32_t n4 = size >> 2;
+    uint32_t i = 0;
+    for (; i + 4 <= n4; i += 4) {          /* 16 MACs per iteration */
+        sum += (int32_t)${fn}(s4[i],   k4[i]);
+        sum += (int32_t)${fn}(s4[i+1], k4[i+1]);
+        sum += (int32_t)${fn}(s4[i+2], k4[i+2]);
+        sum += (int32_t)${fn}(s4[i+3], k4[i+3]);
     }
+    for (; i < n4; i++) sum += (int32_t)${fn}(s4[i], k4[i]);
+    for (i = n4 << 2; i < size; i++) sum += sptr[i] * kptr[i];`;

const DOT4_TAIL_BODY = `+    const uint32_t* s4 = (const uint32_t*)sptr;
+    const uint32_t* k4 = (const uint32_t*)kptr;
+    sumtype_t sum = 0;
+    uint32_t n4 = size >> 2;
+    uint32_t i = 0;
+    for (; i + 4 <= n4; i += 4) {          /* 16 MACs per iteration */
+        sum += (int32_t)ss_dot4_s8(s4[i],   k4[i]);
+        sum += (int32_t)ss_dot4_s8(s4[i+1], k4[i+1]);
+        sum += (int32_t)ss_dot4_s8(s4[i+2], k4[i+2]);
+        sum += (int32_t)ss_dot4_s8(s4[i+3], k4[i+3]);
     }
+    for (; i < n4; i++) sum += (int32_t)ss_dot4_s8(s4[i], k4[i]);
+    if (size & 3) sum += (int32_t)ss_tail4_s8(s4[n4], k4[n4]);   /* 1-3 lanes, funct3 = size & 3 */`;

const DACC_BODY = (fn: string) => `+    const uint32_t* s4 = (const uint32_t*)sptr;
+    const uint32_t* k4 = (const uint32_t*)kptr;
+    uint32_t n4 = size >> 2;
+    uint32_t i = 0;
+    (void)ss_${fn}_rd();                   /* clear the accumulator */
+    for (; i + 4 <= n4; i += 4) {          /* no add, no sum dependency */
+        ss_${fn}(s4[i],   k4[i]);
+        ss_${fn}(s4[i+1], k4[i+1]);
+        ss_${fn}(s4[i+2], k4[i+2]);
+        ss_${fn}(s4[i+3], k4[i+3]);
     }
+    for (; i < n4; i++) ss_${fn}(s4[i], k4[i]);
+    sumtype_t sum = (int32_t)ss_${fn}_rd();
+    for (i = n4 << 2; i < size; i++) sum += sptr[i] * kptr[i];`;

const DOT2_BODY = (fn: string, acc: boolean) => `+    const uint32_t* s4 = (const uint32_t*)sptr;
+    const uint32_t* k4 = (const uint32_t*)kptr;
+    sumtype_t sum = 0;
+    uint32_t n4 = size >> 2;
+    uint32_t i = 0;
+    for (; i < n4; i++) {                  /* two dual-lane dots per word */
+        ${acc ? "" : "sum += (int32_t)"}${fn}(s4[i],       k4[i]);
+        ${acc ? "" : "sum += (int32_t)"}${fn}(s4[i] >> 16, k4[i] >> 16);
     }
+${acc ? `    sum = (int32_t)${fn}_rd();\n+` : ""}    for (i = n4 << 2; i < size; i++) sum += sptr[i] * kptr[i];`;

const MUL2_BODY = `+    const uint32_t* s4 = (const uint32_t*)sptr;
+    const uint32_t* k4 = (const uint32_t*)kptr;
+    sumtype_t sum = 0;
+    uint32_t n4 = size >> 2;
+    uint32_t i = 0;
+    for (; i < n4; i++) {
+        uint32_t lo = ss_mul2_s8(s4[i], k4[i]);
+        uint32_t hi = ss_mul2_s8(s4[i] >> 16, k4[i] >> 16);
+        sum += (int16_t)lo + (int16_t)(lo >> 16) + (int16_t)hi + (int16_t)(hi >> 16);
     }
+    for (i = n4 << 2; i < size; i++) sum += sptr[i] * kptr[i];`;

const DOT2S16_BODY = `+    sumtype_t sum = 0;
+    uint32_t i = 0;
+    for (; i + 2 <= size; i += 2) {        /* unpack two bytes into int16 lanes */
+        uint32_t a = (uint16_t)(int16_t)sptr[i] | ((uint32_t)(uint16_t)(int16_t)sptr[i+1] << 16);
+        uint32_t b = (uint16_t)(int16_t)kptr[i] | ((uint32_t)(uint16_t)(int16_t)kptr[i+1] << 16);
+        sum += (int32_t)ss_dot2_s16(a, b);
     }
+    for (; i < size; i++) sum += sptr[i] * kptr[i];`;

const U8S8_BODY = (attempt: number) =>
  attempt === 0
    ? DOT4_BODY("ss_dot4_u8s8")
    : `+    const uint32_t* s4 = (const uint32_t*)sptr;
+    const uint32_t* k4 = (const uint32_t*)kptr;
+    sumtype_t sum = 0, wsum = 0;
+    uint32_t n4 = size >> 2;
+    uint32_t i = 0;
+    for (; i < n4; i++) {                  /* bias activations to u8: x + 128 */
+        sum  += (int32_t)ss_dot4_u8s8(s4[i] ^ 0x80808080u, k4[i]);
+        wsum += ${attempt === 1 ? "(int16_t)" : ""}((int8_t)k4[i] + (int8_t)(k4[i] >> 8) + (int8_t)(k4[i] >> 16) + (int8_t)(k4[i] >> 24));
     }
+    sum -= 128 * wsum;                     /* undo the bias */
+    for (i = n4 << 2; i < size; i++) sum += sptr[i] * kptr[i];`;

const NO_LOOP_CHANGE = (insn: string) => `--- a/tm_dot.h
+++ b/tm_dot.h
@@ -14,6 +14,8 @@
 #pragma once
 #include <stdint.h>
 #include "ss_intrinsics.h"
+/* ${insn} is available on this CPU; tm_dot_prod has no use for it at this layer shape,
+ * so the loop is left as the parent CPU's version. */

 typedef int8_t  mtype_t;
 typedef int32_t sumtype_t;
`;

/** The kernel patch for a CPU, chosen by the most capable instruction it carries. */
export function patchFor(set: string[], attempt: number): string {
  const has = (m: string) => set.includes(m);
  const daccFn = ["dacc.s8", "daccn.s8", "daccs.s8"].find(has);
  if (daccFn) return bodyDiff(daccFn, DACC_BODY(sym(daccFn)));
  if (has("dot4.s8") && has("tail4.s8")) return bodyDiff("dot4.s8", DOT4_TAIL_BODY);
  if (has("dot4.s8")) return bodyDiff("dot4.s8", DOT4_BODY("ss_dot4_s8"));
  if (has("dot4p.s8")) return bodyDiff("dot4p.s8", DOT4_BODY("ss_dot4p_s8"));
  if (has("ldot4.s8")) return bodyDiff("ldot4.s8", DOT4_BODY("ss_ldot4_s8"));
  if (has("dacc2.s8")) return bodyDiff("dacc2.s8", DOT2_BODY("ss_dacc2_s8", true));
  if (has("dot2.s8")) return bodyDiff("dot2.s8", DOT2_BODY("ss_dot2_s8", false));
  if (has("mul2.s8")) return bodyDiff("mul2.s8", MUL2_BODY);
  if (has("dot2.s16")) return bodyDiff("dot2.s16", DOT2S16_BODY);
  if (has("dot4.u8s8")) return bodyDiff("dot4.u8s8", U8S8_BODY(attempt));
  return NO_LOOP_CHANGE(set[set.length - 1]);
}
