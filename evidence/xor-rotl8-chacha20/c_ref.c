uint32_t t = rs1 ^ rs2;
return (t << 8) | (t >> 24);
