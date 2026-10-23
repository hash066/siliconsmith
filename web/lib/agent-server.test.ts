import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { AgentEvent } from "./agent";
import { configFromEnv, DailyLimiter, pickModel, publicStatus, runAgentTurn } from "./agent-server";
import { fsReplayLoader, runTool, validateArgs } from "./agent-tools";
import { applyAgentEvent, hasUncitedClaim, initialAgentState } from "./agent";
import { fsManifestStore } from "./manifest";

const loader = fsReplayLoader(resolve(__dirname, "../public/replays"));
const cfg = configFromEnv({ NEBIUS_API_KEY: "test-key-not-real" })!;

/** A scripted stand-in for the Token Factory SSE endpoint (test only). */
function sse(...chunks: object[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const collect = async (it: AsyncGenerator<AgentEvent>) => {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

describe("agent tools (real replays)", () => {
  it("run_nodes_search finds verified run nodes and returns evidence ids", async () => {
    const r = await runTool("run_nodes_search", { query: "dot4" }, loader);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.evidence.every((e) => /^run:[\w.-]+\/[\w.]+$/.test(e))).toBe(true);
    }
  });

  it("evidence_get returns the figure, its tool and an evidence id; refuses a node that is not scored", async () => {
    const ok = await runTool("evidence_get", { run_id: "r_w1_contree3", node_id: "n1.2.1", metric: "wall_speedup" }, loader);
    expect(ok.ok && ok.evidence).toEqual(["run:r_w1_contree3/n1.2.1#wall_speedup"]);
    const no = await runTool("evidence_get", { run_id: "r_w1_contree3", node_id: "root", metric: "area" }, loader);
    expect(no.ok).toBe(false);
  });

  it("run_explain_failure reports the prune reason of a pruned node", async () => {
    const r = await runTool("run_explain_failure", { run_id: "r_w1_contree3", node_id: "n2.2.4" }, loader);
    expect(r.ok && r.summary).toMatch(/pruned/);
  });

  it("rejects bad arguments: unknown keys, wrong types, path-like ids, unknown tools", () => {
    expect(validateArgs("evidence_get", { run_id: "../etc/passwd", node_id: "n1", metric: "area" }).ok).toBe(false);
    expect(validateArgs("evidence_get", { run_id: "r", node_id: "n1", metric: "bogus" }).ok).toBe(false);
    expect(validateArgs("run_nodes_search", { query: 5 }).ok).toBe(false);
    expect(validateArgs("run_nodes_search", { query: "x", extra: 1 }).ok).toBe(false);
    expect(validateArgs("run_start", {}).ok).toBe(false);
  });
});

describe("agent server", () => {
  it("is not connected without a key, and never exposes the key in the public status", () => {
    expect(configFromEnv({})).toBeNull();
    expect(publicStatus(null)).toEqual({ connected: false });
    expect(JSON.stringify(publicStatus(cfg))).not.toContain("test-key-not-real");
  });

  it("limits per visitor and globally per day, then resets the next day", () => {
    let day = "2026-10-22";
    const l = new DailyLimiter(2, 3, () => new Date(`${day}T12:00:00Z`));
    expect(l.take("a").ok && l.take("a").ok).toBe(true);
    expect(l.take("a")).toEqual({ ok: false, reason: "visitor" });
    expect(l.take("b").ok).toBe(true);
    expect(l.take("c")).toEqual({ ok: false, reason: "global" });
    day = "2026-10-23";
    expect(l.take("a").ok).toBe(true);
  });

  it("routes diagnosis questions to Ultra, others to Super, and honours a manual choice", () => {
    expect(pickModel("why did n2.2.4 fail?")).toBe("ultra");
    expect(pickModel("list the best instruction")).toBe("super");
    expect(pickModel("why", "nano")).toBe("nano");
  });

  it("runs a tool round then streams the answer, citing only evidence ids the tools returned", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    let n = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push({ body: JSON.parse(String(init.body)) });
      n++;
      if (n === 1)
        return sse(
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "evidence_get", arguments: '{"run_id":"r_w1_contree3",' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"node_id":"n1.2.1","metric":"wall_speedup"}' } }] }, finish_reason: "tool_calls" }] },
        );
      return sse({ choices: [{ delta: { content: "The log records run:r_w1_contree3/n1.2.1#wall_speedup. " } }] }, { choices: [{ delta: { content: "Also run:r_made_up/n9. Again run:r_w1_contree3/n1.2.1." }, finish_reason: "stop" }], usage: { completion_tokens: 40 } });
    }) as unknown as typeof fetch;
    const events = await collect(runAgentTurn({ text: "what is the speedup of n1.2.1?", cfg, loader, turnId: "t1", fetchImpl, runId: "r_w1_contree3" }));
    const types = events.map((e) => e.type);
    expect(types).toEqual(["turn.started", "tool.call", "tool.result", "text.delta", "text.delta", "evidence", "turn.done"]);
    const ev = events.find((e) => e.type === "evidence");
    expect(ev && "ids" in ev && ev.ids).toEqual(["run:r_w1_contree3/n1.2.1#wall_speedup"]);
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ ok: true });
    // native tools are offered on the first call, thinking is off, the key only goes in the header
    expect(calls[0].body.tools).toBeTruthy();
    expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(JSON.stringify(calls[0].body)).not.toContain("test-key-not-real");
  });

  it("turns an invalid tool call into a failed tool result the model can read, not a crash", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return n === 1 ? sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "run_start", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }) : sse({ choices: [{ delta: { content: "I cannot start runs." }, finish_reason: "stop" }] });
    }) as unknown as typeof fetch;
    const events = await collect(runAgentTurn({ text: "start a run", cfg, loader, turnId: "t2", fetchImpl }));
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ ok: false });
    expect(events.at(-1)?.type).toBe("turn.done");
  });

  it("reports an upstream failure by status only", async () => {
    const fetchImpl = (async () => new Response("secret upstream detail", { status: 429 })) as unknown as typeof fetch;
    const events = await collect(runAgentTurn({ text: "hi", cfg, loader, turnId: "t3", fetchImpl }));
    const err = events.at(-1);
    expect(err).toMatchObject({ type: "turn.error" });
    expect(JSON.stringify(err)).not.toContain("secret upstream detail");
  });
});

describe("agent post-checks (scripted model, real library manifests)", () => {
  const manifests = fsManifestStore(resolve(__dirname, "../../evidence"));
  const ask = (answer: string, toolFirst: boolean) => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (toolFirst && n === 1) return sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "library_search", arguments: '{"query":""}' } }] }, finish_reason: "tool_calls" }] });
      return sse({ choices: [{ delta: { content: answer }, finish_reason: "stop" }] });
    }) as unknown as typeof fetch;
    return collect(runAgentTurn({ text: "which library entry is fastest and how do I reproduce it?", cfg, loader, turnId: "g1", fetchImpl, tools: { manifests } }));
  };

  it("library_search shows the model the real entries with their exact reproduce strings", async () => {
    const r = await runTool("library_search", { query: "" }, loader, { manifests });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as Array<{ id: string; reproduce: string; workload: string; speedup: number | null }>;
    expect(data.map((d) => d.id).sort()).toEqual(["dot4-tinymaix", "xor-rotl12-chacha20", "xor-rotl8-chacha20"]);
    for (const d of data) expect(d.reproduce).toBe("siliconsmith verify-entry " + d.id);
    expect(data.every((d) => d.workload.length > 0)).toBe(true);
    expect(r.evidence).toContain("library:dot4-tinymaix");
  });

  it("flags an invented verify-entry command (the production defect) and says what is real", async () => {
    const events = await ask("The fastest is dot4. Reproduce it with: siliconsmith verify-entry run:r_w1_final/n1.1.1", true);
    const flags = events.filter((e) => e.type === "flag");
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: "invented_command" });
    expect("message" in flags[0] && flags[0].message).toContain("dot4-tinymaix");
    expect(events.at(-1)?.type).toBe("turn.done");
  });

  it("does not flag the real command quoted from the tool result", async () => {
    const events = await ask("Use: siliconsmith verify-entry dot4-tinymaix. I did not run it. (library:dot4-tinymaix)", true);
    expect(events.some((e) => e.type === "flag")).toBe(false);
    const ev = events.find((e) => e.type === "evidence");
    expect(ev && "ids" in ev && ev.ids).toEqual(["library:dot4-tinymaix"]);
  });

  it("flags a claim that the command was run", async () => {
    const events = await ask("I ran siliconsmith verify-entry dot4-tinymaix and it passed.", true);
    expect(events.some((e) => e.type === "flag" && e.kind === "claims_run")).toBe(true);
  });

  it("an invented 'proven' claim comes back with no evidence event, so the panel flags it as uncited", async () => {
    const events = await ask("dot4 is formally proven correct on silicon.", false);
    expect(events.some((e) => e.type === "evidence")).toBe(false);
    const state = events.reduce(applyAgentEvent, initialAgentState());
    const msg = state.messages.find((m) => m.role === "assistant")!;
    expect(hasUncitedClaim(msg.text, msg.evidence)).toBe(true);
  });

  it("an id the model made up is not accepted as evidence even if it looks right", async () => {
    const events = await ask("It is proven (library:made-up-entry).", true);
    const ev = events.find((e) => e.type === "evidence");
    expect(ev).toBeUndefined();
  });
});

describe("per-turn usage", () => {
  it("sums tokens over the calls of a turn and prices them at list prices for the model used", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "run_nodes_search", arguments: '{"query":"dot4"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2000, completion_tokens: 100 } });
      return sse({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 2500, completion_tokens: 300 } });
    }) as unknown as typeof fetch;
    const events = await collect(runAgentTurn({ text: "list dot4 nodes", model: "super", cfg, loader, turnId: "u1", fetchImpl }));
    const done = events.at(-1);
    const u = done && done.type === "turn.done" ? done.usage : undefined;
    expect(u).toMatchObject({ calls: 2, tokensIn: 4500, tokensOut: 400 });
    expect(u!.costUsd).toBeCloseTo((4500 * 0.3 + 400 * 0.9) / 1e6, 10);
  });
});
