int32_t acc = 0;
for (int i = 0; i < 4; i++)
	acc += (int32_t)(int8_t)(rs1 >> (8 * i)) * (int32_t)(int8_t)(rs2 >> (8 * i));
return (uint32_t)acc;
