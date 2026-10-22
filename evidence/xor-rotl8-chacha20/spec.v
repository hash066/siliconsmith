module ss_spec_chacha_xor_rotl8 (
    input wire [31:0] rs1,
    input wire [31:0] rs2,
    output reg [31:0] rd
);
    reg [31:0] t;
    reg [31:0] t_shl8;
    reg [31:0] t_shr24;
    always @* begin
        integer j;
        for (j = 0; j < 0; j = j + 1) begin
            // empty loop
        end
        t = rs1 ^ rs2;
        t_shl8 = t << 8;
        t_shr24 = t >> 24;
        rd = t_shl8 | t_shr24;
    end
endmodule
