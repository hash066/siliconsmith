import { describe, expect, it } from "vitest";
import { PlainStream, plainText } from "./agent-plain";

describe("plainText", () => {
  it("rewords jargon, keeping capitals", () => {
    expect(plainText("Rung B4 failed; the rungs pass. Each rung is a check.")).toBe("Check B4 failed; the checks pass. Each check is a check.");
    expect(plainText("Check **B4** failed.")).toBe("Check B4 failed.");
    expect(plainText("It is formally proven.")).toBe("It is proved for every possible input.");
    expect(plainText("Formally proved, with a counterexample for the strapping pin.")).toBe("Proved for every possible input, with a failing example for the boot-setting pin.");
  });

  it("removes parenthetical id lists and turns bare ids into words", () => {
    expect(plainText("It failed (board:clean_sensor#B4, part:esp32.gpio12.strapping).")).toBe("It failed.");
    expect(plainText("See matter:rect_fins#M5 and library:dot4-tinymaix, and run:r_w1_final/n1.2.1#wall_speedup.")).toBe("See check M5 and dot4-tinymaix, and candidate n1.2.1.");
  });

  it("is idempotent and leaves ordinary text and commands alone", () => {
    const t = "Quote siliconsmith verify-entry dot4-tinymaix. It was not run.";
    expect(plainText(t)).toBe(t);
    expect(plainText(plainText("Rung B4 (board:x#B4) formally proven"))).toBe(plainText("Rung B4 (board:x#B4) formally proven"));
  });
});

describe("PlainStream", () => {
  const stream = (chunks: string[]) => {
    const p = new PlainStream();
    return chunks.map((c) => p.push(c)).join("") + p.flush();
  };
  const text = "First the board is wired up. Rung B4 failed (board:fault_gpio12_vs_gpio14#B4, part:esp32.gpio12.strapping) because the strapping pin is formally proven wrong. Done.";

  it("gives the same result however the model chunks the text", () => {
    const whole = plainText(text);
    expect(stream([text])).toBe(whole);
    expect(stream(text.split(""))).toBe(whole);
    expect(stream(text.match(/.{1,7}/g)!)).toBe(whole);
    expect(stream(text.match(/.{1,23}/g)!)).toBe(whole);
  });

  it("does not hold a short answer back forever and never emits an unfinished id list", () => {
    const p = new PlainStream();
    const early = p.push("Rung B4 failed (board:fault_gpio12");
    expect(early).not.toMatch(/board:|\(/);
    expect(early + p.push("_vs_gpio14#B4) and so on.") + p.flush()).toBe("Check B4 failed and so on.");
  });
});
