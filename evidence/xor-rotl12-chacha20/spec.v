module ss_spec_chacha_xor_rotl12 (
    input wire [31:0] rs1,
    input wire [31:0] rs2,
    output reg [31:0] rd
);
    always @* begin
        reg [31:0] x;
        x = rs1 ^ rs2;
        rd = (x << 12) | (x >> (32 - 12));
    end
endmodule