/* Host-side differential test: patched tm_dot_prod vs the original, on random sizes and data.
 * Built with the host C compiler; custom instructions fall back to their C reference
 * (ss_intrinsics.h maps ss_x -> ss_ref_x off-target), so this checks the SOFTWARE rewrite only.
 * The RTL == C reference check is a separate rung.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define tm_dot_prod tm_dot_prod_orig
#include "orig/tm_dot.h"
#undef tm_dot_prod
#undef TM_INLINE
#include "tm_dot.h"

static uint32_t rng = 0xC0FFEE11u;
static uint32_t rnd(void) { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; }

int main(int argc, char **argv) {
	int iters = argc > 1 ? atoi(argv[1]) : 5000;
	static int8_t a[4096] __attribute__((aligned(16)));
	static int8_t b[4096] __attribute__((aligned(16)));
	for (int it = 0; it < iters; it++) {
		uint32_t size = (it < 64) ? (uint32_t)it : (rnd() % 2049u);
		int mode = it % 4; /* random, extremes, all -128, alternating */
		for (uint32_t i = 0; i < size; i++) {
			int8_t x = (int8_t)rnd(), y = (int8_t)rnd();
			if (mode == 1) { x = (rnd() & 1) ? 127 : -128; y = (rnd() & 1) ? 127 : -128; }
			if (mode == 2) { x = -128; y = -128; }
			if (mode == 3) { x = (i & 1) ? 127 : -128; y = (i & 2) ? -1 : 1; }
			a[i] = x; b[i] = y;
		}
		int32_t want = 0x5A5A5A5A, got = 0x5A5A5A5A;
		tm_dot_prod_orig(a, b, size, &want);
		tm_dot_prod(a, b, size, &got);
		if (want != got) {
			printf("SS_HOSTCHECK FAIL size=%u mode=%d expected=%d got=%d first_bytes_a=", size, mode, want, got);
			for (uint32_t i = 0; i < size && i < 8; i++) printf("%d,", a[i]);
			printf(" first_bytes_b=");
			for (uint32_t i = 0; i < size && i < 8; i++) printf("%d,", b[i]);
			printf("\n");
			return 1;
		}
	}
	printf("SS_HOSTCHECK ok calls=%d\n", iters);
	return 0;
}
