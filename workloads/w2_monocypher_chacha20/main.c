/* W2: Monocypher ChaCha20 stream encryption on PicoRV32.
 *
 * Mirrors crypto_chacha20_djb's whole-block loop: one chacha20_rounds per 64-byte block,
 * add the input state, xor with the plaintext, store little-endian, bump the counter.
 * Key, nonce and plaintext are generated deterministically before the timed region.
 */
#include "runtime.h"
#include "chacha_core.h"

#ifndef NBLOCKS
#define NBLOCKS 16
#endif

static const u32 chacha20_constant[4] = { 0x61707865, 0x3320646e, 0x79622d32, 0x6b206574 }; // "expand 32-byte k"
static uint8_t plain[NBLOCKS * 64];
static uint8_t cipher[NBLOCKS * 64];
static u32 input[16];
static u32 pool[16];

static uint32_t rng = 0xC4AC4A20u;
static inline uint32_t xorshift32(void) {
	rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
	return rng;
}

static inline u32 load32_le(const uint8_t s[4]) {
	return (u32)s[0] | ((u32)s[1] << 8) | ((u32)s[2] << 16) | ((u32)s[3] << 24);
}
static inline void store32_le(uint8_t out[4], u32 in) {
	out[0] = (uint8_t)in; out[1] = (uint8_t)(in >> 8); out[2] = (uint8_t)(in >> 16); out[3] = (uint8_t)(in >> 24);
}

static void chacha20_encrypt(void) {
	const uint8_t *p = plain;
	uint8_t *c = cipher;
	FOR (i, 0, NBLOCKS) {
		chacha20_rounds(pool, input);
		FOR (j, 0, 16) {
			u32 k = pool[j] + input[j];
			store32_le(c, k ^ load32_le(p));
			c += 4;
			p += 4;
		}
		input[12]++;
		if (input[12] == 0) input[13]++;
	}
}

int main(void) {
	FOR (i, 0, 4) input[i] = chacha20_constant[i];
	FOR (i, 4, 12) input[i] = xorshift32();   // key
	input[12] = 0; input[13] = 0;             // block counter
	input[14] = xorshift32(); input[15] = xorshift32(); // nonce
	FOR (i, 0, sizeof plain) plain[i] = (uint8_t)xorshift32();

	ss_region_begin();
	uint64_t t0 = ss_rdcycle64();
	chacha20_encrypt();
	uint64_t t1 = ss_rdcycle64();
	ss_region_end();

	ss_report(t1 - t0, ss_fnv1a(cipher, sizeof cipher, SS_FNV_INIT));
	return 0;
}
