// SiliconSmith core: PicoRV32 + the PCPI custom-instruction slot (ss_pcpi).
// This is the unit we synthesize for area/Fmax, so it excludes RAM and MMIO.
//
// Baseline configuration is deliberately strong, so any speedup we report is honest:
// rv32im with the fast (DSP-style) multiplier, hardware divide, barrel shifter,
// dual-port register file, 64-bit cycle counters.
`default_nettype none

module ss_core #(
	parameter [31:0] STACKADDR = 32'h0002_0000
) (
	input  wire        clk,
	input  wire        resetn,
	output wire        trap,

	output wire        mem_valid,
	output wire        mem_instr,
	input  wire        mem_ready,
	output wire [31:0] mem_addr,
	output wire [31:0] mem_wdata,
	output wire [ 3:0] mem_wstrb,
	input  wire [31:0] mem_rdata
);
	wire        pcpi_valid;
	wire [31:0] pcpi_insn, pcpi_rs1, pcpi_rs2;
	wire        pcpi_wr, pcpi_wait, pcpi_ready;
	wire [31:0] pcpi_rd;

	picorv32 #(
		.ENABLE_COUNTERS     (1),
		.ENABLE_COUNTERS64   (1),
		.ENABLE_REGS_DUALPORT(1),
		.BARREL_SHIFTER      (1),
		.COMPRESSED_ISA      (0),
		.CATCH_MISALIGN      (1),
		.CATCH_ILLINSN       (1),
		.ENABLE_PCPI         (1),
		.ENABLE_MUL          (0),
		.ENABLE_FAST_MUL     (1),
		.ENABLE_DIV          (1),
		.PROGADDR_RESET      (32'h0000_0000),
		.STACKADDR           (STACKADDR)
	) cpu (
		.clk(clk), .resetn(resetn), .trap(trap),
		.mem_valid(mem_valid), .mem_instr(mem_instr), .mem_ready(mem_ready),
		.mem_addr(mem_addr), .mem_wdata(mem_wdata), .mem_wstrb(mem_wstrb), .mem_rdata(mem_rdata),
		.mem_la_read(), .mem_la_write(), .mem_la_addr(), .mem_la_wdata(), .mem_la_wstrb(),
		.pcpi_valid(pcpi_valid), .pcpi_insn(pcpi_insn), .pcpi_rs1(pcpi_rs1), .pcpi_rs2(pcpi_rs2),
		.pcpi_wr(pcpi_wr), .pcpi_rd(pcpi_rd), .pcpi_wait(pcpi_wait), .pcpi_ready(pcpi_ready),
		.irq(32'b0), .eoi(),
		.trace_valid(), .trace_data()
	);

	ss_pcpi custom (
		.clk(clk), .resetn(resetn),
		.pcpi_valid(pcpi_valid), .pcpi_insn(pcpi_insn), .pcpi_rs1(pcpi_rs1), .pcpi_rs2(pcpi_rs2),
		.pcpi_wr(pcpi_wr), .pcpi_rd(pcpi_rd), .pcpi_wait(pcpi_wait), .pcpi_ready(pcpi_ready)
	);
endmodule

`default_nettype wire
