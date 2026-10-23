import { describe, expect, it } from "vitest";
import { guardNumbers, guardText, verifyEntryIds } from "./agent-guard";

const IDS = ["dot4-tinymaix", "xor-rotl12-chacha20", "xor-rotl8-chacha20"];

describe("verify-entry command guard", () => {
  it("accepts the exact commands of real entries, in code spans and sentences", () => {
    expect(guardText("Run `siliconsmith verify-entry dot4-tinymaix`.", IDS)).toEqual([]);
    expect(guardText("Use siliconsmith verify-entry xor-rotl8-chacha20, then compare.", IDS)).toEqual([]);
  });

  it("flags the invented command seen in production, naming the real entries", () => {
    const f = guardText("To reproduce: `siliconsmith verify-entry run:r_w1_final/n1.1.1`", IDS);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("invented_command");
    expect(f[0].message).toContain("run:r_w1_final/n1.1.1");
    expect(f[0].message).toContain("dot4-tinymaix");
  });

  it("flags a near-miss id and each invented id once", () => {
    const f = guardText("siliconsmith verify-entry dot4 ... again siliconsmith verify-entry dot4 and siliconsmith verify-entry w1-final", IDS);
    expect(f.map((x) => x.kind)).toEqual(["invented_command", "invented_command"]);
  });

  it("says so when no entries are installed", () => {
    expect(guardText("siliconsmith verify-entry dot4-tinymaix", [])[0].message).toContain("No library entries are installed");
  });

  it("flags an answer that claims the command was run", () => {
    for (const t of ["I ran siliconsmith verify-entry dot4-tinymaix and it passed.", "We re-verified the library entry for you.", "siliconsmith verify-entry dot4-tinymaix passed on my side"])
      expect(guardText(t, IDS).some((f) => f.kind === "claims_run"), t).toBe(true);
    expect(guardText("The command re-runs lint and the proof. I did not run it.", IDS)).toEqual([]);
  });

  it("extracts ids without trailing punctuation", () => {
    expect(verifyEntryIds("a `siliconsmith verify-entry abc-1`. b siliconsmith verify-entry def.")).toEqual(["abc-1", "def"]);
  });
});

describe("guardNumbers", () => {
  const src = ["A heat sink for a 5 W chip, under 70 C.", 'rect_fins: peak 68.4 C {"peak_temp_c":68.43}'];
  it("accepts temperatures the user wrote or a tool returned, to rounding", () => {
    expect(guardNumbers("It peaks at 68.4 °C, under your 70 C target, about 68 C.", src)).toEqual([]);
  });
  it("flags a temperature nothing returned", () => {
    const f = guardNumbers("In still air it reaches about 288°C.", src);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "invented_number", message: expect.stringContaining("288 °C") });
  });
  it("ignores numbers that are not temperatures", () => {
    expect(guardNumbers("It uses 40 mm, 5 W and 1.3 times the material.", src)).toEqual([]);
  });
});
