// Generates web/public/replays/r_mock_demo.ndjson: a deterministic, contract-exact mock run.
//
//   node scripts/gen-mock-replay.ts
//
// REAL numbers (hand-built golden path, runs/golden/dot4_s8): baseline 860,730 cycles, 1,993 LUTs,
// 574 ALUs, 923 FFs, hotspot tm_dot_prod 95.7%; dot4.s8 228,382 cycles (3.77x) at +3.16% LUT-eq
// (+4 DSP), formally proven, bit-identical output. The SAT numbers on n1's passing proof are the
// real prove.log figures. Everything else (other candidates, timings, tokens, Fmax) is invented.
// Fmax is a placeholder (nextpnr is not wired yet).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Counterexample, Model, Role, Rung, RungResult, Stage } from "../lib/events.ts";
import { INSTRUCTIONS, intrinsicsFor, patchFor, proposalFor, rtlFor, semanticsC, sym } from "./mock-instructions.ts";

const RUN_ID = "r_mock_demo";
const BASE = { cycles: 860_730, luts: 1_993, alus: 574, ffs: 923, cells: 3_741, fmax: 42.6, hash: "9c42e1b7" };
const LUT_EQ = BASE.luts + BASE.alus; // 2,567
const BUDGET = 5;
const CAP = 50;
const CONFIG = { area_budget_pct: BUDGET, beam: 3, k_root: 8, k_child: 5, max_depth: 3, max_concurrency: CAP };
// USD per million tokens, in / out (PLAN §8; verify in the Token Factory console)
const PRICES: Record<Model, [number, number]> = {
  "nemotron-ultra": [1.0, 3.0],
  "nemotron-super": [0.3, 0.9],
  "nemotron-nano": [0.06, 0.24],
};

// ---------- deterministic randomness ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x51c0);
const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
const int = (lo: number, hi: number) => Math.round(between(lo, hi));
const hex8 = () => Math.floor(rand() * 0xffffffff).toString(16).padStart(8, "0");
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (n: number) => n.toLocaleString("en-US");

// ---------- event collection ----------
type Body = Record<string, unknown>;
const drafts: Array<{ t: number; order: number; type: string; body: Body }> = [];
let order = 0;
function emit(tSec: number, type: string, body: Body = {}) {
  drafts.push({ t: Math.round(tSec * 1000), order: order++, type, body });
}

// ---------- sandbox slots (semaphore of CAP) ----------
const intervals: Array<[number, number]> = [];
function peakIn(s: number, e: number): number {
  const pts: Array<[number, number]> = [];
  for (const [a, b] of intervals) {
    if (a < e && b > s) {
      pts.push([Math.max(a, s), 1]);
      pts.push([Math.min(b, e), -1]);
    }
  }
  pts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let c = 0;
  let m = 0;
  for (const [, d] of pts) {
    c += d;
    m = Math.max(m, c);
  }
  return m;
}
function reserve(ready: number, dur: number): number {
  const candidates = [ready, ...intervals.map(([, b]) => b).filter((b) => b > ready)].sort((a, b) => a - b);
  for (const s of candidates) {
    if (peakIn(s, s + dur) < CAP) {
      intervals.push([s, s + dur]);
      return s;
    }
  }
  throw new Error("no slot");
}
let opCount = 0;
function sandboxOp(nodeId: string, fromImage: string, ready: number, dur: number, opts: { toImage?: string; fail?: boolean } = {}) {
  const start = reserve(ready, dur);
  const opId = `op_${hex8()}`;
  opCount++;
  emit(start, "sandbox.op", { node_id: nodeId, op_id: opId, from_image: fromImage, status: "started" });
  const end = start + dur;
  const done: Body = { node_id: nodeId, op_id: opId, from_image: fromImage, status: opts.fail ? "failed" : "succeeded", duration_s: r1(dur) };
  if (opts.toImage && !opts.fail) done.to_image = opts.toImage;
  emit(end, "sandbox.op", done);
  return { start, end };
}

// ---------- Nemotron calls ----------
let costTotal = 0;
let tokenTotal = 0;
function llm(tEnd: number, nodeId: string | null, model: Model, role: Role, tokensIn: number, tokensOut: number, latencyS: number) {
  const [pin, pout] = PRICES[model];
  const cost = Math.round(((tokensIn / 1e6) * pin + (tokensOut / 1e6) * pout) * 1e6) / 1e6;
  costTotal += cost;
  tokenTotal += tokensIn + tokensOut;
  emit(tEnd, "llm.call", { node_id: nodeId, model, role, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: cost, latency_ms: Math.round(latencyS * 1000) });
}
const call = {
  brief: (t: number, id: string) => { const l = between(2.6, 3.4); llm(t + l, id, "nemotron-nano", "brief", int(5800, 6600), int(700, 860), l); return t + l; },
  architect: (t: number, id: string | null, k: number) => { const l = between(24, 34); llm(t + l, id, "nemotron-ultra", "architect", int(10400, 13800), int(420 * k, 520 * k), l); return t + l; },
  beam: (t: number) => { const l = between(6, 9); llm(t + l, null, "nemotron-ultra", "architect", int(5200, 6900), int(620, 900), l); return t + l; },
  implement: (t: number, id: string) => { const l = between(13, 22); llm(t + l, id, "nemotron-super", "implement", int(7400, 9600), int(2200, 3500), l); return t + l; },
  repair: (t: number, id: string) => { const l = between(10, 17); llm(t + l, id, "nemotron-super", "repair", int(9100, 12400), int(1900, 3100), l); return t + l; },
  triage: (t: number, id: string) => { const l = between(1.2, 2.4); llm(t + l, id, "nemotron-nano", "triage", int(2300, 5200), int(160, 330), l); return t + l; },
  diagnose: (t: number, id: string) => { const l = between(16, 24); llm(t + l, id, "nemotron-ultra", "diagnose", int(11800, 15200), int(880, 1400), l); return t + l; },
  report: (t: number) => { const l = between(30, 38); llm(t + l, null, "nemotron-ultra", "report", int(17600, 19400), int(3000, 3600), l); return t + l; },
};

// ---------- the search plan ----------
interface AttemptPlan { fail?: Stage; proveSkip?: boolean }
interface ScorePlan { cycles: number; area?: number; luts?: number; alus?: number; fmax: number }
interface NodePlan { id: string; parent: string; add: string; attempts: AttemptPlan[]; score?: ScorePlan; died?: string; rtlFrom?: number }

const PASS: AttemptPlan[] = [{}];
const LINT3: AttemptPlan[] = [{ fail: "lint" }, { fail: "lint" }, { fail: "lint" }];
// v1.1 stage order: implement → lint → unit → e2e → bench → prove → synth. bench fails (no speedup over
// the parent) and synth fails (over the area budget) prune the node directly, with no repair.
const PLAN: NodePlan[] = [
  // depth 1 — Ultra's eight proposals for the root (k_root = 8)
  { id: "n1", parent: "root", add: "dot4.s8", attempts: [{ fail: "prove" }, {}], score: { cycles: 228_382, luts: 2_041, alus: 607, fmax: 42.6 } },
  { id: "n2", parent: "root", add: "dot2.s8", attempts: PASS, score: { cycles: 402_210, area: 1.48, fmax: 42.6 } },
  { id: "n3", parent: "root", add: "mul2.s8", attempts: PASS, score: { cycles: 544_766, area: 2.31, fmax: 42.4 } },
  { id: "n4", parent: "root", add: "dot4p.s8", attempts: PASS, score: { cycles: 239_760, area: 3.42, fmax: 42.6 } },
  { id: "n5", parent: "root", add: "dot4.u8s8", attempts: [{ fail: "e2e" }, { fail: "e2e" }, { fail: "e2e" }], died: "Bit-identical output failed after 2 repairs: the instruction assumes unsigned activations, the kernel's are signed int8" },
  { id: "n6", parent: "root", add: "dacc.s8", attempts: [{ fail: "unit" }, {}], score: { cycles: 180_236, area: 5.74, fmax: 41.6 } },
  { id: "n7", parent: "root", add: "sum4.s8", attempts: [{ fail: "lint" }, {}], score: { cycles: 859_904, area: 0.71, fmax: 42.6 } },
  { id: "n8", parent: "root", add: "dot2.s16", attempts: PASS, score: { cycles: 606_148, area: 2.86, fmax: 42.5 } },
  // depth 2 — beam keeps n1, n4, n2. The accumulator is the lever left, and it is expensive.
  { id: "n1.1", parent: "n1", add: "dacc.s8", attempts: PASS, score: { cycles: 180_236, area: 5.26, fmax: 41.8 } },
  { id: "n1.2", parent: "n1", add: "daccn.s8", attempts: [{ fail: "prove" }, {}], score: { cycles: 180_236, area: 5.07, fmax: 41.5 } },
  { id: "n1.3", parent: "n1", add: "daccs.s8", attempts: [{ proveSkip: true }], score: { cycles: 182_950, area: 4.96, fmax: 41.2 } },
  { id: "n1.4", parent: "n1", add: "ldot4.s8", attempts: LINT3, died: "Needs a memory port: the PCPI slot exposes registers only (lint failed after 2 repairs)" },
  { id: "n1.5", parent: "n1", add: "tail4.s8", attempts: PASS, score: { cycles: 228_382, area: 3.77, fmax: 42.4 } },
  { id: "n4.1", parent: "n4", add: "dacc.s8", attempts: PASS, score: { cycles: 186_410, area: 5.31, fmax: 42.6 } },
  { id: "n4.2", parent: "n4", add: "daccs.s8", attempts: PASS, score: { cycles: 186_410, area: 5.02, fmax: 42.6 } },
  { id: "n4.3", parent: "n4", add: "tail4.s8", attempts: PASS, score: { cycles: 239_760, area: 4.03, fmax: 42.5 } },
  { id: "n4.4", parent: "n4", add: "dot2.s8", attempts: PASS, score: { cycles: 239_760, area: 4.85, fmax: 42.3 } },
  { id: "n2.1", parent: "n2", add: "dot4.s8", attempts: PASS, rtlFrom: 1, score: { cycles: 228_382, area: 4.59, fmax: 42.2 } },
  { id: "n2.2", parent: "n2", add: "dacc2.s8", attempts: PASS, score: { cycles: 335_175, area: 3.52, fmax: 41.9 } },
  { id: "n2.3", parent: "n2", add: "mul2.s8", attempts: PASS, score: { cycles: 402_210, area: 3.74, fmax: 42.4 } },
  { id: "n2.4", parent: "n2", add: "pk2.s8", attempts: PASS, rtlFrom: 1, score: { cycles: 402_210, area: 1.76, fmax: 42.6 } },
  { id: "n2.5", parent: "n2", add: "dot2.s16", attempts: PASS, score: { cycles: 401_990, area: 4.29, fmax: 42.3 } },
  // depth 3 — beam keeps n2.1 and n2.2 (the only feasible depth-2 CPUs); headroom is under 1.5%
  { id: "n2.1.1", parent: "n2.1", add: "tail2.s8", attempts: LINT3, died: "Lint failed after 2 repairs: a latch is inferred in the lane select" },
  { id: "n2.1.2", parent: "n2.1", add: "pk2.s8", attempts: PASS, rtlFrom: 1, score: { cycles: 228_382, area: 4.87, fmax: 41.9 } },
  { id: "n2.1.3", parent: "n2.1", add: "tail4.s8", attempts: PASS, score: { cycles: 228_382, area: 5.2, fmax: 42.0 } },
  { id: "n2.1.4", parent: "n2.1", add: "daccn.s8", attempts: PASS, rtlFrom: 1, score: { cycles: 180_236, area: 6.9, fmax: 41.4 } },
  { id: "n2.1.5", parent: "n2.1", add: "sum4.s8", attempts: PASS, rtlFrom: 1, score: { cycles: 228_382, area: 5.25, fmax: 42.1 } },
  { id: "n2.2.1", parent: "n2.2", add: "dot4.s8", attempts: PASS, rtlFrom: 1, score: { cycles: 228_382, area: 6.68, fmax: 41.7 } },
  { id: "n2.2.2", parent: "n2.2", add: "tail2.s8", attempts: PASS, rtlFrom: 1, score: { cycles: 335_175, area: 3.89, fmax: 41.9 } },
  { id: "n2.2.3", parent: "n2.2", add: "pk2.s8", attempts: [{ fail: "unit" }, {}], score: { cycles: 335_175, area: 3.81, fmax: 41.9 } },
  { id: "n2.2.4", parent: "n2.2", add: "sum4.s8", attempts: PASS, rtlFrom: 1, score: { cycles: 335_175, area: 4.18, fmax: 41.8 } },
  { id: "n2.2.5", parent: "n2.2", add: "dot2.s16", attempts: PASS, score: { cycles: 334_950, area: 4.81, fmax: 41.7 } },
];

const ARCH_NOTES: Record<string, string> = {
  root: "tm_dot_prod is 95.7% of the measured region: per 8 elements, 8 byte loads, 8 multiplies and 8 adds, with the multiply-add chain serial on PicoRV32. Inputs are 4-byte aligned, so word loads can feed packed lanes. Requant (2.6%) is in main.c, which is not patchable. Proposing packed dots, an accumulator and two cheap hedges.",
  n1: "With dot4.s8 the loop is 2 lw + 1 dot4 + 1 add per 4 MACs plus loop control. The add and the sum dependency are the lever left; an internal accumulator removes them but costs about 2% LUT-eq, which is more than the 1.84% of headroom. Trying three accumulator designs, a fused load (if the slot allows it) and a tail helper.",
  n4: "dot4p.s8 trades 11k cycles for a register stage it did not need: Fmax did not move. Headroom is 1.58%; trying accumulators and tail helpers that share its multipliers.",
  n2: "dot2.s8 leaves half the multiplies in software. A four-lane dot fits beside it (about 3.1%), and a dual-lane accumulator is the cheapest accumulator there is.",
  "n2.1": "dot2.s8 + dot4.s8 has 0.41% of headroom: only tail and packing helpers fit, and none touches the hot loop. One narrow accumulator for the frontier, expected over budget.",
  "n2.2": "dot2.s8 + dacc2.s8 has 1.48% of headroom. A four-lane dot would win cycles but costs 3.1%. Trying it anyway for the frontier, plus small helpers.",
};

// ---------- failure evidence ----------
const CEX_DOT4: Counterexample = {
  cycles: 6,
  signals: [
    { name: "pcpi_valid", width: 1, values: ["0", "1", "1", "0", "0", "0"] },
    { name: "pcpi_insn", width: 32, values: ["x", "00c5850b", "00c5850b", "x", "x", "x"] },
    { name: "pcpi_rs1", width: 32, values: ["x", "80808080", "80808080", "x", "x", "x"] },
    { name: "pcpi_rs2", width: 32, values: ["x", "80808080", "80808080", "x", "x", "x"] },
    { name: "pcpi_ready", width: 1, values: ["0", "0", "1", "0", "0", "0"] },
    { name: "pcpi_wr", width: 1, values: ["0", "0", "1", "0", "0", "0"] },
    { name: "pcpi_rd", width: 32, values: ["x", "x", "ffff0000", "x", "x", "x"] },
    { name: "spec_rd", width: 32, values: ["x", "00010000", "00010000", "x", "x", "x"] },
    { name: "miter_ok", width: 1, values: ["1", "1", "0", "1", "1", "1"] },
  ],
};
const CEX_DACCN: Counterexample = {
  cycles: 5,
  signals: [
    { name: "pcpi_valid", width: 1, values: ["1", "1", "0", "0", "0"] },
    { name: "funct3", width: 3, values: ["0", "1", "x", "x", "x"] },
    { name: "pcpi_rs1", width: 32, values: ["7f7f7f7f", "x", "x", "x", "x"] },
    { name: "pcpi_rs2", width: 32, values: ["7f7f7f7f", "x", "x", "x", "x"] },
    { name: "acc_q", width: 24, values: ["7f4000", "803c04", "000000", "000000", "000000"] },
    { name: "spec_acc", width: 32, values: ["007f4000", "00803c04", "00000000", "00000000", "00000000"] },
    { name: "pcpi_rd", width: 32, values: ["x", "ff803c04", "x", "x", "x"] },
    { name: "spec_rd", width: 32, values: ["x", "00803c04", "x", "x", "x"] },
    { name: "miter_ok", width: 1, values: ["1", "0", "1", "1", "1"] },
  ],
};

interface Evidence { detail: string; error_log: string; counterexample?: Counterexample }
const EVIDENCE: Record<string, Evidence> = {
  "n1:0": {
    detail: "SAT model found in 1.9 s · rs1 = rs2 = 0x80808080 · expected 0x00010000, got 0xFFFF0000",
    error_log: `$ sby -f prove_dot4_s8.sby
9. Executing SAT pass (solving SAT problems in the circuit).
Using SAT solver \`minisat\`.
Import proof for assert: $auto$miter.cc:242:create_miter_equiv$19 when 1'1.
Solving problem with 43,977 variables and 131,083 clauses..
SAT proof finished - model found: FAIL!

  Time Signal          Dec        Hex         Bin
  ---- --------------- ---------- ----------- --------------------------------
  init \\in_rs1         2155905152 0x80808080  10000000100000001000000010000000
  init \\in_rs2         2155905152 0x80808080  10000000100000001000000010000000
  init \\gold_rd             65536 0x00010000  00000000000000010000000000000000
  init \\gate_rd       4294901760 0xffff0000  11111111111111110000000000000000

Hint: 4 x (-128 * -128) = 65536 needs 18 signed bits; s01/s23/s are 17 bits wide.
1,000,000 random vectors never drew this input (it is a single point).`,
    counterexample: CEX_DOT4,
  },
  "n1.2:0": {
    detail: "k-induction counterexample at step 1 · acc 0x7F4000 + 64,516 wraps a 24-bit accumulator",
    error_log: `$ sby -f prove_daccn_s8.sby
SBY  [prove_daccn_s8] engine_0: ##   0:00:04  Trying induction in step 1..
SBY  [prove_daccn_s8] engine_0: ##   0:00:04  Assert failed in miter: miter_ok (step 1)
SBY  [prove_daccn_s8] engine_0: ##   0:00:04  Writing trace to VCD file: engine_0/trace_induct.vcd
SBY  [prove_daccn_s8] DONE (FAIL, rc=2)

acc_q   (24-bit)  0x7f4000 -> 0x803c04  (wrapped: reads back as -8,373,244)
spec    (32-bit)  0x007f4000 -> 0x00803c04  (8,403,972)
Bound: 512 lanes x 16,384 = 2^23, so the accumulator needs 25 signed bits, not 24.`,
    counterexample: CEX_DACCN,
  },
  "n6:0": {
    detail: "1,000,000 vectors · 812,409 mismatches · the read does not clear the accumulator",
    error_log: `$ ss unit --insn dacc.s8 --vectors 1000000 --seed 0x51c0
sequences: 4,096 x 244 steps (acc, acc, ..., read)
FAIL shard 0 seq 1 step 0: op=acc rs1=0x1a2f0c7e rs2=0xf3e1095a
  expected rd 0xffffefc6   (accumulator cleared by the previous read)
  got      rd 0x0002a7d1
812,409 of 1,000,000 vectors mismatch (every sequence after the first read)`,
  },
  "n2.2.3:0": {
    detail: "1,000,000 vectors · 996,094 mismatches · halfword lanes swapped",
    error_log: `$ ss unit --insn pk2.s8 --vectors 1000000 --seed 0x51c0
FAIL shard 0 vector 0: rs1=0x0000009c rs2=0x00000012
  expected rd 0x0012ff9c
  got      rd 0xff9c0012
996,094 of 1,000,000 vectors mismatch (all but those with rs1.b0 == rs2.b0)`,
  },
  "n7:0": {
    detail: "%Warning-WIDTHEXPAND: ss_insn_sum4_s8.v:8 · 1 warning is an error under -Wall",
    error_log: `$ verilator --lint-only -Wall ss_pcpi.v ss_insn_sum4_s8.v
%Warning-WIDTHEXPAND: ss_insn_sum4_s8.v:8:12: Operator ASSIGNW expects 10 bits on the Assign RHS, but Assign RHS's ADD generates 8 bits.
                                            : ... note: In instance 'ss_pcpi.u_sum4_s8'
    8 |  assign s  = rs1[7:0] + rs1[15:8] + rs1[23:16] + rs1[31:24];
      |            ^
                      ... For warning description see https://verilator.org/warn/WIDTHEXPAND?v=5.040
%Error: Exiting due to 1 warning(s)`,
  },
  "n1.4:0": {
    detail: "%Error: ss_insn_ldot4_s8.v:12 · can't find pcpi_mem_rdata",
    error_log: `$ verilator --lint-only -Wall ss_pcpi.v ss_insn_ldot4_s8.v
%Error: ss_insn_ldot4_s8.v:12:28: Can't find definition of variable: 'pcpi_mem_rdata'
   12 |   if (valid) rd <= dot4(pcpi_mem_rdata, pcpi_mem_rdata2);
      |                         ^~~~~~~~~~~~~~
%Error: Exiting due to 1 error(s)`,
  },
  "n1.4:1": {
    detail: "%Error-PINNOTFOUND: ss_pcpi.v:58 · pin 'pcpi_mem_addr' not found",
    error_log: `$ verilator --lint-only -Wall ss_pcpi.v ss_insn_ldot4_s8.v
%Error-PINNOTFOUND: ss_pcpi.v:58:4: Pin not found: 'pcpi_mem_addr'
   58 |   .pcpi_mem_addr(pcpi_mem_addr),
      |    ^~~~~~~~~~~~~
%Error: Exiting due to 1 error(s)`,
  },
  "n1.4:2": {
    detail: "%Error-PINNOTFOUND: ss_pcpi.v:58 · the slot template has no memory interface",
    error_log: `$ verilator --lint-only -Wall ss_pcpi.v ss_insn_ldot4_s8.v
%Error-PINNOTFOUND: ss_pcpi.v:58:4: Pin not found: 'pcpi_mem_addr'
%Error-PINNOTFOUND: ss_pcpi.v:59:4: Pin not found: 'pcpi_mem_rdata'
%Error: Exiting due to 2 error(s)`,
  },
  "n2.1.1:0": {
    detail: "%Warning-LATCH: ss_insn_tail2_s8.v:9 · latch inferred for 'lane'",
    error_log: `$ verilator --lint-only -Wall ss_pcpi.v ss_insn_tail2_s8.v
%Warning-LATCH: ss_insn_tail2_s8.v:9:2: Latch inferred for signal 'ss_insn_tail2_s8.lane' (not all control paths of combinational always assign a value)
                                     : ... Suggest use of always_latch for intentional latches
    9 |  always @* begin
      |  ^~~~~~
%Error: Exiting due to 1 warning(s)`,
  },
  "n2.1.1:1": {
    detail: "%Warning-LATCH: ss_insn_tail2_s8.v:9 · latch inferred for 'rd'",
    error_log: `$ verilator --lint-only -Wall ss_pcpi.v ss_insn_tail2_s8.v
%Warning-LATCH: ss_insn_tail2_s8.v:9:2: Latch inferred for signal 'ss_insn_tail2_s8.rd' (not all control paths of combinational always assign a value)
%Error: Exiting due to 1 warning(s)`,
  },
  "n2.1.1:2": {
    detail: "%Warning-LATCH: ss_insn_tail2_s8.v:9 · latch inferred for 'lane'",
    error_log: `$ verilator --lint-only -Wall ss_pcpi.v ss_insn_tail2_s8.v
%Warning-LATCH: ss_insn_tail2_s8.v:9:2: Latch inferred for signal 'ss_insn_tail2_s8.lane' (not all control paths of combinational always assign a value)
%Error: Exiting due to 1 warning(s)`,
  },
  "n5:0": {
    detail: "output hash 51d0a7e3 ≠ baseline 9c42e1b7 · 61 of 64 outputs differ",
    error_log: `$ ss e2e --workload w1_tinymaix_fc
output hash 51d0a7e3 != baseline 9c42e1b7
  sums[0]   baseline  -18,433   candidate   41,217
  sums[1]   baseline    9,021   candidate   57,305
  sums[2]   baseline   -2,880   candidate   30,094
  ... 61 of 64 outputs differ
note: in_data[] holds signed int8 activations (xorshift32 bytes), not post-ReLU values`,
  },
  "n5:1": {
    detail: "output hash 7e19c0aa ≠ baseline 9c42e1b7 · 9 of 64 outputs differ",
    error_log: `$ ss e2e --workload w1_tinymaix_fc
output hash 7e19c0aa != baseline 9c42e1b7
  sums[4]   baseline   47,101   candidate  -18,435
  ... 9 of 64 outputs differ
note: the weight-sum correction is accumulated in int16 and overflows on 9 rows`,
  },
  "n5:2": {
    detail: "output hash c3d4170e ≠ baseline 9c42e1b7 · 64 of 64 outputs differ",
    error_log: `$ ss e2e --workload w1_tinymaix_fc
output hash c3d4170e != baseline 9c42e1b7
  sums[0]   baseline  -18,433   candidate  -18,302
  ... 64 of 64 outputs differ by exactly sum(w) for that row
note: the correction subtracts 127 * sum(w); the bias is x + 128`,
  },
};

const PROVE_STATS: Record<string, [number, number, number]> = {
  // vars, clauses, seconds
  "dot4.s8": [44_425, 132_421, 68.4], // real (runs/golden/dot4_s8/prove/prove.log)
  "dot2.s8": [11_906, 35_140, 4.1],
  "mul2.s8": [12_288, 36_201, 4.6],
  "dot4p.s8": [46_112, 137_904, 74.2],
  "dot4.u8s8": [47_530, 141_877, 79.0],
  "dacc.s8": [61_904, 184_330, 92.7],
  "daccn.s8": [58_211, 173_556, 84.9],
  "daccs.s8": [73_340, 219_880, 247.0],
  "dacc2.s8": [24_018, 71_312, 21.4],
  "sum4.s8": [1_204, 3_377, 0.3],
  "dot2.s16": [91_204, 271_633, 212.0],
  "tail4.s8": [9_847, 28_610, 2.8],
  "tail2.s8": [5_512, 16_048, 1.2],
  "pk2.s8": [512, 1_380, 0.1],
};
const DSP: Record<string, number> = { "dot4.s8": 4, "dot2.s8": 2, "mul2.s8": 2, "dot4p.s8": 4, "dot4.u8s8": 4, "dacc.s8": 4, "daccn.s8": 4, "daccs.s8": 4, "dacc2.s8": 2, "dot2.s16": 2, "tail2.s8": 2, "ldot4.s8": 4 };
const SHARES_DOT4 = new Set(["dacc.s8", "daccn.s8", "daccs.s8", "tail4.s8"]);
function dspFor(set: string[]): number {
  const hasDot4 = set.includes("dot4.s8") || set.includes("dot4p.s8");
  return set.reduce((n, m) => n + (hasDot4 && SHARES_DOT4.has(m) ? 0 : (DSP[m] ?? 0)), 0);
}
const FF_EXTRA: Record<string, number> = { "dot4p.s8": 68, "dacc.s8": 32, "daccn.s8": 25, "daccs.s8": 64, "dacc2.s8": 32 };

// ---------- simulation ----------
interface Built { image: string; end: number; set: string[]; cycles: number }
const built = new Map<string, Built>();
const scoredSummary: Array<{ id: string; t: number; wall: number; feasible: boolean; area: number; mnemonic: string }> = [];
const verifiedPoints: Array<{ id: string; area: number; wall: number }> = [];
const onPareto = new Set<string>();

function simulateNode(plan: NodePlan, createdAt: number): number {
  const parent = built.get(plan.parent)!;
  const set = [...parent.set, plan.add];
  const spec = INSTRUCTIONS[plan.add];
  const id = plan.id;
  const sc = plan.score;
  let t = createdAt + between(0.1, 0.4);
  emit(t, "node.stage", { node_id: id, stage: "implement", status: "queued", attempt: 0 });
  let image = "";
  let lastFail: Stage | null = null;
  let proveSkipped = false;
  let a = 0;
  const finish = (end: number, reason: string) => {
    emit(end + 0.05, "node.pruned", { node_id: id, reason });
    built.set(id, { image: image || parent.image, end, set, cycles: parent.cycles });
    return end + 0.05;
  };

  for (; a < plan.attempts.length; a++) {
    const at = plan.attempts[a];
    if (a > 0) t = call.triage(t, id);
    emit(t, "node.stage", { node_id: id, stage: "implement", status: "running", attempt: a });
    t = a === 0 ? call.implement(t, id) : call.repair(t, id);
    const rtl = rtlFor(plan.add, a + (plan.rtlFrom ?? 0));
    emit(t, "node.stage", {
      node_id: id, stage: "implement", status: "pass", attempt: a,
      detail: `${a === 0 ? "Super wrote" : "Super repaired"} ${rtl.split("\n").length}-line RTL, C reference, intrinsic and kernel patch`,
      artifacts: { rtl, c_ref: semanticsC(spec), intrinsic_h: intrinsicsFor(set), patch_diff: patchFor(set, a) },
    });

    const fail = (stage: Stage, end: number) => {
      const e = EVIDENCE[`${id}:${a}`] ?? { detail: `${stage} failed`, error_log: `${stage} failed` };
      const artifacts: Body = { error_log: e.error_log };
      if (e.counterexample) artifacts.counterexample = e.counterexample;
      emit(end, "node.stage", { node_id: id, stage, status: "fail", attempt: a, detail: e.detail, artifacts });
      lastFail = stage;
      return end;
    };

    // L1: build + lint in a branch forked from the parent's checkpoint image
    const img = `contree:${id}@a${a}`;
    const build = sandboxOp(id, parent.image, t, between(15, 22), { toImage: img, fail: at.fail === "lint" });
    emit(build.start, "node.stage", { node_id: id, stage: "lint", status: "running", attempt: a });
    if (at.fail === "lint") { t = fail("lint", build.end); continue; }
    emit(build.end, "node.stage", { node_id: id, stage: "lint", status: "pass", attempt: a, detail: `verilator --lint-only -Wall · 0 warnings · firmware ${fmt(int(3700, 4300))} B` });
    image = img;
    t = build.end;

    // L2: 1,000,000 vectors in 8 shards
    let first = Infinity;
    let end = t;
    for (let s = 0; s < 8; s++) {
      const op = sandboxOp(id, img, t + s * 0.05, between(18, 30), { fail: at.fail === "unit" && s === 0 });
      first = Math.min(first, op.start);
      end = Math.max(end, op.end);
    }
    emit(first, "node.stage", { node_id: id, stage: "unit", status: "running", attempt: a });
    if (at.fail === "unit") { t = fail("unit", end); continue; }
    emit(end, "node.stage", { node_id: id, stage: "unit", status: "pass", attempt: a, detail: spec.stateful ? "1,000,000 vectors in 4,096 sequences · 0 mismatches" : "1,000,000 vectors · 0 mismatches" });
    t = end;

    // L4: full SoC, output must be bit-identical to the baseline core
    const e2e = sandboxOp(id, img, t, between(24, 34), { fail: at.fail === "e2e" });
    emit(e2e.start, "node.stage", { node_id: id, stage: "e2e", status: "running", attempt: a });
    if (at.fail === "e2e") { t = fail("e2e", e2e.end); continue; }
    emit(e2e.end, "node.stage", { node_id: id, stage: "e2e", status: "pass", attempt: a, detail: `output hash ${BASE.hash} = baseline · 64 of 64 outputs bit-identical` });
    t = e2e.end;

    // cycle benchmark: no speedup over the parent ends the branch, with no repair
    const bench = sandboxOp(id, img, t, between(12, 18));
    emit(bench.start, "node.stage", { node_id: id, stage: "bench", status: "running", attempt: a });
    t = bench.end;
    if (sc!.cycles > parent.cycles * 0.99) {
      emit(t, "node.stage", { node_id: id, stage: "bench", status: "fail", attempt: a, detail: `${fmt(sc!.cycles)} cycles: no gain over parent (${fmt(parent.cycles)})` });
      return finish(t, `No speedup over parent (${(parent.cycles / sc!.cycles).toFixed(2)}×)`);
    }
    emit(t, "node.stage", { node_id: id, stage: "bench", status: "pass", attempt: a, detail: `${fmt(sc!.cycles)} cycles · ${(BASE.cycles / sc!.cycles).toFixed(2)}× fewer than baseline` });

    // L3: SAT miter against the reference spec + PCPI handshake properties
    const [vars, clauses, secs] = PROVE_STATS[plan.add];
    const proveDur = at.fail === "prove" ? between(6, 9) : at.proveSkip ? 300 + between(2, 4) : secs + between(4, 7);
    const miter = sandboxOp(id, img, t, proveDur, { fail: at.fail === "prove" || at.proveSkip });
    const hs = sandboxOp(id, img, t + 0.05, between(9, 13));
    emit(Math.min(miter.start, hs.start), "node.stage", { node_id: id, stage: "prove", status: "running", attempt: a });
    end = Math.max(miter.end, hs.end);
    if (at.fail === "prove") { t = fail("prove", end); continue; }
    if (at.proveSkip) {
      proveSkipped = true;
      emit(end, "node.stage", {
        node_id: id, stage: "prove", status: "skipped", attempt: a,
        detail: "SAT timeout after 300 s · evidence stays at L2 (1,000,000 vectors)",
        artifacts: { error_log: `$ sby -f prove_${sym(plan.add)}.sby\nSBY  engine_0: ##   0:05:00  Timeout after 300 s\nSBY  DONE (TIMEOUT, rc=8)\nThe carry-save miter does not converge within the proof budget. Not claimed as proven.` },
      });
    } else {
      const proof = id === "n1"
        ? "SAT · 44,425 vars · 132,421 clauses · 68.4 s · no counterexample · handshake 5/5"
        : spec.stateful
          ? `k-induction depth 2 · ${fmt(vars)} vars · ${r1(secs)} s · no counterexample · handshake 5/5`
          : `SAT · ${fmt(vars)} vars · ${fmt(clauses)} clauses · ${r1(secs)} s · no counterexample · handshake 5/5`;
      emit(end, "node.stage", { node_id: id, stage: "prove", status: "pass", attempt: a, detail: proof });
    }
    t = end;
    lastFail = null;
    break;
  }
  const finalAttempt = Math.min(a, plan.attempts.length - 1);

  if (lastFail) {
    t = call.triage(t, id);
    t = call.diagnose(t, id);
    return finish(t + 0.15, plan.died ?? `${lastFail} failed after 2 repairs`);
  }

  // L5: synthesis — area against the budget, Fmax
  let dLutEq: number, luts: number, alus: number;
  if (sc!.luts !== undefined && sc!.alus !== undefined) {
    luts = sc!.luts; alus = sc!.alus; dLutEq = luts + alus - LUT_EQ;
  } else {
    dLutEq = Math.round(((sc!.area ?? 0) / 100) * LUT_EQ);
    const dl = Math.round(dLutEq * 0.59);
    luts = BASE.luts + dl; alus = BASE.alus + (dLutEq - dl);
  }
  const area = r2((dLutEq / LUT_EQ) * 100);
  const ffs = BASE.ffs + 38 + (set.length - 1) * 6 + set.reduce((n, m) => n + (FF_EXTRA[m] ?? 0), 0);
  const dsp = dspFor(set);
  const synth = sandboxOp(id, image, t, between(62, 96));
  emit(synth.start, "node.stage", { node_id: id, stage: "synth", status: "running", attempt: finalAttempt });
  t = synth.end;
  const synthDetail = `${fmt(luts)} LUT · ${fmt(alus)} ALU · ${dsp} DSP · +${area.toFixed(2)}% LUT-eq · ${sc!.fmax.toFixed(1)} MHz est.`;
  if (area > BUDGET) {
    emit(t, "node.stage", { node_id: id, stage: "synth", status: "fail", attempt: finalAttempt, detail: `${synthDetail} · over the ${BUDGET.toFixed(1)}% budget` });
    return finish(t, `Area +${area.toFixed(2)}% exceeds the ${BUDGET.toFixed(1)}% budget`);
  }
  emit(t, "node.stage", { node_id: id, stage: "synth", status: "pass", attempt: finalAttempt, detail: synthDetail });

  const speedup = BASE.cycles / sc!.cycles;
  const wall = (speedup * sc!.fmax) / BASE.fmax;
  const ladder: Record<Rung, RungResult> = { L1: "pass", L2: "pass", L3: proveSkipped ? "skipped" : "pass", L4: "pass", L5: "pass", L6: "skipped" };
  const feasible = !proveSkipped;
  if (!proveSkipped) verifiedPoints.push({ id, area, wall });
  emit(t + 0.1, "node.scored", {
    node_id: id, cycles: sc!.cycles, speedup: r2(speedup), luts, ffs, area_delta_pct: area,
    fmax_mhz: sc!.fmax, wall_speedup: r2(wall), feasible, on_pareto: false, ladder,
  });
  scoredSummary.push({ id, t: t + 0.1, wall, feasible, area, mnemonic: plan.add });
  if (proveSkipped) emit(t + 0.2, "log", { level: "warn", node_id: id, msg: `${id} ${plan.add} reaches ${wall.toFixed(2)}× inside the budget, but its proof timed out. Not eligible: evidence stays at L2.` });
  built.set(id, { image, end: t, set, cycles: sc!.cycles });
  return t + 0.2;
}

// ---------- run ----------
emit(0, "run.started", {
  workload: { id: "w1_tinymaix_fc", title: "TinyMaix int8 fully-connected layer", source_repo: "https://github.com/sipeed/TinyMaix", source_path: "src/arch_cpu.h", lang: "c" },
  config: CONFIG,
  backend: "contree",
});
emit(0.2, "log", { level: "info", msg: `Run ${RUN_ID} on Token Factory Sandboxes · ${CAP} slots · budget ${BUDGET.toFixed(1)}% LUT-equivalent area` });
emit(0.3, "node.created", { node_id: "root", parent_id: null, depth: 0, proposal: null, instruction_set: [] });
const prep = sandboxOp("root", "contree:siliconsmith-base", 0.5, 36.8, { toImage: "contree:root" });
emit(prep.end + 0.6, "run.baseline", {
  cycles: BASE.cycles, luts: BASE.luts, ffs: BASE.ffs, cells: BASE.cells, fmax_mhz: BASE.fmax, output_hash: BASE.hash,
  hotspots: [
    { symbol: "tm_dot_prod", file: "tm_dot.h", line_start: 26, line_end: 37, pct: 95.7 },
    { symbol: "requant", file: "main.c", line_start: 30, line_end: 37, pct: 2.6 },
    { symbol: "tml_fc", file: "main.c", line_start: 39, line_end: 47, pct: 1.4 },
  ],
});
emit(prep.end + 0.7, "log", { level: "info", msg: "Baseline: 860,730 cycles; tm_dot_prod (tm_dot.h:26-37) is 95.7% of the measured region" });
built.set("root", { image: "contree:root", end: prep.end, set: [], cycles: BASE.cycles });

let t = call.brief(prep.end + 0.8, "root");

function expand(parentId: string, children: NodePlan[], at: number): number {
  let tc = call.architect(at, parentId, children.length);
  if (ARCH_NOTES[parentId]) emit(tc + 0.01, "log", { level: "info", node_id: parentId, msg: `Ultra on ${parentId}: ${ARCH_NOTES[parentId]}` });
  const depth = parentId === "root" ? 1 : parentId.split(".").length + 1;
  const parentSet = built.get(parentId)!.set;
  for (const c of children) {
    tc += 0.05;
    emit(tc, "node.created", { node_id: c.id, parent_id: parentId, depth, proposal: proposalFor(c.add), instruction_set: [...parentSet, c.add] });
  }
  emit(tc + 0.05, "node.expanded", { node_id: parentId, children: children.map((c) => c.id) });
  let end = tc;
  for (const c of children) end = Math.max(end, simulateNode(c, tc + 0.1));
  return end;
}
const kids = (p: string) => PLAN.filter((n) => n.parent === p);

function beam(level: number, ids: string[], at: number): string[] {
  const pool = scoredSummary.filter((s) => ids.includes(s.id) && s.feasible).sort((a, b) => b.wall - a.wall);
  const keep = pool.slice(0, CONFIG.beam);
  const tEnd = call.beam(at);
  emit(tEnd + 0.1, "log", { level: "info", msg: `Beam step ${level}: keeping ${keep.map((k) => `${k.id} ${k.mnemonic} ${k.wall.toFixed(2)}×`).join(", ")} (B = ${CONFIG.beam})` });
  return keep.map((k) => k.id);
}

let d1End = expand("root", kids("root"), t + 0.4);
const b1 = beam(1, kids("root").map((n) => n.id), d1End + 1);
let d2End = 0;
const d2Start = d1End + 10;
for (const p of b1) d2End = Math.max(d2End, expand(p, kids(p), d2Start + between(0, 1.5)));
const b2 = beam(2, b1.flatMap((p) => kids(p).map((n) => n.id)), d2End + 1);
if (b2.length === 0) throw new Error('empty beam');
let d3End = 0;
const d3Start = d2End + 10;
for (const p of b2) d3End = Math.max(d3End, expand(p, kids(p), d3Start + between(0, 1.5)));
emit(d3End + 0.6, "log", { level: "info", msg: `Depth ${CONFIG.max_depth} reached: no depth-3 CPU gained cycles within the budget. Best stays n1 dot4.s8. Writing the design report.` });
const tReport = call.report(d3End + 1);

// Pareto front over verified candidates (L1–L5 pass), maximising wall speedup, minimising area;
// the baseline (0%, 1.00x) is part of the front.
const pts = [...verifiedPoints, { id: "root", area: 0, wall: 1 }];
for (const p of verifiedPoints) {
  const dominated = pts.some((q) => q.id !== p.id && q.area <= p.area && q.wall >= p.wall && (q.area < p.area || q.wall > p.wall));
  if (!dominated) onPareto.add(p.id);
}
for (const d of drafts) if (d.type === "node.scored" && onPareto.has(d.body.node_id as string)) d.body.on_pareto = true;

// New-best log lines, in time order
let best = { id: "", wall: 0 };
for (const s of [...scoredSummary].sort((a, b) => a.t - b.t)) {
  if (s.feasible && s.wall > best.wall) {
    best = { id: s.id, wall: s.wall };
    emit(s.t + 0.15, "log", { level: "info", node_id: s.id, msg: `New best: ${s.id} ${s.mnemonic} at ${s.wall.toFixed(2)}× wall-clock, +${s.area.toFixed(2)}% area` });
  }
}
if (best.id !== "n1") throw new Error(`expected n1 to win, got ${best.id}`);

const wall_s = Math.round(tReport + 1.5);
emit(tReport + 1.5, "run.completed", {
  best_node_id: best.id,
  pareto: [...onPareto],
  totals: { nodes: PLAN.length, sandboxes: opCount, cost_usd: Math.round(costTotal * 1e4) / 1e4, tokens: tokenTotal, wall_s },
  report: {},
});

// ---------- serialise ----------
drafts.sort((a, b) => a.t - b.t || a.order - b.order);
const lines = drafts.map((d, seq) => JSON.stringify({ v: 1, seq, t: d.t, run_id: RUN_ID, type: d.type, ...d.body }));
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../public/replays/r_mock_demo.ndjson");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");

const peak = peakIn(0, wall_s + 1);
console.log(`wrote ${lines.length} events to ${out}`);
console.log(`nodes ${PLAN.length + 1} · sandbox ops ${opCount} · peak concurrency ${peak}/${CAP} · cost $${costTotal.toFixed(4)} · tokens ${tokenTotal} · wall ${wall_s}s (${(wall_s / 60).toFixed(1)} min)`);
console.log(`pareto: ${[...onPareto].join(", ")} · best ${best.id} ${best.wall.toFixed(3)}×`);
console.log(`depth ends: d1 ${d1End.toFixed(0)}s · d2 ${d2End.toFixed(0)}s · d3 ${d3End.toFixed(0)}s`);
