// A small reader for the VCD (value change dump) files Verilator writes. It reads only what the file says: signals with their
// scope, and the value of each signal at each time. Nothing is inferred.

export interface VcdSignal {
  id: string;
  /** scope names from the top, for example ["TOP", "ss_insn_dot4_s8"] */
  scope: string[];
  name: string;
  width: number;
}

export interface Vcd {
  signals: VcdSignal[];
  /** every time stamp in the file, ascending */
  times: number[];
  /** value of signal id at the end of each time stamp (a binary string, possibly with x or z) */
  at: Map<string, string[]>;
}

export function parseVcd(text: string | undefined | null): Vcd | null {
  if (!text || !text.includes("$enddefinitions")) return null;
  const signals: VcdSignal[] = [];
  const scope: string[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const ln = lines[i].trim();
    let m: RegExpMatchArray | null;
    if ((m = ln.match(/^\$scope\s+\w+\s+(\S+)\s+\$end/))) scope.push(m[1]);
    else if (/^\$upscope/.test(ln)) scope.pop();
    else if ((m = ln.match(/^\$var\s+\w+\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+\[[^\]]*\])?\s+\$end/))) signals.push({ id: m[2], scope: [...scope], name: m[3], width: Number(m[1]) });
    else if (ln.startsWith("$enddefinitions")) {
      i++;
      break;
    }
  }
  const width = new Map<string, number>();
  for (const s of signals) width.set(s.id, s.width);
  const now = new Map<string, string>();
  const times: number[] = [];
  const snaps: Array<Map<string, string>> = [];
  const close = () => {
    if (times.length) snaps[times.length - 1] = new Map(now);
  };
  for (; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln || ln.startsWith("$")) continue;
    if (ln[0] === "#") {
      close();
      times.push(Number(ln.slice(1)));
      continue;
    }
    if (ln[0] === "b" || ln[0] === "B") {
      const sp = ln.indexOf(" ");
      if (sp > 0) now.set(ln.slice(sp + 1).trim(), ln.slice(1, sp));
    } else if (/^[01xXzZ]/.test(ln)) now.set(ln.slice(1), ln[0].toLowerCase());
  }
  close();
  const at = new Map<string, string[]>();
  for (const s of signals) at.set(s.id, snaps.map((m) => m.get(s.id) ?? "x"));
  return { signals, times, at };
}

/** A binary value as hexadecimal, padded to the signal's width; anything with x or z stays as written. */
export function toHex(bits: string, width: number): string {
  if (/[xz]/.test(bits)) return bits;
  const padded = bits.padStart(width, "0");
  let out = "";
  for (let k = padded.length; k > 0; k -= 4) out = parseInt(padded.slice(Math.max(0, k - 4), k), 2).toString(16) + out;
  return out.padStart(Math.ceil(width / 4), "0");
}

const PORTS = new Set(["rs1", "rs2", "rd"]);

/** The signals inside the instruction (not the three ports, which the scenario already shows), as hexadecimal at the step-th time stamp. */
export function internalAt(v: Vcd, step: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of v.signals) {
    if (s.scope.length < 2 || PORTS.has(s.name)) continue;
    const col = v.at.get(s.id);
    if (!col || col[step] === undefined) continue;
    out[s.name] = toHex(col[step], s.width);
  }
  return out;
}
