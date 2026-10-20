/* tm_dot_prod rewritten for the SiliconSmith dot4.s8 custom instruction.
 * Original: TinyMaix src/arch_cpu.h (Apache-2.0, Copyright 2022 Sipeed Technology Co., Ltd.)
 * Same signature and bit-identical result; inputs are 4-byte aligned.
 */
#pragma once
#include <stdint.h>
#include "ss_intrinsics.h"

typedef int8_t  mtype_t;
typedef int32_t sumtype_t;
#define TM_INLINE __attribute__((always_inline)) static inline

TM_INLINE void tm_dot_prod(mtype_t* sptr, mtype_t* kptr,uint32_t size, sumtype_t* result)
{
    const uint32_t* s4 = (const uint32_t*)sptr;
    const uint32_t* k4 = (const uint32_t*)kptr;
    sumtype_t sum = 0;
    uint32_t n4 = size >> 2;
    uint32_t i = 0;
    for (; i + 4 <= n4; i += 4) {          /* 16 MACs per iteration */
        sum += (int32_t)ss_dot4_s8(s4[i],   k4[i]);
        sum += (int32_t)ss_dot4_s8(s4[i+1], k4[i+1]);
        sum += (int32_t)ss_dot4_s8(s4[i+2], k4[i+2]);
        sum += (int32_t)ss_dot4_s8(s4[i+3], k4[i+3]);
    }
    for (; i < n4; i++) sum += (int32_t)ss_dot4_s8(s4[i], k4[i]);
    for (i = n4 << 2; i < size; i++) sum += sptr[i] * kptr[i];
    *result = sum;
}
