/* SiliconSmith firmware runtime: UART output, cycle counter, result reporting. */
#pragma once
#include <stdint.h>
#include <stddef.h>

#define SS_UART (*(volatile uint32_t *)0x10000000u)
#define SS_EXIT (*(volatile uint32_t *)0x10000004u)

static inline void ss_putc(char c) { SS_UART = (uint32_t)(uint8_t)c; }

static inline void ss_puts(const char *s) {
	while (*s) ss_putc(*s++);
}

static inline void ss_put_u32(uint32_t v) {
	char buf[11];
	int i = 10;
	buf[i] = 0;
	do { buf[--i] = (char)('0' + v % 10u); v /= 10u; } while (v);
	ss_puts(&buf[i]);
}

static inline void ss_put_hex(uint32_t v) {
	static const char hex[] = "0123456789abcdef";
	for (int i = 28; i >= 0; i -= 4) ss_putc(hex[(v >> i) & 0xFu]);
}

/* 64-bit cycle counter (PicoRV32 ENABLE_COUNTERS64). */
static inline uint64_t ss_rdcycle64(void) {
	uint32_t hi, lo, hi2;
	do {
		__asm__ volatile("rdcycleh %0" : "=r"(hi));
		__asm__ volatile("rdcycle %0" : "=r"(lo));
		__asm__ volatile("rdcycleh %0" : "=r"(hi2));
	} while (hi != hi2);
	return ((uint64_t)hi << 32) | lo;
}

/* FNV-1a over a byte buffer: the output fingerprint used for the bit-identical check. */
static inline uint32_t ss_fnv1a(const void *data, size_t n, uint32_t h) {
	const uint8_t *p = (const uint8_t *)data;
	for (size_t i = 0; i < n; i++) { h ^= p[i]; h *= 16777619u; }
	return h;
}
#define SS_FNV_INIT 2166136261u

/* Machine-readable result line parsed by the engine. */
static inline void ss_report(uint64_t cycles, uint32_t hash) {
	ss_puts("SS_RESULT cycles=");
	ss_put_u32((uint32_t)cycles);
	ss_puts(" hash=");
	ss_put_hex(hash);
	ss_putc('\n');
}
