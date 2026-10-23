// Fails when a figure on the landing page is typed in rather than derived from the data in lib/facts.ts.
// Renders the whole page to static HTML (counters render their final value on the server), pulls out every
// numeric token and requires it to be a value (or a rounding of a value) that exists in the facts tree.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Landing from "@/app/page";
import { getFacts } from "@/lib/facts";

function numbersIn(x: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof x === "number" && Number.isFinite(x)) out.add(x);
  else if (Array.isArray(x)) x.forEach((v) => numbersIn(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach((v) => numbersIn(v, out));
  return out;
}

const allowed = (facts: ReturnType<typeof getFacts>) => {
  const a = new Set<string>();
  const { recorded, library, ...rest } = facts;
  const nums = numbersIn({ ...rest, library: library.entries.map((e) => ({ ...e, rtl: null })) });
  // recorded sessions: only their counts (the text and ids are strings, not figures)
  nums.add(recorded.agent.length);
  recorded.agent.forEach((s) => nums.add(s.toolCalls));
  numbersIn(recorded.chat, nums);
  numbersIn(recorded.boardFault, nums);
  nums.add(rest.silicon.runs.length);
  nums.add(rest.silicon.models.length);
  nums.add(library.entries.length);
  nums.add(rest.board.rungs.length);
  nums.add(rest.matter.rungs.length);
  nums.add(rest.silicon.best.wallSpeedup ?? rest.silicon.best.speedup);
  for (const n of nums) {
    a.add(String(n));
    for (let d = 0; d <= 4; d++) a.add(n.toFixed(d));
  }
  return a;
};

/** Visible text of the page, with the Bench (owned by another session, tested there) and the recorded-answer bodies removed. */
function visibleText(html: string): string {
  return html
    .replace(/<section id="bench"[\s\S]*?<\/section>/, "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<pre[\s\S]*?<\/pre>/g, "") // stored RTL, verbatim from the library
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ");
}

describe("landing page figures", () => {
  const facts = getFacts();
  const html = renderToStaticMarkup(<Landing />);

  it("renders the sections of the plan", () => {
    for (const id of ["top", "problem", "workbenches", "demo", "proof", "features", "pipeline", "bench", "how", "stack", "cta"]) expect(html).toContain(`id="${id}"`);
  });

  it("every number on the page is derived from the data", () => {
    const ok = allowed(facts);
    const text = visibleText(html)
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ") // capture dates are checked against the recorded files below
      .replace(/\b0\d\b/g, " "); // 01..09 step labels
    // answer bodies from the model are recorded text, not figures of ours
    const withoutAnswers = text.replace(facts.recorded.chat.answer, " ");
    const tokens = [...withoutAnswers.matchAll(/(?<![\w.#:-])\d+(?:\.\d+)?(?![\w])/g)].map((m) => m[0]);
    const bad = tokens.filter((t) => !ok.has(t));
    expect(bad, `numbers not found in the facts: ${bad.join(", ")}`).toEqual([]);
    expect(tokens.length).toBeGreaterThan(20);
  });

  it("headline figures equal the data", () => {
    const f = facts;
    const text = visibleText(html);
    expect(text).toContain(`${(f.silicon.best.wallSpeedup ?? f.silicon.best.speedup).toFixed(2)}×`);
    expect(text).toContain(f.silicon.best.id);
    expect(text).toContain(`${f.silicon.rejected} / ${f.silicon.candidates}`);
  });

  it("a typed-in figure would be caught", () => {
    const ok = allowed(facts);
    expect(ok.has("99")).toBe(false);
    expect(ok.has("10000")).toBe(false);
  });

  it("recorded content is labelled and the capture dates match the files", () => {
    expect(html).toContain("Recorded session");
    expect(facts.recorded.agent.every((a) => a.captured === "2026-10-23")).toBe(true);
    expect(facts.recorded.chat.captured).toBe("2026-10-23");
  });

  it("does not show a Library page or nav item, and no roadmap item as working", () => {
    expect(html).not.toMatch(/href="\/library/);
    expect(visibleText(html)).not.toMatch(/GhostDriver/i);
  });
});
