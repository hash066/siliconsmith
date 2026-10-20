#include "runtime.h"

int main(void) {
	uint64_t t0 = ss_rdcycle64();
	ss_puts("hello from PicoRV32 (SiliconSmith)\n");
	uint64_t t1 = ss_rdcycle64();
	ss_report(t1 - t0, ss_fnv1a("hello", 5, SS_FNV_INIT));
	return 0;
}
