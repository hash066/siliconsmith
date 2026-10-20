// SiliconSmith simulation SoC: ss_core + single-cycle RAM + MMIO.
//
// Memory map
//   0x0000_0000 .. MEM_BYTES-1   RAM (firmware preloaded via +firmware=<hex>)
//   0x1000_0000                  UART TX   (write: low byte is printed by the testbench)
//   0x1000_0004                  EXIT      (write: simulation ends with this code)
`default_nettype none

module ss_soc #(
	parameter integer MEM_WORDS = 32768   // 128 KiB
) (
	input  wire        clk,
	input  wire        resetn,
	output wire        trap,

	output reg         uart_valid,
	output reg  [ 7:0] uart_data,
	output reg         exit_valid,
	output reg  [31:0] exit_code,

	// instruction-fetch tap for the profiler
	output wire        ifetch_valid,
	output wire [31:0] ifetch_addr
);
	localparam [31:0] MEM_BYTES = MEM_WORDS * 4;

	wire        mem_valid, mem_instr;
	reg         mem_ready;
	wire [31:0] mem_addr, mem_wdata;
	wire [ 3:0] mem_wstrb;
	reg  [31:0] mem_rdata;

	ss_core #(.STACKADDR(MEM_BYTES)) core (
		.clk(clk), .resetn(resetn), .trap(trap),
		.mem_valid(mem_valid), .mem_instr(mem_instr), .mem_ready(mem_ready),
		.mem_addr(mem_addr), .mem_wdata(mem_wdata), .mem_wstrb(mem_wstrb), .mem_rdata(mem_rdata)
	);

	assign ifetch_valid = mem_valid && mem_instr && mem_ready;
	assign ifetch_addr  = mem_addr;

	reg [31:0] mem [0:MEM_WORDS-1];
	reg [8*256-1:0] firmware_file;
	initial begin
		if (!$value$plusargs("firmware=%s", firmware_file))
			firmware_file = "firmware.hex";
		$readmemh(firmware_file, mem);
	end

	always @(posedge clk) begin
		mem_ready  <= 1'b0;
		uart_valid <= 1'b0;
		exit_valid <= 1'b0;
		if (resetn && mem_valid && !mem_ready) begin
			mem_ready <= 1'b1;
			mem_rdata <= 32'h0000_0000;
			if (mem_addr < MEM_BYTES) begin
				mem_rdata <= mem[mem_addr[31:2]];
				if (mem_wstrb[0]) mem[mem_addr[31:2]][ 7: 0] <= mem_wdata[ 7: 0];
				if (mem_wstrb[1]) mem[mem_addr[31:2]][15: 8] <= mem_wdata[15: 8];
				if (mem_wstrb[2]) mem[mem_addr[31:2]][23:16] <= mem_wdata[23:16];
				if (mem_wstrb[3]) mem[mem_addr[31:2]][31:24] <= mem_wdata[31:24];
			end else if (mem_addr == 32'h1000_0000) begin
				if (|mem_wstrb) begin
					uart_valid <= 1'b1;
					uart_data  <= mem_wdata[7:0];
				end
			end else if (mem_addr == 32'h1000_0004) begin
				if (|mem_wstrb) begin
					exit_valid <= 1'b1;
					exit_code  <= mem_wdata;
				end
			end
		end
	end
endmodule

`default_nettype wire
