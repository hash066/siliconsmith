import { describe, expect, it } from "vitest";
import { Credits, memoryStore } from "./credits";
import { CREDITS_COOKIE, claimReceipt, cookieAttrs, dayOf, deriveKey, readState, signReceipt, signState, stateOrFresh } from "./credits-cookie";

const NOW = new Date("2026-10-23T12:00:00Z");
const secret = ["not", "a", "real", "secret"].join("-");
const id = "11111111-2222-3333-4444-555555555555";

describe("signed credits cookie", () => {
  it("round-trips a visitor's state", async () => {
    const key = await deriveKey(secret);
    const token = await signState(key, { v: id, d: dayOf(NOW), s: 0.0123 });
    expect(await readState(key, token, NOW)).toEqual({ v: id, d: "2026-10-23", s: 0.0123 });
    const { state, fresh } = await stateOrFresh(key, token, NOW);
    expect(fresh).toBe(false);
    expect(state.s).toBe(0.0123);
  });

  it("starts a fresh allowance for a missing, tampered, forged or malformed cookie", async () => {
    const key = await deriveKey(secret);
    const token = await signState(key, { v: id, d: dayOf(NOW), s: 0.4 });
    const [body, sig] = token.split(".");
    const lowered = btoa(JSON.stringify({ v: id, d: dayOf(NOW), s: 0 })).replace(/=+$/, "");
    for (const bad of [null, "", "garbage", `${lowered}.${sig}`, `${body}.${sig.slice(0, -2)}AA`, `${body}.`, "a.b.c", token + "x".repeat(700)]) {
      const r = await stateOrFresh(key, bad, NOW);
      expect(r.fresh).toBe(true);
      expect(r.state).toMatchObject({ s: 0, d: "2026-10-23" });
    }
    // signed with another deployment's key
    const other = await signState(await deriveKey("someone-else"), { v: id, d: dayOf(NOW), s: 0 });
    expect(await readState(key, other, NOW)).toBeNull();
    // a state token is not a receipt, and a receipt is not a state
    const rec = await signReceipt(key, { v: id, d: dayOf(NOW), from: 0.4, to: 0 });
    expect(await readState(key, rec, NOW)).toBeNull();
    expect(await claimReceipt(key, token, { v: id, d: dayOf(NOW), s: 0.4 }, NOW)).toBeNull();
  });

  it("expires with the UTC day: yesterday's cookie gives a fresh allowance today", async () => {
    const key = await deriveKey(secret);
    const token = await signState(key, { v: id, d: "2026-10-22", s: 0.5 });
    expect(await readState(key, token, NOW)).toBeNull();
    expect((await stateOrFresh(key, token, NOW)).state.s).toBe(0);
    expect(await readState(key, token, new Date("2026-10-22T23:59:59Z"))).toMatchObject({ s: 0.5 });
  });

  it("rejects out-of-range values even when signed", async () => {
    const key = await deriveKey(secret);
    for (const s of [-1, 5000, Number.NaN]) expect(await readState(key, await signState(key, { v: id, d: dayOf(NOW), s }), NOW)).toBeNull();
    expect(await readState(key, await signState(key, { v: "../../x", d: dayOf(NOW), s: 0 }), NOW)).toBeNull();
  });

  it("a receipt lowers the reserved spend to the real cost, once", async () => {
    const key = await deriveKey(secret);
    const cur = { v: id, d: dayOf(NOW), s: 0.0035 };
    const rec = await signReceipt(key, { v: id, d: dayOf(NOW), from: 0.0035, to: 0.0019 });
    expect(await claimReceipt(key, rec, cur, NOW)).toEqual({ v: id, d: dayOf(NOW), s: 0.0019 });
    // replay against the balance it already lowered: refused
    expect(await claimReceipt(key, rec, { ...cur, s: 0.0019 }, NOW)).toBeNull();
    // against a balance that has moved on (a later turn reserved more): refused
    expect(await claimReceipt(key, rec, { ...cur, s: 0.0105 }, NOW)).toBeNull();
  });

  it("a receipt cannot raise a balance, move to another visitor or day, or be forged", async () => {
    const key = await deriveKey(secret);
    const cur = { v: id, d: dayOf(NOW), s: 0.01 };
    expect(await claimReceipt(key, await signReceipt(key, { v: id, d: dayOf(NOW), from: 0.01, to: 0.5 }), cur, NOW)).toBeNull();
    expect(await claimReceipt(key, await signReceipt(key, { v: "99999999-2222-3333-4444-555555555555", d: dayOf(NOW), from: 0.01, to: 0 }), cur, NOW)).toBeNull();
    expect(await claimReceipt(key, await signReceipt(key, { v: id, d: "2026-10-22", from: 0.01, to: 0 }), cur, NOW)).toBeNull();
    const other = await deriveKey("other");
    expect(await claimReceipt(key, await signReceipt(other, { v: id, d: dayOf(NOW), from: 0.01, to: 0 }), cur, NOW)).toBeNull();
  });

  it("the cookie is httpOnly and SameSite=Lax, Secure on https, and carries no readable secret", async () => {
    const key = await deriveKey(secret);
    const token = await signState(key, { v: id, d: dayOf(NOW), s: 0 });
    const http = cookieAttrs(token, false);
    expect(http).toMatch(new RegExp(`^${CREDITS_COOKIE}=`));
    expect(http).toContain("HttpOnly");
    expect(http).toContain("SameSite=Lax");
    expect(http).not.toContain("Secure");
    expect(cookieAttrs(token, true)).toContain("Secure");
    expect(http).not.toContain(secret);
  });

  it("two simulated instances that share nothing but the cookie agree on the balance", async () => {
    const cfg = { allowanceUsd: 0.5, poolCapUsd: 25, ipCapUsd: 5 };
    const a = new Credits(memoryStore(), cfg);
    const b = new Credits(memoryStore(), cfg); // a different lambda: its own empty memory
    const token = await signState(await deriveKey(secret), { v: id, d: dayOf(NOW), s: 0.42 });
    const sa = (await stateOrFresh(await deriveKey(secret), token, NOW)).state.s; // both derive the same key from the same env secret
    const sb = (await stateOrFresh(await deriveKey(secret), token, NOW)).state.s;
    expect(sa).toBe(sb);
    expect((await a.snapshot(sa, "ip")).remainingUsd).toBeCloseTo(0.08, 6);
    expect((await b.snapshot(sb, "ip")).remainingUsd).toBeCloseTo(0.08, 6);
    expect(await b.preflight(sb, "ip", 0.1)).toMatchObject({ ok: false, reason: "allowance" });
    // the pool, in memory, is the part that is per instance
    await a.charge("ip", 1);
    expect((await a.snapshot(sa, "ip")).pool.spentUsd).toBe(1);
    expect((await b.snapshot(sb, "ip")).pool.spentUsd).toBe(0);
  });
});
