// The real source the profile points into: workloads/w1_tinymaix_fc/tm_dot.h and main.c (TinyMaix, Apache-2.0,
// https://github.com/sipeed/TinyMaix commit 0532ece). Line numbers are the files' own, because the recorded
// hotspots (run.baseline.hotspots) are line ranges in these files. data.test.tsx checks the text against the repo files.
export interface SrcLine {
  file: "tm_dot.h" | "main.c";
  line: number;
  text: string;
}

const TM_DOT = [
  "//sum = SUM(Ai*Bi)",
  "TM_INLINE void tm_dot_prod(mtype_t* sptr, mtype_t* kptr,uint32_t size, sumtype_t* result)",
  "{",
  "    sumtype_t sum=0;",
  "    uint32_t i = 0;",
  "    uint32_t cnt = (size>>3)<<3;  //8",
  "    for(; i+8-1 <cnt; ){",
  "        sum += sptr[i]*kptr[i];i++;",
  "        sum += sptr[i]*kptr[i];i++;",
  "        sum += sptr[i]*kptr[i];i++;",
  "        sum += sptr[i]*kptr[i];i++;",
  "        sum += sptr[i]*kptr[i];i++;",
  "        sum += sptr[i]*kptr[i];i++;",
  "        sum += sptr[i]*kptr[i];i++;",
  "        sum += sptr[i]*kptr[i];i++;",
  "    }",
  "    for(; i <size; i++){",
  "        sum += sptr[i]*kptr[i];",
  "    }",
  "    *result = sum;",
  "    return;",
  "}",
];

const MAIN_C = [
  "static inline mtype_t requant(int32_t acc) {",
  "    /* out = clamp(round(acc * 0.0123) + zp): mult=1617 (Q17), zp=-3 */",
  "    int64_t v = ((int64_t)acc * 1617 + (1 << 16)) >> 17;",
  "    v += -3;",
  "    if (v > 127) v = 127;",
  "    if (v < -128) v = -128;",
  "    return (mtype_t)v;",
  "}",
  "",
  "static void tml_fc(void) {",
  "    for (int c = 0; c < FC_OUT; c++) {",
  "        sumtype_t sum = 0;",
  "        tm_dot_prod(in_data, weights + c * FC_IN, FC_IN, &sum);",
  "        sums[c] = sum;",
  "        sum += bias[c];",
  "        out_data[c] = requant(sum);",
  "    }",
  "}",
];

export const KERNEL_FIRST_LINE = { "tm_dot.h": 23, "main.c": 30 } as const;

export const KERNEL_LINES: SrcLine[] = [
  ...TM_DOT.map((text, i): SrcLine => ({ file: "tm_dot.h", line: KERNEL_FIRST_LINE["tm_dot.h"] + i, text })),
  ...MAIN_C.map((text, i): SrcLine => ({ file: "main.c", line: KERNEL_FIRST_LINE["main.c"] + i, text })),
];

export const linesOf = (file: SrcLine["file"], from: number, to: number) => KERNEL_LINES.filter((l) => l.file === file && l.line >= from && l.line <= to);
