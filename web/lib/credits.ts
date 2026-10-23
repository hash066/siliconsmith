// Demo credits, server side. Every agent turn is priced from the model's reported token usage at Token Factory list prices and charged
// to (a) the visitor, keyed by an httpOnly cookie id, with the client IP as a backstop, and (b) one global demo pool with a hard cap.
// Free tools (Board check, Matter simulate, replays) never touch this. The store is pluggable: in memory by default (per server
// instance, which the API says), or Upstash / Vercel KV over plain `fetch` when its REST env vars are set, which makes it durable.

export type PricedModel = "ultra" | "super" | "nano";

/** USD per million tokens, [in, out]. Token Factory list prices used for every estimate in the product. */
export const PRICES: Record<PricedModel, readonly [number, number]> = { ultra: [1, 3], super: [0.3, 0.9], nano: [0.06, 0.24] };

export const costUsd = (model: PricedModel, tokensIn: number, tokensOut: number): number => (tokensIn * PRICES[model][0] + tokensOut * PRICES[model][1]) / 1e6;

export interface CreditsConfig {
  /** Per-visitor allowance per UTC day. */
  allowanceUsd: number;
  /** Global demo pool. A hard stop: when it is spent, no agent turn starts. */
  poolCapUsd: number;
  /** Backstop per client IP per UTC day (several visitors can share one IP, so it is a multiple of the allowance). */
  ipCapUsd: number;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function creditsConfigFromEnv(env: Record<string, string | undefined> = process.env): CreditsConfig {
  const allowanceUsd = num(env.AGENT_VISITOR_USD, 0.5);
  return { allowanceUsd, poolCapUsd: num(env.AGENT_POOL_USD, 25), ipCapUsd: num(env.AGENT_IP_USD, allowanceUsd * 3) };
}

export interface CreditStore {
  /** Current total under `key` (0 if absent). */
  get(key: string): Promise<number>;
  /** Adds `amount` and returns the new total. `ttlS` expires the key (best effort); omit for none. */
  add(key: string, amount: number, ttlS?: number): Promise<number>;
  /** Honest description for the UI. */
  readonly scope: string;
  readonly durable: boolean;
}

export function memoryStore(): CreditStore {
  const m = new Map<string, { v: number; exp: number }>();
  const live = (k: string) => {
    const e = m.get(k);
    if (e && e.exp !== 0 && e.exp < Date.now()) {
      m.delete(k);
      return undefined;
    }
    return e;
  };
  return {
    scope: "per server instance, in memory",
    durable: false,
    async get(k) {
      return live(k)?.v ?? 0;
    },
    async add(k, amount, ttlS) {
      const e = live(k);
      const v = (e?.v ?? 0) + amount;
      m.set(k, { v, exp: e?.exp ?? (ttlS ? Date.now() + ttlS * 1000 : 0) });
      return v;
    },
  };
}

/** Upstash Redis / Vercel KV REST API: one JSON command per POST. No dependency. */
export function kvRestStore(url: string, token: string, fetchImpl: typeof fetch = fetch): CreditStore {
  const cmd = async (args: Array<string | number>): Promise<unknown> => {
    const res = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args), cache: "no-store" });
    if (!res.ok) throw new Error(`credit store answered ${res.status}`);
    const j = (await res.json()) as { result?: unknown; error?: string };
    if (j.error) throw new Error("credit store error");
    return j.result;
  };
  return {
    scope: "durable (Upstash / Vercel KV)",
    durable: true,
    async get(k) {
      const r = await cmd(["GET", k]);
      const n = r === null || r === undefined ? 0 : Number(r);
      return Number.isFinite(n) ? n : 0;
    },
    async add(k, amount, ttlS) {
      const r = Number(await cmd(["INCRBYFLOAT", k, amount.toFixed(8)]));
      if (ttlS) await cmd(["EXPIRE", k, ttlS]).catch(() => undefined);
      return Number.isFinite(r) ? r : 0;
    },
  };
}

/** Durable store only when its REST env vars are present; otherwise memory. */
export function creditStoreFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): CreditStore {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? kvRestStore(url, token, fetchImpl) : memoryStore();
}

export interface CreditsSnapshot {
  allowanceUsd: number;
  spentUsd: number;
  remainingUsd: number;
  pool: { capUsd: number; spentUsd: number };
  /** One honest line covering both scopes (see `scopes`). */
  scope: string;
  /** Where each number is kept, and how far to trust it. */
  scopes: { visitor: string; pool: string };
}

export type Preflight = { ok: true; snapshot: CreditsSnapshot } | { ok: false; reason: "allowance" | "ip" | "pool" | "store"; message: string; snapshot: CreditsSnapshot | null };

const DAY_S = 36 * 3600;
/** The visitor's own balance is exact because it lives in a signed cookie (lib/credits-cookie.ts), whichever instance serves the request. */
export const VISITOR_SCOPE = "exact (signed cookie)";

/**
 * The server-side half of the demo credits: the shared pool and the per-IP backstop, kept in the store. The visitor's own spend is NOT
 * here: callers pass it in from the verified cookie. With the in-memory store the pool and IP numbers are per server instance.
 */
export class Credits {
  constructor(
    private store: CreditStore,
    readonly cfg: CreditsConfig,
    private now: () => Date = () => new Date(),
  ) {}

  private keys(ip: string) {
    const day = this.now().toISOString().slice(0, 10);
    return { ip: `cr:ip:${day}:${ip}`, pool: "cr:pool" };
  }

  readonly scopes = (): { visitor: string; pool: string } => ({ visitor: VISITOR_SCOPE, pool: this.store.scope });

  private describeScope() {
    const sc = this.scopes();
    return sc.pool.startsWith("durable") ? `your balance is exact; the shared pool is ${sc.pool}` : `your balance is exact; the shared pool is ${sc.pool} until a durable store is added`;
  }

  async snapshot(visitorSpentUsd: number, ip: string): Promise<CreditsSnapshot> {
    void ip;
    const pool = await this.store.get("cr:pool");
    return {
      allowanceUsd: this.cfg.allowanceUsd,
      spentUsd: round(visitorSpentUsd),
      remainingUsd: round(Math.max(0, Math.min(this.cfg.allowanceUsd - visitorSpentUsd, this.cfg.poolCapUsd - pool))),
      pool: { capUsd: this.cfg.poolCapUsd, spentUsd: round(pool) },
      scope: this.describeScope(),
      scopes: this.scopes(),
    };
  }

  /** Before spending: is there room for `needUsd` for this visitor (cookie spend), this IP and the pool? Fails closed if the store is down. */
  async preflight(visitorSpentUsd: number, ip: string, needUsd: number): Promise<Preflight> {
    let snap: CreditsSnapshot;
    let ipSpent: number;
    try {
      snap = await this.snapshot(visitorSpentUsd, ip);
      ipSpent = await this.store.get(this.keys(ip).ip);
    } catch {
      return { ok: false, reason: "store", message: "The credit store is unavailable, so agent turns are paused. Free tools and replays still work.", snapshot: null };
    }
    if (snap.pool.spentUsd + needUsd > snap.pool.capUsd)
      return { ok: false, reason: "pool", message: `The shared demo pool ($${snap.pool.capUsd}) is used up. Free tools and replays still work.`, snapshot: snap };
    if (snap.spentUsd + needUsd > snap.allowanceUsd)
      return { ok: false, reason: "allowance", message: `Your demo credits for today ($${snap.allowanceUsd.toFixed(2)}) are used up. Free tools and replays still work.`, snapshot: snap };
    if (ipSpent + needUsd > this.cfg.ipCapUsd)
      return { ok: false, reason: "ip", message: "This network has used its daily share of demo credits. Free tools and replays still work.", snapshot: snap };
    return { ok: true, snapshot: snap };
  }

  /** After a turn: charge the real cost to the IP and the pool. Never throws (a store failure must not lose the answer). */
  async charge(ip: string, usd: number): Promise<void> {
    if (!(usd > 0)) return;
    const k = this.keys(ip);
    await Promise.all([this.store.add(k.ip, usd, DAY_S), this.store.add(k.pool, usd)]).catch(() => undefined);
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Worst-case cost of one model call: the prompt we expect plus the whole output cap. Used to decide whether a turn may start. */
export function estimateCallUsd(model: PricedModel, promptTokens: number, maxOutTokens: number): number {
  return costUsd(model, promptTokens, maxOutTokens);
}
