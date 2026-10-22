module ss_spec_dot4 (
    input wire [31:0] rs1,
    input wire [31:0] rs2,
    output reg [31:0] rd
);
    integer i;
    reg [31:0] a0, a1, a2, a3;
    reg [31:0] b0, b1, b2, b3;
    reg [63:0] p0, p1, p2, p3;
    reg [63:0] sum;
    always @* begin
        // byte 0
        a0 = {{24{rs1[7]}}, rs1[7:0]};
        b0 = {{24{rs2[7]}}, rs2[7:0]};
        // byte 1
        a1 = {{24{rs1[15]}}, rs1[15:8]};
        b1 = {{24{rs2[15]}}, rs2[15:8]};
        // byte 2
        a2 = {{24{rs1[23]}}, rs1[23:16]};
        b2 = {{24{rs2[23]}}, rs2[23:16]};
        // byte 3
        a3 = {{24{rs1[31]}}, rs1[31:24]};
        b3 = {{24{rs2[31]}}, rs2[31:24]};
        // products
        p0 = a0 * b0;
        p1 = a1 * b1;
        p2 = a2 * b2;
        p3 = a3 * b3;
        // sum
        sum = p0 + p1 + p2 + p3;
        // lower 32 bits as result
        rd = sum[31:0];
    end
endmodule