/* W1: TinyMaix int8 fully-connected layer (tml_fc) on PicoRV32.
 *
 * Mirrors TinyMaix's tml_fc: one tm_dot_prod per output channel, bias add, then
 * requantization. Requant uses TinyMaix's no-FPU style (integer multiply + shift)
 * so the measured region is dominated by the dot product, exactly as on an MCU.
 * Inputs are generated deterministically before the timed region.
 */
#include "runtime.h"
#include "tm_dot.h"

#ifndef FC_IN
#define FC_IN 512
#endif
#ifndef FC_OUT
#define FC_OUT 64
#endif

static mtype_t   in_data[FC_IN]           __attribute__((aligned(4)));
static mtype_t   weights[FC_OUT * FC_IN]  __attribute__((aligned(4)));
static int32_t   bias[FC_OUT];
static sumtype_t sums[FC_OUT];
static mtype_t   out_data[FC_OUT]         __attribute__((aligned(4)));

static uint32_t rng = 0x5EED1234u;
static inline uint32_t xorshift32(void) {
	rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
	return rng;
}

static inline mtype_t requant(int32_t acc) {
	/* out = clamp(round(acc * 0.0123) + zp): mult=1617 (Q17), zp=-3 */
	int64_t v = ((int64_t)acc * 1617 + (1 << 16)) >> 17;
	v += -3;
	if (v > 127) v = 127;
	if (v < -128) v = -128;
	return (mtype_t)v;
}

static void tml_fc(void) {
	for (int c = 0; c < FC_OUT; c++) {
		sumtype_t sum = 0;
		tm_dot_prod(in_data, weights + c * FC_IN, FC_IN, &sum);
		sums[c] = sum;
		sum += bias[c];
		out_data[c] = requant(sum);
	}
}

int main(void) {
	for (int i = 0; i < FC_IN; i++) in_data[i] = (mtype_t)xorshift32();
	for (int i = 0; i < FC_OUT * FC_IN; i++) weights[i] = (mtype_t)xorshift32();
	for (int i = 0; i < FC_OUT; i++) bias[i] = (int32_t)(xorshift32() % 4096u) - 2048;

	ss_region_begin();
	uint64_t t0 = ss_rdcycle64();
	tml_fc();
	uint64_t t1 = ss_rdcycle64();
	ss_region_end();

	uint32_t h = ss_fnv1a(sums, sizeof sums, SS_FNV_INIT);
	h = ss_fnv1a(out_data, sizeof out_data, h);
	ss_report(t1 - t0, h);
	return 0;
}
