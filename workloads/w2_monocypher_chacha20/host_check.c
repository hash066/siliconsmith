/* Host-side differential test: patched chacha20_rounds vs Monocypher's original, on random states,
 * including the in-place call chacha20_rounds(block, block) that Monocypher itself uses.
 * Built with the host C compiler; custom instructions fall back to their C reference
 * (ss_intrinsics.h maps ss_x -> ss_ref_x off-target), so this checks the SOFTWARE rewrite only.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define chacha20_rounds chacha20_rounds_orig
#define rotl32 rotl32_orig
#include "orig/chacha_core.h"
#undef chacha20_rounds
#undef rotl32
#undef QUARTERROUND
#undef FOR
#undef FOR_T
#include "chacha_core.h"

static uint32_t rng = 0x0DDC0FFEu;
static uint32_t rnd(void) { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; }

int main(int argc, char **argv) {
	int iters = argc > 1 ? atoi(argv[1]) : 5000;
	for (int it = 0; it < iters; it++) {
		uint32_t in[16], want[16], got[16];
		int mode = it % 4; /* random, all-ones, all-zero, single bit */
		for (int i = 0; i < 16; i++) {
			in[i] = rnd();
			if (mode == 1) in[i] = 0xFFFFFFFFu;
			if (mode == 2) in[i] = 0;
			if (mode == 3) in[i] = (i == (it / 4) % 16) ? (1u << ((it / 64) % 32)) : 0;
		}
		chacha20_rounds_orig(want, in);
		chacha20_rounds(got, in);
		uint32_t inplace[16];
		memcpy(inplace, in, sizeof in);
		chacha20_rounds(inplace, inplace);
		if (memcmp(want, got, sizeof want) || memcmp(want, inplace, sizeof want)) {
			int k = 0;
			while (k < 16 && want[k] == got[k] && want[k] == inplace[k]) k++;
			printf("SS_HOSTCHECK FAIL size=16 mode=%d expected=%d got=%d word=%d in_place_got=%d in0=%08x in1=%08x\n",
			       mode, (int)want[k], (int)got[k], k, (int)inplace[k], in[0], in[1]);
			return 1;
		}
	}
	printf("SS_HOSTCHECK ok calls=%d\n", iters);
	return 0;
}
