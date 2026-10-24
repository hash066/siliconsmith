import { describe, expect, it } from "vitest";
import { costUsd, Credits, creditsConfigFromEnv, creditStoreFromEnv, kvRestStore, memoryStore, PRICES, type CreditStore } from "./credits";

const cfg = { allowanceUsd: 0.5, poolCapUsd: 25, ipCapUsd: 1.5 };

describe("credit math", () => {
  it("prices tokens at the Token Factory list prices", () => {
    expect(PRICES).toEqual({ ultra: [1, 3], super: [0.3, 0.9], nano: [0.06, 0.24] });
    expect(costUsd("super", 6016, 144)).toBeCloseTo(0.0019344, 9);
    expect(costUsd("ultra", 1_000_000, 1_000_000)).toBe(4);
    expect(costUsd("nano", 0, 0)).toBe(0);
  });

  it("reads limits from env with the documented defaults", () => {
    expect(creditsConfigFromEnv({})).toEqual({ allowanceUsd: 0.5, poolCapUsd: 25, ipCapUsd: 1.5 });
    expect(creditsConfigFromEnv({ AGENT_VISITOR_USD: "1", AGENT_POOL_USD: "10", AGENT_IP_USD: "2" })).toEqual({ allowanceUsd: 1, poolCapUsd: 10, ipCapUsd: 2 });
    expect(creditsConfigFromEnv({ AGENT_POOL_USD: "nope", AGENT_VISITOR_USD: "-1" })).toEqual({ allowanceUsd: 0.5, poolCapUsd: 25, ipCapUsd: 1.5 });
  });
});

describe("allowance, IP backstop and the pool", () => {
  it("lets a visitor spend up to the allowance (their cookie's spend), then refuses and says free tools still work", async () => {
    const c = new Credits(memoryStore(), cfg);
    expect((await c.preflight(0, "1.1.1.1", 0.01)).ok).toBe(true);
    expect((await c.snapshot(0.49, "1.1.1.1")).remainingUsd).toBeCloseTo(0.01, 6);
    const stop = await c.preflight(0.49, "1.1.1.1", 0.02);
    expect(stop).toMatchObject({ ok: false, reason: "allowance" });
    expect(!stop.ok && stop.message).toMatch(/Free tools and replays still work/);
    expect((await c.preflight(0, "2.2.2.2", 0.02)).ok).toBe(true); // another cookie is unaffected
  });

  it("charges only the pool and the IP: the visitor's spend is whatever the cookie says", async () => {
    const c = new Credits(memoryStore(), cfg);
    await c.charge("ip", 0.5);
    const s = await c.snapshot(0, "ip");
    expect(s.spentUsd).toBe(0);
    expect(s.pool.spentUsd).toBeCloseTo(0.5, 6);
  });

  it("stops everyone when the $25 pool is spent, whatever their own allowance", async () => {
    const c = new Credits(memoryStore(), { ...cfg, poolCapUsd: 25 });
    for (let i = 0; i < 50; i++) await c.charge(`ip${i}`, 0.5);
    expect((await c.snapshot(0, "ipf")).pool.spentUsd).toBeCloseTo(25, 6);
    expect(await c.preflight(0, "ipf", 0.001)).toMatchObject({ ok: false, reason: "pool" });
    expect((await c.snapshot(0, "ipf")).remainingUsd).toBe(0);
  });

  it("a turn that would cross the pool cap is refused even if the pool is not yet full", async () => {
    const c = new Credits(memoryStore(), cfg);
    await c.charge("ipa", 24.99);
    expect((await c.preflight(0, "ipb", 0.02)).ok).toBe(false);
    expect((await c.preflight(0, "ipb", 0.005)).ok).toBe(true);
  });

  it("the IP backstop blocks many fresh cookies behind one address", async () => {
    const c = new Credits(memoryStore(), cfg);
    for (let i = 0; i < 3; i++) await c.charge("9.9.9.9", 0.5);
    expect(await c.preflight(0, "9.9.9.9", 0.01)).toMatchObject({ ok: false, reason: "ip" });
    expect((await c.preflight(0, "8.8.8.8", 0.01)).ok).toBe(true);
  });

  it("the IP ledger starts over the next UTC day but the pool does not", async () => {
    let day = "2026-10-23";
    const c = new Credits(memoryStore(), cfg, () => new Date(`${day}T12:00:00Z`));
    await c.charge("ip", 1.5);
    expect((await c.preflight(0, "ip", 0.01)).ok).toBe(false);
    day = "2026-10-24";
    expect((await c.preflight(0, "ip", 0.01)).ok).toBe(true);
    expect((await c.snapshot(0, "ip")).pool.spentUsd).toBeCloseTo(1.5, 6);
  });

  it("a snapshot never reports negative remaining", async () => {
    expect((await new Credits(memoryStore(), cfg).snapshot(0.9, "ip")).remainingUsd).toBe(0);
  });

  it("ignores zero, negative and NaN charges", async () => {
    const c = new Credits(memoryStore(), cfg);
    await c.charge("ip", 0);
    await c.charge("ip", -1);
    await c.charge("ip", Number.NaN);
    expect((await c.snapshot(0, "ip")).pool.spentUsd).toBe(0);
  });

  it("says exactly which scope applies", async () => {
    const mem = await new Credits(memoryStore(), cfg).snapshot(0, "ip");
    expect(mem.scopes).toEqual({ visitor: "exact (signed cookie)", pool: "per server instance, in memory" });
    expect(mem.scope).toBe("your balance is exact; the shared pool is per server instance, in memory until a durable store is added");
    const kv = creditStoreFromEnv({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" }, (async () => Response.json({ result: null })) as unknown as typeof fetch);
    expect((await new Credits(kv, cfg).snapshot(0, "ip")).scope).toBe("your balance is exact; the shared pool is durable (Upstash / Vercel KV)");
  });
});

describe("pluggable store", () => {
  it("memory store keys expire", async () => {
    const s = memoryStore();
    await s.add("k", 1, 0.001);
    await new Promise((r) => setTimeout(r, 10));
    expect(await s.get("k")).toBe(0);
  });

  it("uses Upstash / Vercel KV only when its REST env vars are set, either naming", () => {
    expect(creditStoreFromEnv({}).durable).toBe(false);
    expect(creditStoreFromEnv({ KV_REST_API_URL: "https://x" }).durable).toBe(false);
    expect(creditStoreFromEnv({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" }).durable).toBe(true);
    expect(creditStoreFromEnv({ UPSTASH_REDIS_REST_URL: "https://y", UPSTASH_REDIS_REST_TOKEN: "t" }).scope).toMatch(/durable/);
  });

  it("the REST store sends one JSON command per POST with the bearer token, and parses string results", async () => {
    const sent: Array<{ url: string; auth: string | null; body: unknown[] }> = [];
    const data = new Map<string, number>();
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown[];
      sent.push({ url, auth: new Headers(init.headers).get("authorization"), body });
      if (body[0] === "INCRBYFLOAT") {
        const v = (data.get(String(body[1])) ?? 0) + Number(body[2]);
        data.set(String(body[1]), v);
        return Response.json({ result: String(v) });
      }
      if (body[0] === "GET") return Response.json({ result: data.has(String(body[1])) ? String(data.get(String(body[1]))) : null });
      return Response.json({ result: 1 });
    }) as unknown as typeof fetch;
    const s = kvRestStore("https://kv.example", "secret", fakeFetch);
    expect(await s.get("a")).toBe(0);
    expect(await s.add("a", 0.0123, 3600)).toBeCloseTo(0.0123, 8);
    expect(await s.get("a")).toBeCloseTo(0.0123, 8);
    expect(sent.every((x) => x.auth === "Bearer secret" && x.url === "https://kv.example")).toBe(true);
    expect(sent.map((x) => x.body[0])).toEqual(["GET", "INCRBYFLOAT", "EXPIRE", "GET"]);
  });

  it("fails closed when the durable store is down: no agent turn starts", async () => {
    const down: CreditStore = {
      scope: "durable (Upstash / Vercel KV)",
      durable: true,
      get: async () => {
        throw new Error("down");
      },
      add: async () => {
        throw new Error("down");
      },
    };
    const c = new Credits(down, cfg);
    expect(await c.preflight(0, "ip", 0.01)).toMatchObject({ ok: false, reason: "store", snapshot: null });
    await expect(c.charge("ip", 0.01)).resolves.toBeUndefined();
  });
});
