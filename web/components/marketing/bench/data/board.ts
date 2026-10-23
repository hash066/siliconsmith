// Board games: reading the real template and the real checker response. The checker (hosted engine) is the judge;
// the local comparison below only decides which line of the template the player should have clicked.

export interface BoardDesign {
  mcu_ref: string;
  nets: { name: string; pins: string[] }[];
  instances: { ref: string; part: string; params: Record<string, number> }[];
  assumptions: Record<string, number | string>;
  mcu_assignments: { function: string; pin: string; use: string; net: string }[];
  firmware_pins: { function: string; pin: string; use: string }[];
  [k: string]: unknown;
}

export interface TemplateResponse {
  ok: boolean;
  id: string;
  title: string;
  description?: string;
  design: BoardDesign;
  header: string;
}

export interface Finding {
  check: string;
  status: string;
  detail: string;
  evidence: string[];
}
export interface Rung {
  rung: string;
  status: string;
  label?: string;
  detail: string;
  evidence: string[];
  findings?: Finding[];
}
export interface CheckResponse {
  ok: boolean;
  passed: boolean;
  rungs: Rung[];
  header?: string;
}

export const MISMATCH_TEMPLATE = "fault_gpio12_vs_gpio14";
export const FIX_TEMPLATE = "clean_sensor";
export const PULLUP_REFS = ["R1", "R2"] as const;
export const PULLUP_CHOICES = [330, 1000, 2200, 3300, 4700, 10000] as const;
/** The shipped template has 4.7 kohm standard-mode pull-ups; the game switches the bus to fast mode and starts at 10 kohm. */
export const FIX_START_OHMS = 10000;

export const fmtOhms = (o: number) => (o >= 1000 ? `${o / 1000 % 1 === 0 ? o / 1000 : (o / 1000).toFixed(1)} kΩ` : `${o} Ω`);

// ---------- Spot the mismatch ----------

export interface HeaderLine {
  id: string; // fw:<function>
  fn: string;
  text: string;
  pin: number;
}
export interface NetLine {
  id: string; // net:<name>
  fn: string;
  net: string;
  pin: string; // e.g. GPIO14
  text: string;
}

/** The `#define SS_PIN_<FN> <n>` lines of the generated header, as selectable rows. */
export function headerLines(header: string): HeaderLine[] {
  const out: HeaderLine[] = [];
  for (const raw of header.split("\n")) {
    const m = raw.match(/^#define\s+SS_PIN_([A-Z0-9_]+)\s+(\d+)/);
    if (m) out.push({ id: `fw:${m[1].toLowerCase()}`, fn: m[1].toLowerCase(), text: raw.trim(), pin: Number(m[2]) });
  }
  return out;
}

/** One row per MCU-assigned net: the pin that really sits on that net in the netlist. */
export function netLines(d: BoardDesign): NetLine[] {
  const out: NetLine[] = [];
  for (const a of d.mcu_assignments) {
    const net = d.nets.find((n) => n.name === a.net);
    if (!net) continue;
    const mine = net.pins.find((p) => p.startsWith(d.mcu_ref + "."));
    if (!mine) continue;
    out.push({ id: `net:${a.net}`, fn: a.function, net: a.net, pin: mine.slice(d.mcu_ref.length + 1), text: `${a.net.padEnd(8)} ${net.pins.join("  ")}` });
  }
  return out;
}

export interface Mismatch {
  fn: string;
  firmwarePin: number;
  netlistPin: string;
  /** Row ids that count as finding it: the header line and the netlist line of the same signal. */
  rowIds: string[];
}

const digits = (s: string) => Number(s.replace(/\D/g, ""));

/** Header pin vs the pin the netlist wires, by signal name. Returns every disagreement (the real template has one). */
export function findMismatches(header: HeaderLine[], nets: NetLine[]): Mismatch[] {
  const out: Mismatch[] = [];
  for (const h of header) {
    const n = nets.find((x) => x.fn === h.fn);
    if (n && digits(n.pin) !== h.pin) out.push({ fn: h.fn, firmwarePin: h.pin, netlistPin: n.pin, rowIds: [h.id, n.id] });
  }
  return out;
}

export type SpotGrade = "found" | "wrong" | "none";
export function gradeSpot(selected: string | null, mismatches: Mismatch[]): SpotGrade {
  if (!selected) return "none";
  return mismatches.some((m) => m.rowIds.includes(selected)) ? "found" : "wrong";
}

export function rungOf(r: CheckResponse, id: string): Rung | undefined {
  return r.rungs.find((x) => x.rung === id);
}

/** Evidence ids of the failed findings of a rung (falls back to the rung's own list). */
export function failedEvidence(r: Rung): string[] {
  const f = (r.findings ?? []).filter((x) => x.status === "fail").flatMap((x) => x.evidence);
  return Array.from(new Set(f.length ? f : r.evidence));
}

// ---------- Fix the rung ----------

/** The player's edit: fast-mode bus and the chosen pull-up on both I2C lines. Everything else stays as the template ships. */
export function withPullups(d: BoardDesign, ohms: number): BoardDesign {
  const c = structuredClone(d);
  c.assumptions = { ...c.assumptions, i2c_mode: "fast" };
  for (const i of c.instances) if ((PULLUP_REFS as readonly string[]).includes(i.ref)) i.params = { ...i.params, ohms };
  return c;
}

export interface BusLine {
  line: string; // SCL | SDA
  rp?: number;
  riseNs?: number;
  limitNs?: number;
  minRp?: number;
  ok: boolean;
  text: string;
}

/** Parses the three shapes of the checker's I2C pull-up sentences. Anything it cannot parse stays as plain text. */
export function parseBus(detail: string, passed: boolean): BusLine[] {
  const body = detail.replace(/^I2C pull-ups:\s*/, "");
  const out: BusLine[] = [];
  for (const part of body.split(/;\s+/)) {
    const line = part.match(/^(SCL|SDA):/)?.[1];
    if (!line) continue;
    const rp = part.match(/Rp (\d+) ohm/)?.[1];
    const rise = part.match(/rise time (\d+) ns/)?.[1];
    const lim = part.match(/(?:<=|over the) (\d+) ns/)?.[1];
    const min = part.match(/minimum (\d+) ohm/)?.[1] ?? part.match(/Rp >= (\d+) ohm/)?.[1];
    const tooLow = /below the minimum/.test(part);
    const overLimit = /over the \d+ ns/.test(part);
    out.push({
      line,
      rp: rp ? Number(rp) : undefined,
      riseNs: rise ? Number(rise) : undefined,
      limitNs: lim ? Number(lim) : undefined,
      minRp: min ? Number(min) : undefined,
      ok: passed && !tooLow && !overLimit,
      text: part,
    });
  }
  return out;
}
