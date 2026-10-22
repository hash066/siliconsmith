module ss_insn_chacha_xor_rotl12 (
    input  wire [31:0] rs1,
    input  wire [31:0] rs2,
    output wire [31:0] rd
);
    wire [31:0] xored = rs1 ^ rs2;
    assign rd = {xored[19:0], xored[31:20]};
endmodule
