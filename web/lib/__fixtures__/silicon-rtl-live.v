module ss_insn_dot4 (
    input  wire [31:0] rs1,
    input  wire [31:0] rs2,
    output wire [31:0] rd
);
    wire signed [7:0] a0 = $signed(rs1[ 7: 0]);
    wire signed [7:0] a1 = $signed(rs1[15: 8]);
    wire signed [7:0] a2 = $signed(rs1[23:16]);
    wire signed [7:0] a3 = $signed(rs1[31:24]);
    wire signed [7:0] b0 = $signed(rs2[ 7: 0]);
    wire signed [7:0] b1 = $signed(rs2[15: 8]);
    wire signed [7:0] b2 = $signed(rs2[23:16]);
    wire signed [7:0] b3 = $signed(rs2[31:24]);
    wire signed [15:0] p0 = a0 * b0;
    wire signed [15:0] p1 = a1 * b1;
    wire signed [15:0] p2 = a2 * b2;
    wire signed [15:0] p3 = a3 * b3;
    wire signed [31:0] sum = p0 + p1 + p2 + p3;
    assign rd = sum;
endmodule
