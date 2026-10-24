import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { internalAt, parseVcd, toHex } from "./vcd";

// written by Verilator in a real run of a two-product instruction on the pairs (1,1), (0x01020304,0x01010101), (0xFFFFFFFF,1)
const vcd = parseVcd(readFileSync(new URL("./__fixtures__/instruction-pairs.vcd", import.meta.url), "utf8"));

describe("vcd", () => {
  it("reads scopes, signals and a column per time stamp", () => {
    expect(vcd).not.toBeNull();
    const names = vcd!.signals.map((s) => `${s.scope.join(".")}:${s.name}:${s.width}`);
    expect(names).toContain("TOP.ss_insn_dot4_s8:p0:16");
    expect(names).toContain("TOP:rd:32");
    expect(vcd!.times.slice(0, 3)).toEqual([0, 10, 20]);
  });

  it("gives the internal signals, not the ports, as hex at each pair", () => {
    const step0 = internalAt(vcd!, 0);
    expect(Object.keys(step0).sort()).toEqual(["p0", "p1", "s"]);
    expect(step0.p0).toBe("0001");
    expect(internalAt(vcd!, 1).s).toBe("00007"); // 17-bit sum of the two lane products for 0x01020304 and 0x01010101
  });

  it("formats values and refuses things that are not a VCD", () => {
    expect(toHex("101", 3)).toBe("5");
    expect(toHex("1111111111111111", 16)).toBe("ffff");
    expect(toHex("1x1", 3)).toBe("1x1");
    expect(parseVcd("")).toBeNull();
    expect(parseVcd("not a vcd")).toBeNull();
    expect(parseVcd(undefined)).toBeNull();
  });
});
