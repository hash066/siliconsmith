// Running an operand pair of your own: reading what the visitor typed and asking the Sandbox to simulate it.

/** 0x1f, 1f is NOT accepted (ambiguous with decimal); decimal and negative decimal (32-bit two's complement) are. null if it is not a 32-bit number. */
export function parseOperand(text: string): number | null {
  const t = text.trim().replace(/_/g, "");
  if (/^0x[0-9a-f]{1,8}$/i.test(t)) return parseInt(t.slice(2), 16) >>> 0;
  if (/^[0-9]{1,10}$/.test(t)) {
    const n = Number(t);
    return n <= 0xffffffff ? n : null;
  }
  if (/^-[0-9]{1,10}$/.test(t)) {
    const n = Number(t);
    return n >= -0x80000000 ? n >>> 0 : null;
  }
  return null;
}

export interface PairsResult {
  rows: number[][];
  vcd: string;
}

/** Asks the server to run the pairs; throws an Error whose message is fit to show. */
export async function runPairs(req: { name: string; rtl: string; cRef: string; pairs: Array<[number, number]> }, f: typeof fetch = fetch): Promise<PairsResult> {
  const r = await f("/api/silicon/pairs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: req.name, rtl: req.rtl, c_ref: req.cRef, pairs: req.pairs }) });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; rows?: number[][]; vcd?: string; error?: { message?: string } } | null;
  if (!r.ok || !j?.ok || !Array.isArray(j.rows)) throw new Error(j?.error?.message ?? `The simulation service answered ${r.status}.`);
  return { rows: j.rows, vcd: typeof j.vcd === "string" ? j.vcd : "" };
}

/** The instruction's name from its Verilog module line. */
export function moduleName(rtl: string): string | null {
  const m = rtl.match(/\bmodule\s+ss_insn_([a-z][a-z0-9_]*)\b/);
  return m ? m[1] : null;
}
