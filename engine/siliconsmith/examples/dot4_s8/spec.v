// Reference spec for dot4.s8, written naively from the C semantics (lane loop, full 32-bit math).
module ss_spec_dot4_s8 (
	input  wire [31:0] rs1,
	input  wire [31:0] rs2,
	output reg  [31:0] rd
);
	integer i;
	reg signed [31:0] a, b, acc;
	always @* begin
		acc = 32'sd0;
		for (i = 0; i < 4; i = i + 1) begin
			a = {{24{rs1[8*i+7]}}, rs1[8*i +: 8]};
			b = {{24{rs2[8*i+7]}}, rs2[8*i +: 8]};
			acc = acc + a * b;
		end
		rd = acc;
	end
endmodule
