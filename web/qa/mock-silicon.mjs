// TEST-ONLY stand-in for the live Silicon endpoint (POST /api/silicon/run) until the real one is hosted. It is never part of the app:
// the events are real ones cut from a recorded run (public/replays/r_w1_contree3.ndjson), one candidate's worth, streamed with delays.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPLAY = fileURLToPath(new URL("../public/replays/r_w1_contree3.ndjson", import.meta.url));

export function mockEvents() {
  const ev = readFileSync(REPLAY, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const scored = ev.find((e) => e.type === "node.scored" && e.feasible);
  const n = scored.node_id;
  const created = ev.find((e) => e.type === "node.created" && e.node_id === n);
  const root = ev.find((e) => e.type === "node.created" && e.node_id === created.parent_id);
  const mine = ev.filter((e) => e.node_id === n && e.type !== "node.expanded");
  const done = ev.find((e) => e.type === "run.completed");
  const rid = "live_mock";
  const seq = [ev.find((e) => e.type === "run.started"), ev.find((e) => e.type === "run.baseline"), root, ...mine, { ...done, best_node_id: n, pareto: [n] }].filter(Boolean);
  return seq.map((e, i) => ({ ...e, run_id: rid, seq: i, t: i * 400 }));
}

export const MOCK_BUNDLE = { type: "bundle", files: [{ path: "rtl/custom_op.v", content: "module custom_op(input [31:0] a, b, output [31:0] y); assign y = a ^ b; endmodule\n" }, { path: "report.md", content: "# Live run report (mock)\n" }] };

/** Install in a page BEFORE navigation: replaces fetch for the live endpoint with a delayed NDJSON stream. */
export async function installSiliconMock(page, { delayMs = 60, status = 200, body = null } = {}) {
  const events = [...mockEvents(), MOCK_BUNDLE];
  await page.addInitScript(
    ([events, delayMs, status, body]) => {
      const real = window.fetch.bind(window);
      window.__siliconCalls = [];
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (!url.includes("/api/silicon/run")) return real(input, init);
        window.__siliconCalls.push(JSON.parse(init?.body ?? "{}"));
        if (status !== 200) return Promise.resolve(new Response(JSON.stringify(body ?? {}), { status, headers: { "content-type": "application/json" } }));
        const enc = new TextEncoder();
        let i = 0;
        const stream = new ReadableStream({
          pull(ctl) {
            return new Promise((res) => setTimeout(() => {
              if (i >= events.length) ctl.close();
              else ctl.enqueue(enc.encode(JSON.stringify(events[i++]) + "\n"));
              res();
            }, delayMs));
          },
        });
        init?.signal?.addEventListener("abort", () => {});
        return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      };
    },
    [events, delayMs, status, body],
  );
}
