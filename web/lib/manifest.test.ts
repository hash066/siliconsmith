// Reads the real evidence library at the repo root (evidence/).
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fsManifestStore, parseManifest, reproduceMatches } from "./manifest";

const store = fsManifestStore(resolve(__dirname, "../../evidence"));

describe("evidence library manifests (real files)", () => {
  it("lists the stored entries and parses every manifest", async () => {
    const ids = await store.ids();
    expect(ids).toEqual(expect.arrayContaining(["dot4-tinymaix", "xor-rotl12-chacha20", "xor-rotl8-chacha20"]));
    for (const id of ids) {
      const m = await store.get(id);
      expect(m, id).not.toBeNull();
      expect(m!.artifacts.length).toBeGreaterThan(0);
      expect(reproduceMatches(m!)).toBe(true);
      expect(Object.keys(m!.tools).length).toBeGreaterThan(0);
      expect(m!.not_claimed.length).toBeGreaterThan(0);
    }
  });

  it("keeps the ladder honest: L6 (real silicon) is not claimed", async () => {
    const m = (await store.get("dot4-tinymaix"))!;
    expect(m.ladder.L6).toBe("skipped");
    expect(m.not_claimed.join(" ")).toMatch(/silicon/);
  });

  it("rejects an unknown id, a path-like id and a malformed manifest", async () => {
    expect(await store.get("nope")).toBeNull();
    expect(await store.get("../index")).toBeNull();
    expect(parseManifest({ schema: 1, id: "x" })).toBeNull();
    expect(parseManifest({ schema: 2 })).toBeNull();
  });
});
