import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseViews } from "@/lib/silicon-views";
import { BeforeAfter, HardwareView, ProofExplainer, WaveView } from "./SiliconViews";

const fx = (n: string) => readFileSync(join(__dirname, "..", "..", "lib", "__fixtures__", n), "utf8");
const views = parseViews(fx("silicon-views-live.json"))!;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("Silicon views (real data from a live run)", () => {
  it("the hardware view draws the real operators and the gate numbers", () => {
    const h = renderToStaticMarkup(<HardwareView views={views} />);
    expect(h).toContain("Circuit of dot4");
    expect(count(h, /×&nbsp;&nbsp;multiply|×  multiply|multiply/g)).toBeGreaterThanOrEqual(4);
    expect(count(h, /add</g)).toBe(3);
    expect(h).toContain(views.gate_total.toLocaleString("en-US"));
    expect(h).toContain(`${views.depth} gates`);
    expect(count(h, /<li /g)).toBe(Object.keys(views.gates).length);
  });
  it("the waveform shows every operand pair and that hardware and C agree", () => {
    const h = renderToStaticMarkup(<WaveView views={views} />);
    expect(h).toContain("agree on every pair");
    expect(count(h, /✓/g)).toBe(views.rows.length);
    expect(count(h, />0000000a</g)).toBeGreaterThanOrEqual(2);
  });
  it("a disagreement is shown as one, not hidden", () => {
    const h = renderToStaticMarkup(<WaveView views={{ ...views, rows: [[1, 1, 5, 6]] }} />);
    expect(h).toContain("differ on some pair");
    expect(h).toContain("✗");
    expect(h).not.toContain("✓");
  });
  it("before and after highlight the line that calls the instruction", () => {
    const h = renderToStaticMarkup(<BeforeAfter before={fx("silicon-original-live.txt")} after={fx("silicon-patched-live.txt")} mnemonic="dot4" />);
    expect(h).toContain("calls dot4");
    expect(count(h, /hw-steel\)_22%/g)).toBeGreaterThanOrEqual(1);
    expect(h).toContain("sum += sptr[i]*kptr[i]");
  });
  it("the proof explainer states that unknown is never a pass", () => {
    expect(renderToStaticMarkup(<ProofExplainer />)).toContain("never pass");
  });
});
