// Silicon as a team and a test plan: who did what in a live run (from the run's own usage numbers), and the operand-pair scenarios the
// instruction was simulated on, each with its result. Nothing here invents a number: agents come from the event stream, scenarios from
// views/instruction.json (made by Verilator in the Sandbox).
import type { InstructionViews } from "./silicon-views";
import { hex32, matches } from "./silicon-views";
import { internalAt, parseVcd } from "./vcd";

interface UsageLike {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}
export interface RunLike {
  usage: { total: UsageLike; byRole: Record<string, UsageLike | undefined> };
  sandboxes: { active: number; total: number; succeeded: number; failed: number };
}

export type AgentStatus = "waiting" | "working" | "done" | "not needed";
export interface AgentCard {
  id: "architect" | "engineer" | "triage" | "prover";
  name: string;
  model: string;
  job: string;
  status: AgentStatus;
  calls: number;
  tokens: number;
  costUsd: number;
  seconds: number;
  note?: string;
}

const sum = (run: RunLike, roles: string[]): UsageLike => {
  const t: UsageLike = { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 };
  for (const r of roles) {
    const u = run.usage.byRole[r];
    if (!u) continue;
    t.calls += u.calls;
    t.tokensIn += u.tokensIn;
    t.tokensOut += u.tokensOut;
    t.costUsd += u.costUsd;
    t.latencyMs += u.latencyMs;
  }
  return t;
};

export function agentsOf(run: RunLike, phase: "idle" | "running" | "done" | "failed"): AgentCard[] {
  const llm = (id: AgentCard["id"], name: string, model: string, job: string, roles: string[]): AgentCard => {
    const u = sum(run, roles);
    const status: AgentStatus = u.calls > 0 ? (phase === "running" ? "working" : "done") : phase === "done" || phase === "failed" ? "not needed" : "waiting";
    return { id, name, model, job, status, calls: u.calls, tokens: u.tokensIn + u.tokensOut, costUsd: u.costUsd, seconds: Math.round(u.latencyMs / 1000) };
  };
  const s = run.sandboxes;
  const prover: AgentCard = {
    id: "prover",
    name: "Prover",
    model: "Token Factory Sandbox",
    job: "Runs every check: lint, a million vectors, the formal proof, the whole program, cycles and area.",
    status: s.active > 0 ? "working" : s.total > 0 ? "done" : phase === "idle" ? "waiting" : "not needed",
    calls: s.total,
    tokens: 0,
    costUsd: 0,
    seconds: 0,
    note: s.total > 0 ? `${s.succeeded} succeeded, ${s.failed} failed; compute is billed by Token Factory, not counted in model cost` : undefined,
  };
  return [
    llm("architect", "Architect", "Nemotron 3 Ultra", "Reads the hot loop and proposes the instruction; diagnoses hard failures.", ["architect", "diagnose", "brief"]),
    llm("engineer", "Engineer", "Nemotron 3 Super", "Writes the Verilog, the C reference, the kernel rewrite and the independent spec; repairs.", ["implement", "repair", "polish", "report"]),
    llm("triage", "Triage", "Nemotron 3 Nano", "Turns raw tool logs into a precise diagnosis for the repair loop.", ["triage"]),
    prover,
  ];
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  rs1: number;
  rs2: number;
  hardware: number;
  reference: number;
  passed: boolean;
  /** signals inside the instruction at this operand pair, as hexadecimal, from the Verilator trace */
  internal?: Record<string, string>;
  /** an operand pair the visitor chose, run on request */
  custom?: boolean;
}

/** A scenario for an operand pair the visitor chose: a row [rs1, rs2, hardware, reference] and its own trace (one time stamp per pair). */
export function customScenario(n: number, row: number[], vcdText?: string): Scenario {
  const v = parseVcd(vcdText);
  return { id: `c${n}`, title: `Your pair ${n}`, description: "An operand pair you chose, simulated in Verilator in a Sandbox next to the plain C description.", rs1: row[0] >>> 0, rs2: row[1] >>> 0, hardware: row[2] >>> 0, reference: row[3] >>> 0, passed: matches(row), custom: true, internal: v ? internalAt(v, 0) : undefined };
}

/** What each of the fixed operand pairs is for (the pairs themselves come from the Sandbox worker, in this order). */
const PAIR_NOTES: Array<[string, string]> = [
  ["All zeros", "Both operands zero: the instruction must give zero (or its neutral value), not garbage."],
  ["Smallest non-zero", "Both operands 1: only the lowest bit of each is set."],
  ["Byte lanes 1,2,3,4", "Operand 1 packs the bytes 1, 2, 3, 4 and operand 2 packs four ones: a quick check of how the four lanes combine."],
  ["Largest positive bytes", "Every byte is 0x7F, the biggest positive 8-bit value: stresses the top of the range."],
  ["Most negative bytes", "Every byte is 0x80, the most negative 8-bit value: stresses sign handling."],
  ["Alternating signs", "Bytes alternate 0xFF and 0x01 against 0x01 and 0xFF: mixed signs in neighbouring lanes."],
  ["All ones by one", "0xFFFFFFFF against 1: every bit of the first operand is set."],
  ["Mixed pattern", "Two arbitrary-looking words, to catch anything the structured pairs miss."],
];

export function scenariosOf(v: InstructionViews, vcdText?: string): Scenario[] {
  const vcd = parseVcd(vcdText);
  return v.rows.map((r, i) => {
    const [title, description] = PAIR_NOTES[i] ?? [`Pair ${i + 1}`, "An operand pair from the test run."];
    return { id: `s${i + 1}`, title, description, rs1: r[0] >>> 0, rs2: r[1] >>> 0, hardware: r[2] >>> 0, reference: r[3] >>> 0, passed: matches(r), internal: vcd ? internalAt(vcd, i) : undefined };
  });
}

/** A short code snippet for a scenario: how the instruction is called, and the answer both sides gave. */
export function scenarioCode(s: Scenario, mnemonic: string): string {
  return `// ${s.title}\nuint32_t rs1 = 0x${hex32(s.rs1)};\nuint32_t rs2 = 0x${hex32(s.rs2)};\nuint32_t rd  = ss_${mnemonic.replace(/\./g, "_")}(rs1, rs2);   // the new instruction\nuint32_t ref = c_reference(rs1, rs2);                          // the plain C description\n// hardware: 0x${hex32(s.hardware)}   reference: 0x${hex32(s.reference)}   ${s.passed ? "PASSED" : "FAILED"}\n`;
}

export function planCsv(list: Scenario[]): string {
  return ["scenario,rs1,rs2,hardware_rd,reference_rd,result", ...list.map((s) => [s.title, `0x${hex32(s.rs1)}`, `0x${hex32(s.rs2)}`, `0x${hex32(s.hardware)}`, `0x${hex32(s.reference)}`, s.passed ? "PASSED" : "FAILED"].map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(","))].join("\n") + "\n";
}
