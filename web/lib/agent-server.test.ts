import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { AgentEvent } from "./agent";
import { configFromEnv, DailyLimiter, pickModel, publicStatus, runAgentTurn } from "./agent-server";
import { fsReplayLoader, runTool, validateArgs } from "./agent-tools";

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
  it("library_search finds verified nodes and returns evidence ids", async () => {
    const r = await runTool("library_search", { query: "dot4" }, loader);
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
    expect(validateArgs("library_search", { query: 5 }).ok).toBe(false);
    expect(validateArgs("library_search", { query: "x", extra: 1 }).ok).toBe(false);
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
