// SiliconSmith on the Sipeed Tang Nano 9K (Gowin GW1NR-9): ss_core + block-RAM + UART + LEDs.
// The same firmware as simulation runs here unchanged: a UART write simply stalls the CPU
// (mem_ready held low) until the transmitter can take the byte.
`default_nettype none

module ss_fpga_top #(
	parameter integer CLK_HZ    = 27_000_000,
	parameter integer BAUD      = 115_200,
	parameter integer MEM_WORDS = 12288          // 48 KiB of block RAM
) (
	input  wire       clk,        // 27 MHz crystal (pin 52)
	input  wire       btn_rst_n,  // S1, active low
	output wire       uart_tx,    // to the on-board USB-UART
	output wire [5:0] led_n       // active-low LEDs
);
	localparam [31:0] MEM_BYTES = MEM_WORDS * 4;

	// power-on reset
	reg [7:0] por = 8'd0;
	always @(posedge clk) if (!por[7]) por <= por + 8'd1;
	wire resetn = por[7] && btn_rst_n;

	wire        mem_valid, mem_instr;
	reg         mem_ready;
	wire [31:0] mem_addr, mem_wdata;
	wire [ 3:0] mem_wstrb;
	reg  [31:0] mem_rdata;
	wire        trap;

	ss_core #(.STACKADDR(MEM_BYTES)) core (
		.clk(clk), .resetn(resetn), .trap(trap),
		.mem_valid(mem_valid), .mem_instr(mem_instr), .mem_ready(mem_ready),
		.mem_addr(mem_addr), .mem_wdata(mem_wdata), .mem_wstrb(mem_wstrb), .mem_rdata(mem_rdata)
	);

	// ---------------------------------------------------------------- RAM (BSRAM)
	reg [31:0] mem [0:MEM_WORDS-1];
	initial $readmemh("firmware.hex", mem);
	wire ram_sel = mem_addr < MEM_BYTES;
	reg [31:0] ram_q;
	always @(posedge clk) begin
		if (mem_valid && ram_sel) begin
			ram_q <= mem[mem_addr[31:2]];
			if (mem_wstrb[0]) mem[mem_addr[31:2]][ 7: 0] <= mem_wdata[ 7: 0];
			if (mem_wstrb[1]) mem[mem_addr[31:2]][15: 8] <= mem_wdata[15: 8];
			if (mem_wstrb[2]) mem[mem_addr[31:2]][23:16] <= mem_wdata[23:16];
			if (mem_wstrb[3]) mem[mem_addr[31:2]][31:24] <= mem_wdata[31:24];
		end
	end

	// ---------------------------------------------------------------- UART TX (8N1)
	localparam integer DIV = CLK_HZ / BAUD;
	reg [15:0] tx_cnt = 0;
	reg [ 9:0] tx_shift = 10'h3FF;
	reg [ 3:0] tx_bits = 0;
	wire tx_busy = tx_bits != 0;
	assign uart_tx = tx_shift[0];
	reg tx_go;
	reg [7:0] tx_byte;
	always @(posedge clk) begin
		if (!resetn) begin
			tx_bits <= 0; tx_shift <= 10'h3FF; tx_cnt <= 0;
		end else if (tx_go && !tx_busy) begin
			tx_shift <= {1'b1, tx_byte, 1'b0};
			tx_bits <= 4'd10; tx_cnt <= 0;
		end else if (tx_busy) begin
			if (tx_cnt == DIV - 1) begin
				tx_cnt <= 0; tx_shift <= {1'b1, tx_shift[9:1]}; tx_bits <= tx_bits - 4'd1;
			end else tx_cnt <= tx_cnt + 16'd1;
		end
	end

	// ---------------------------------------------------------------- bus
	reg ram_pending;
	reg [5:0] leds = 6'b0;
	reg done = 1'b0;
	always @(posedge clk) begin
		mem_ready   <= 1'b0;
		tx_go       <= 1'b0;
		ram_pending <= 1'b0;
		if (!resetn) begin
			leds <= 6'b0; done <= 1'b0;
		end else if (mem_valid && !mem_ready) begin
			if (ram_sel) begin
				// one cycle for the BSRAM read, then answer
				if (ram_pending) begin mem_ready <= 1'b1; mem_rdata <= ram_q; end
				else ram_pending <= 1'b1;
			end else if (mem_addr == 32'h1000_0000) begin
				if (|mem_wstrb) begin
					if (!tx_busy && !tx_go) begin tx_byte <= mem_wdata[7:0]; tx_go <= 1'b1; mem_ready <= 1'b1; end
				end else begin mem_ready <= 1'b1; mem_rdata <= {31'd0, tx_busy}; end
			end else if (mem_addr == 32'h1000_0004) begin
				if (|mem_wstrb) begin done <= 1'b1; leds <= mem_wdata[5:0]; end
				mem_ready <= 1'b1;
			end else begin
				mem_ready <= 1'b1; mem_rdata <= 32'h0;  // REGION marker and unmapped: ignore
			end
		end
	end

	// LED0 = running, LED1 = finished, LED5 = trap
	assign led_n = ~{trap, 3'b000, done, !done};
endmodule

`default_nettype wire
