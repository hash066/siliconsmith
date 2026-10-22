import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNdjson } from "./events";
import { libraryEntries, sha256Hex } from "./library";
import { reduceAll } from "./run-state";

const dir = resolve(__dirname, "../public/replays");
const runs = readdirSync(dir)
  .filter((f) => f.endsWith(".ndjson"))
  .map((f) => ({ runId: f.replace(/\.ndjson$/, ""), state: reduceAll(parseNdjson(readFileSync(resolve(dir, f), "utf8")).events) }));

describe("library entries (derived from the real replays)", () => {
  const entries = libraryEntries(runs);
  const by = (m: string) => entries.find((e) => e.mnemonic === m);

  it("lists the instructions that passed L1 to L5, including the headline ones", () => {
    for (const m of ["dot4", "dot4.sum", "xor.rotl12", "chacha.xor.rotl8"]) expect(by(m), m).toBeTruthy();
    for (const e of entries) for (const p of e.proofs) for (const r of ["L1", "L2", "L3", "L4", "L5"]) expect(p.rungs[r]).toBe("pass");
  });

  it("never lists polish nodes or unproven candidates as instructions", () => {
    const mnemonics = entries.map((e) => e.mnemonic);
    expect(new Set(mnemonics).size).toBe(mnemonics.length);
    // mula4.add was proposed in the W1 runs but failed unit checks: it must not appear
    expect(by("mula4.add")).toBeUndefined();
  });

  it("groups the same instruction found in several runs and keeps the best proof first", () => {
    const e = by("dot4.sum")!;
    expect(e.proofs.length).toBeGreaterThan(1);
    expect(e.best.wallSpeedup).toBe(Math.max(...e.proofs.map((p) => p.wallSpeedup)));
    expect(e.proofs.every((p) => p.runId && p.nodeId)).toBe(true);
  });

  it("is sorted by best speedup and carries the spec and the RTL text for hashing", async () => {
    for (let i = 1; i < entries.length; i++) expect(entries[i - 1].best.wallSpeedup).toBeGreaterThanOrEqual(entries[i].best.wallSpeedup);
    const e = by("dot4")!;
    expect(e.semantics_c.length).toBeGreaterThan(10);
    expect(e.rtlText).toBeTruthy();
    expect(await sha256Hex(e.rtlText!)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256Hex matches a known digest", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
