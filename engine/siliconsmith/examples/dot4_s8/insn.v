// dot4.s8: rd = sum over 4 byte lanes of signed(rs1.b[i]) * signed(rs2.b[i])
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
endmodule
