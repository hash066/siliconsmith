/* Freestanding libc pieces GCC may emit calls to. */
#include <stddef.h>
#include <stdint.h>

void *memcpy(void *dst, const void *src, size_t n) {
	uint8_t *d = (uint8_t *)dst;
	const uint8_t *s = (const uint8_t *)src;
	while (n--) *d++ = *s++;
	return dst;
}

void *memmove(void *dst, const void *src, size_t n) {
	uint8_t *d = (uint8_t *)dst;
	const uint8_t *s = (const uint8_t *)src;
	if (d < s) { while (n--) *d++ = *s++; }
	else { d += n; s += n; while (n--) *--d = *--s; }
	return dst;
}

void *memset(void *dst, int c, size_t n) {
	uint8_t *d = (uint8_t *)dst;
	while (n--) *d++ = (uint8_t)c;
	return dst;
}

int memcmp(const void *a, const void *b, size_t n) {
	const uint8_t *x = (const uint8_t *)a, *y = (const uint8_t *)b;
	for (; n; n--, x++, y++) if (*x != *y) return *x - *y;
	return 0;
}
