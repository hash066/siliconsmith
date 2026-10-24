import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseViews } from "@/lib/silicon-views";
import { AgentsPanel, TestPlan, WaveViewer } from "./SiliconStudio";
import { scenariosOf } from "@/lib/silicon-plan";

const views = parseViews(readFileSync(join(__dirname, "..", "..", "lib", "__fixtures__", "silicon-views-live.json"), "utf8"))!;
const u = (calls: number) => ({ calls, tokensIn: calls * 1000, tokensOut: calls * 100, costUsd: calls * 0.01, latencyMs: calls * 1000 });
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("Silicon studio panels", () => {
  it("agents: four cards with the run's own numbers", () => {
    const h = renderToStaticMarkup(<AgentsPanel phase="done" run={{ usage: { total: u(3), byRole: { architect: u(1), implement: u(2) } }, sandboxes: { active: 0, total: 2, succeeded: 2, failed: 0 } }} />);
    expect(count(h, /data-agent=/g)).toBe(4);
    expect(h).toContain("Nemotron 3 Ultra");
    expect(h).toContain("not needed this run"); // triage was never called
    expect(h).toContain("2 succeeded");
  });
  it("test plan: every real scenario listed and passing, with a waveform viewer and an export", () => {
    const h = renderToStaticMarkup(<TestPlan views={views} mnemonic="dot4" />);
    expect(count(h, /data-scenario=/g)).toBe(views.rows.length);
    expect(h).toContain(`${views.rows.length} of ${views.rows.length} scenarios passed`);
    expect(h).toContain('data-testid="wave-viewer"');
    expect(h).toContain('data-testid="plan-export"');
    expect(h).toContain("PASSED");
  });
  it("waveform viewer: variables, transport, cursor readout", () => {
    const list = scenariosOf(views);
    const h = renderToStaticMarkup(<WaveViewer list={list} selected={2} onSelect={() => {}} />);
    expect(h).toContain("t = 3 of " + list.length);
    expect(count(h, /type="checkbox"/g)).toBe(5);
    expect(h).toContain('aria-label="Values at the cursor"');
    expect(h).toContain("0000000a");
  });
});
