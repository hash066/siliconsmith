import { describe, expect, it } from "vitest";
import { moduleName, parseOperand, runPairs } from "./silicon-pairs";

describe("operands", () => {
  it("reads hex with 0x, decimal and negative decimal", () => {
    expect(parseOperand("0xFF")).toBe(255);
    expect(parseOperand("0xffffffff")).toBe(4294967295);
    expect(parseOperand("12_345")).toBe(12345);
    expect(parseOperand("-1")).toBe(4294967295);
    expect(parseOperand(" 7 ")).toBe(7);
  });
  it("refuses what is not a 32-bit number", () => {
    for (const t of ["", "ff", "0x", "0x1ffffffff", "4294967296", "-2147483649", "1.5", "abc"]) expect(parseOperand(t)).toBeNull();
  });
  it("finds the module name", () => {
    expect(moduleName("module ss_insn_dot4_s8(input a);")).toBe("dot4_s8");
    expect(moduleName("module other();")).toBeNull();
  });
});

describe("runPairs", () => {
  const req = { name: "x", rtl: "r", cRef: "c", pairs: [[1, 2]] as Array<[number, number]> };
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("returns rows and trace and sends the C reference as c_ref", async () => {
    let sent = "";
    const f = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ ok: true, rows: [[1, 2, 3, 3]], vcd: "v" }));
    }) as unknown as typeof fetch;
    expect(await runPairs(req, f)).toEqual({ rows: [[1, 2, 3, 3]], vcd: "v" });
    expect(JSON.parse(sent)).toEqual({ name: "x", rtl: "r", c_ref: "c", pairs: [[1, 2]] });
  });
  it("turns a refusal into a readable error", async () => {
    await expect(runPairs(req, reply(429, { ok: false, error: { message: "operand-pair limit reached" } }))).rejects.toThrow("operand-pair limit reached");
    await expect(runPairs(req, reply(502, "nope"))).rejects.toThrow("502");
  });
});
