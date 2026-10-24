module ss_insn_dot4 (
    input  wire [31:0] rs1,
    input  wire [31:0] rs2,
    output wire [31:0] rd
);
    wire signed [7:0] a0 = rs1[ 7: 0];
    wire signed [7:0] a1 = rs1[15: 8];
    wire signed [7:0] a2 = rs1[23:16];
    wire signed [7:0] a3 = rs1[31:24];
    wire signed [7:0] b0 = rs2[ 7: 0];
    wire signed [7:0] b1 = rs2[15: 8];
    wire signed [7:0] b2 = rs2[23:16];
    wire signed [7:0] b3 = rs2[31:24];
    wire signed [15:0] p0 = $signed(a0) * $signed(b0);
    wire signed [15:0] p1 = $signed(a1) * $signed(b1);
    wire signed [15:0] p2 = $signed(a2) * $signed(b2);
    wire signed [15:0] p3 = $signed(a3) * $signed(b3);
    wire signed [16:0] s01 = $signed(p0) + $signed(p1);
    wire signed [16:0] s23 = $signed(p2) + $signed(p3);
    wire signed [17:0] sum = $signed(s01) + $signed(s23);
    assign rd = sum;
endmodule