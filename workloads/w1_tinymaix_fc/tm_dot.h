/* tm_dot_prod: verbatim from TinyMaix src/arch_cpu.h (TM_ARCH_CPU, INT8).
 * https://github.com/sipeed/TinyMaix  (commit 0532ece)
 *
 * Copyright 2022 Sipeed Technology Co., Ltd. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 * ANY KIND, either express or implied.
 *
 * SiliconSmith: this is the ONLY file the agent may rewrite for this workload.
 * Contract: same signature, bit-identical *result for all inputs. Inputs are 4-byte aligned.
 */
#pragma once
#include <stdint.h>
#include "ss_intrinsics.h"

typedef int8_t  mtype_t;
typedef int32_t sumtype_t;
#define TM_INLINE __attribute__((always_inline)) static inline

//sum = SUM(Ai*Bi)
TM_INLINE void tm_dot_prod(mtype_t* sptr, mtype_t* kptr,uint32_t size, sumtype_t* result)
{
    sumtype_t sum=0;
    uint32_t i = 0;
    uint32_t cnt = (size>>3)<<3;  //8
    for(; i+8-1 <cnt; ){
        sum += sptr[i]*kptr[i];i++;
        sum += sptr[i]*kptr[i];i++;
        sum += sptr[i]*kptr[i];i++;
        sum += sptr[i]*kptr[i];i++;
        sum += sptr[i]*kptr[i];i++;
        sum += sptr[i]*kptr[i];i++;
        sum += sptr[i]*kptr[i];i++;
        sum += sptr[i]*kptr[i];i++;
    }
    for(; i <size; i++){
        sum += sptr[i]*kptr[i];
    }
    *result = sum;
    return;
}
