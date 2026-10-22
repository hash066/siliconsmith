// Uses the real Board and Matter logs under lib/__fixtures__ (test only).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allPass, candidates, matterFigures, passCount, rungCell, rungsOf } from "./domain";
import { parseNdjson } from "./events";
import { reduceAll } from "./run-state";

const load = (f: string) => reduceAll(parseNdjson(readFileSync(resolve(__dirname, "__fixtures__", f), "utf8")).events);

describe("domain views", () => {
  const board = load("board-repair-pin_mismatch-1.ndjson");
  const rungs = rungsOf(board);

  it("lists the announced rungs and the design candidates", () => {
    expect(rungs.map((r) => r.id)).toEqual(["B1", "B2", "B3", "B4", "B5"]);
    expect(candidates(board).map((n) => n.id)).toEqual(["n1", "n1.1"]);
  });

  it("shows a failing rung as fail with its detail and no claim, a passing one with its claim and evidence ids", () => {
    const bad = rungCell(board.nodes.n1, rungs[3]);
    expect(bad.status).toBe("fail");
    expect(bad.claim).toBeUndefined();
    expect(bad.detail).toMatch(/GPIO12/);
    expect(bad.evidence).toContain("part:esp32.gpio12.strapping");
    const good = rungCell(board.nodes["n1.1"], rungs[3]);
    expect(good.status).toBe("pass");
    expect(good.claim).toBe("Firmware matches the netlist");
    expect(good.seq).toBeGreaterThan(0);
  });

  it("counts passes without treating unknown as pass", () => {
    expect(passCount(board.nodes.n1, rungs)).toEqual({ pass: 4, total: 5 });
    expect(allPass(board.nodes.n1, rungs)).toBe(false);
    expect(allPass(board.nodes["n1.1"], rungs)).toBe(true);
  });

  it("matter: figures from metrics, rungs M1..M5, skipped rungs are unknown", () => {
    const m = load("m_eval_1.ndjson");
    const mr = rungsOf(m);
    const win = m.nodes[m.best!];
    expect(allPass(win, mr)).toBe(true);
    const f = matterFigures(win);
    expect(f.peakC).toBeGreaterThan(25);
    expect(f.deltaK).toBeGreaterThan(0);
    const n1 = m.nodes.n1;
    expect(rungCell(n1, mr[2]).status).toBe("fail");
    expect(rungCell(n1, mr[3]).status).toBe("unknown");
    expect(rungCell(n1, mr[3]).claim).toBeUndefined();
  });
});
