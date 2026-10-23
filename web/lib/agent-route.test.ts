// The /api/agent and /api/credits routes end to end with a scripted upstream model: cookies, credit preflight and charging, the pool hard stop,
// allowance exhaustion, input validation and the confirm-only rule for loops. No network, no key.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as creditsGet, POST as creditsPost } from "@/app/api/credits/route";
import { GET as agentGet, POST } from "@/app/api/agent/route";
import type { AgentEvent } from "./agent";
import { Credits, memoryStore, type CreditStore } from "./credits";
import { dayOf, deriveKey, readState, signState } from "./credits-cookie";
import { setCreditsForTest } from "./credits-server";

const sse = (...chunks: object[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200 });
const SUPER_REPLY = () => sse({ choices: [{ delta: { content: "Hello from the model." }, finish_reason: "stop" }], usage: { prompt_tokens: 6000, completion_tokens: 150 } });
const SUPER_COST = (6000 * 0.3 + 150 * 0.9) / 1e6;

let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.NEBIUS_API_KEY = ["test", "key", "not", "real"].join("-"); // a dummy, not a secret
  upstream = vi.fn(async () => SUPER_REPLY());
  vi.stubGlobal("fetch", upstream);
  setCreditsForTest(new Credits(memoryStore(), { allowanceUsd: 0.5, poolCapUsd: 25, ipCapUsd: 1.5 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  setCreditsForTest(null);
  delete process.env.NEBIUS_API_KEY;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://localhost:3000/api/agent", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const events = async (res: Response): Promise<AgentEvent[]> => (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentEvent);
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const KEY = () => deriveKey(process.env.NEBIUS_API_KEY);
const stateIn = async (res: Response) => readState(await KEY(), (res.headers.get("set-cookie") ?? "").split(";")[0].split("=").slice(1).join("="), new Date());
const settle = (receipt: string, cookie: string) => creditsPost(new NextRequest("http://localhost:3000/api/credits", { method: "POST", headers: { cookie, "content-type": "application/json", "x-forwarded-for": "7.7.7.7" }, body: JSON.stringify({ receipt }) }));
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const credits = async (cookie: string) => (await creditsGet(new NextRequest("http://localhost:3000/api/credits", { headers: { cookie, "x-forwarded-for": "7.7.7.7" } }))).json();

describe("/api/agent: connection, cookie and input validation", () => {
  it("is not connected without a key (503) and GET says so", async () => {
    delete process.env.NEBIUS_API_KEY;
    expect((await post({ text: "hi" })).status).toBe(503);
    expect(await (await agentGet()).json()).toEqual({ connected: false });
  });

  it("issues an httpOnly signed credits cookie on a fresh visit and treats a forged one as a fresh allowance", async () => {
    const first = await post({ text: "which entries are in the library?", workbench: "silicon" });
    const set = first.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^hw_credits=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).not.toContain(process.env.NEBIUS_API_KEY!);
    const forgedCookie = "hw_credits=eyJ2IjoiYSIsInMiOjB9.AAAA";
    const forged = await post({ text: "hello" }, { cookie: forgedCookie });
    expect((await stateIn(forged))?.v).not.toBe("a"); // a new visitor id, not the forged one
    const c = await credits(forgedCookie);
    expect(c.spentUsd).toBe(0);
    expect(c.remainingUsd).toBe(0.5);
  });

  it("rejects bad input with a plain 400 and calls no model", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post([1, 2])).status).toBe(400);
    expect((await post({ text: "   " })).status).toBe(400);
    expect((await post({ text: "x".repeat(1300) })).status).toBe(400);
    expect((await post({ text: "hi", action: { tool: "board_design", args: { brief: "x" } } })).status).toBe(400); // a loop only with confirm: true
    expect((await post({ confirm: true, action: { tool: "rm_rf", args: {} } })).status).toBe(400);
    expect((await post({ confirm: true, action: { tool: "board_design", args: {} } })).status).toBe(400);
    expect((await post({ confirm: true, action: { tool: "board_design", args: { brief: "x".repeat(600) } } })).status).toBe(400);
    expect((await post({ confirm: true, action: { tool: "matter_optimize", args: { generator: "plasma" } } })).status).toBe(400);
    expect((await post({ confirm: true })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("/api/agent: credits", () => {
  it("reserves the estimate in the cookie, ends the stream with a signed receipt, and the balance drops by the real cost", async () => {
    const res = await post({ text: "simulate 10 fins", workbench: "matter" });
    const cookie = cookieOf(res);
    const ev = await events(res);
    const cost = ev.filter((e) => e.type === "cost") as Array<Extract<AgentEvent, { type: "cost" }>>;
    expect(cost).toHaveLength(1);
    expect(cost[0].usd).toBeCloseTo(SUPER_COST, 10);
    const last = ev[ev.length - 1] as Extract<AgentEvent, { type: "credits" }>;
    expect(last.type).toBe("credits");
    expect(last.snapshot.spentUsd).toBeCloseTo(SUPER_COST, 6);
    expect(last.snapshot.remainingUsd).toBeCloseTo(0.5 - SUPER_COST, 6);
    // until the receipt is claimed the cookie holds the larger reservation: it only ever overpays
    expect((await credits(cookie)).spentUsd).toBeGreaterThan(SUPER_COST);
    const claimed = await settle(last.receipt, cookie);
    expect(claimed.status).toBe(200);
    expect(((await claimed.json()) as { spentUsd: number }).spentUsd).toBeCloseTo(SUPER_COST, 6);
    const settled = cookieFrom(claimed);
    const c = await credits(settled);
    expect(c.spentUsd).toBeCloseTo(SUPER_COST, 6);
    expect(c.pool.spentUsd).toBeCloseTo(SUPER_COST, 6);
    expect(c.remainingUsd).toBeCloseTo(0.5 - SUPER_COST, 6);
    expect(c.allowanceUsd).toBe(0.5);
    expect(c.pool.capUsd).toBe(25);
    expect(c.scope).toBe("your balance is exact; the shared pool is per server instance, in memory until a durable store is added");
    // a replayed receipt cannot lower it again, and a forged one is refused
    expect((await settle(last.receipt, settled)).status).toBe(400);
    expect((await settle("x.y", settled)).status).toBe(400);
  });

  it("the balance keeps falling across two turns, even when another instance (empty memory) serves the second", async () => {
    const t1 = await post({ text: "simulate 10 fins", workbench: "matter" });
    const e1 = (await events(t1)).pop() as Extract<AgentEvent, { type: "credits" }>;
    const cookie1 = cookieFrom(await settle(e1.receipt, cookieOf(t1)));
    setCreditsForTest(new Credits(memoryStore(), { allowanceUsd: 0.5, poolCapUsd: 25, ipCapUsd: 1.5 })); // another serverless instance
    const t2 = await post({ text: "simulate 12 fins", workbench: "matter" }, { cookie: cookie1 });
    const e2 = (await events(t2)).pop() as Extract<AgentEvent, { type: "credits" }>;
    expect(e2.snapshot.spentUsd).toBeCloseTo(2 * SUPER_COST, 6);
    expect(e2.snapshot.remainingUsd).toBeLessThan(e1.snapshot.remainingUsd);
    const cookie2 = cookieFrom(await settle(e2.receipt, cookieOf(t2)));
    expect((await credits(cookie2)).spentUsd).toBeCloseTo(2 * SUPER_COST, 6);
  });

  it("an exhausted cookie is refused by an instance that has never seen the visitor", async () => {
    const spent = await signState(await KEY(), { v: "11111111-2222-3333-4444-555555555555", d: dayOf(new Date()), s: 0.499 });
    const res = await post({ text: "simulate 10 fins" }, { cookie: `hw_credits=${spent}` });
    expect(res.status).toBe(402);
    expect((await res.json()).reason).toBe("allowance");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses with 402 and calls no model when the visitor's allowance is used up; free tools are named as still working", async () => {
    const credits_ = new Credits(memoryStore(), { allowanceUsd: 0.001, poolCapUsd: 25, ipCapUsd: 5 });
    setCreditsForTest(credits_);
    const res = await post({ text: "simulate 10 fins" });
    expect(res.status).toBe(402);
    const j = await res.json();
    expect(j).toMatchObject({ error: "credits", reason: "allowance" });
    expect(j.message).toMatch(/Free tools and replays still work/);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("the pool is a hard stop for everyone", async () => {
    const store = memoryStore();
    const c = new Credits(store, { allowanceUsd: 0.5, poolCapUsd: 0.002, ipCapUsd: 5 });
    setCreditsForTest(c);
    const res = await post({ text: "simulate 10 fins" });
    expect(res.status).toBe(402);
    expect((await res.json()).reason).toBe("pool");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("many fresh cookies behind one IP hit the IP backstop", async () => {
    const c = new Credits(memoryStore(), { allowanceUsd: 0.5, poolCapUsd: 25, ipCapUsd: 0.004 });
    setCreditsForTest(c);
    expect((await post({ text: "simulate" })).status).toBe(200); // worst-case estimate for Super is about $0.0035
    await c.charge("7.7.7.7", 0.004);
    const blocked = await post({ text: "simulate" });
    expect(blocked.status).toBe(402);
    expect((await blocked.json()).reason).toBe("ip");
  });

  it("a confirmed loop needs the full $0.05 cap in credits; a cheap turn still works with less", async () => {
    const c = new Credits(memoryStore(), { allowanceUsd: 0.04, poolCapUsd: 25, ipCapUsd: 5 });
    setCreditsForTest(c);
    const loop = await post({ confirm: true, action: { tool: "matter_optimize", args: { generator: "rect_fins" } } });
    expect(loop.status).toBe(402);
    expect((await loop.json()).reason).toBe("allowance");
    expect((await post({ text: "simulate" })).status).toBe(200);
  });

  it("fails closed when the credit store is down: no agent turn, and the message says free tools still work", async () => {
    const down: CreditStore = { scope: "durable (Upstash / Vercel KV)", durable: true, get: async () => { throw new Error("down"); }, add: async () => { throw new Error("down"); } };
    setCreditsForTest(new Credits(down, { allowanceUsd: 0.5, poolCapUsd: 25, ipCapUsd: 5 }));
    const res = await post({ text: "hi" });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "store", message: expect.stringContaining("Free tools and replays still work") });
    expect(upstream).not.toHaveBeenCalled();
    const c = await creditsGet(new NextRequest("http://localhost:3000/api/credits"));
    expect(c.status).toBe(503);
  });

  it("a confirmed Matter loop runs, streams cost events and charges them", async () => {
    // the route calls the hosted simulator on its own origin with global fetch: script both the model and the simulator
    const sim = (peak: number) =>
      new Response(JSON.stringify({ ok: true, ladder: ["M1", "M2", "M3", "M4", "M5"].map((id) => ({ id, status: id === "M5" ? "fail" : "pass" })), metrics: { peak_temp_c: peak, peak_rise_k: peak - 25, material_cells: 1, material_fraction: 0.3, heat_balance_rel: 0 }, baselines: { equal_material: { peak_temp_c: 80 }, full_budget: { peak_temp_c: 72 } }, verdict: null }), { status: 200 });
    let n = 0;
    upstream.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/matter/simulate")) return sim(82 - n++);
      return new Response(JSON.stringify({ choices: [{ message: { content: n < 2 ? '{"gen_params":{"spine":8,"n_fins":' + (9 + n) + ',"fin_w":3,"fin_len":16}}' : "x" } }], usage: { prompt_tokens: 700, completion_tokens: 40 } }), { status: 200 });
    });
    const res = await post({ confirm: true, action: { tool: "matter_optimize", args: { generator: "rect_fins" } } });
    expect(res.status).toBe(200);
    const ev = await events(res);
    expect(ev.some((e) => e.type === "ui.action")).toBe(true);
    const total = (ev.filter((e) => e.type === "cost") as Array<Extract<AgentEvent, { type: "cost" }>>).reduce((s, e) => s + e.usd, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(0.05);
    const last = ev[ev.length - 1] as Extract<AgentEvent, { type: "credits" }>;
    expect(last.type).toBe("credits");
    expect(last.snapshot.spentUsd).toBeCloseTo(total, 8);
    expect(last.snapshot.pool.spentUsd).toBeCloseTo(total, 8);
  });
});
