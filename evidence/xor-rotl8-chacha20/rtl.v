module ss_insn_chacha_xor_rotl8 (
  input wire [31:0] rs1,
  input wire [31:0] rs2,
  output wire [31:0] rd
);
  assign rd = {rs1[23:0] ^ rs2[23:0], rs1[31:24] ^ rs2[31:24]};
endmodule
