import { describe, expect, it } from "vitest";
import { callApi, defaultSimulateInput, validateLocally } from "./hosted";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

describe("hosted API client: every outcome is classified", () => {
  it("returns data on success", async () => {
    const r = await callApi<{ ok: true; x: number }>("/x", undefined, reply(200, { ok: true, x: 1 }));
    expect(r).toEqual({ ok: true, data: { ok: true, x: 1 } });
  });

  it("board 400 with field paths", async () => {
    const r = await callApi("/x", undefined, reply(400, { ok: false, error: { code: "bad_json", message: "design is not valid JSON", errors: [{ path: "", message: "line 2, column 14: Expecting value" }] } }));
    expect(r).toMatchObject({ ok: false, kind: "field", status: 400, fields: [{ path: "", message: "line 2, column 14: Expecting value" }] });
  });

  it("matter 422 with a single field", async () => {
    const r = await callApi("/x", undefined, reply(422, { ok: false, error: { field: "spreader.n", message: "must be between 30 and 80, got 500" } }));
    expect(r).toMatchObject({ ok: false, kind: "field", fields: [{ path: "spreader.n", message: "must be between 30 and 80, got 500" }] });
  });

  it("429 keeps Retry-After", async () => {
    const r = await callApi("/x", undefined, reply(429, { ok: false, error: { code: "rate_limited", message: "too many checks, slow down" } }, { "retry-after": "12" }));
    expect(r).toMatchObject({ ok: false, kind: "rate", retryAfterS: 12 });
  });

  it("413, disabled, server, non-JSON platform page and network failure", async () => {
    expect(await callApi("/x", undefined, reply(413, { ok: false, error: { code: "too_large", message: "big" } }))).toMatchObject({ kind: "too_large" });
    expect(await callApi("/x", undefined, reply(404, { ok: false, error: { code: "disabled", message: "off" } }))).toMatchObject({ kind: "disabled" });
    expect(await callApi("/x", undefined, reply(502, { ok: false, error: { code: "agent_error", message: "bad gateway" } }))).toMatchObject({ kind: "server", status: 502 });
    expect(await callApi("/x", undefined, reply(404, "<html>Not found</html>"))).toMatchObject({ kind: "server", status: 404 });
    expect(await callApi("/x", undefined, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toMatchObject({ kind: "network" });
  });

  it("an ok:false body with a 200 status is still a failure", async () => {
    expect((await callApi("/x", undefined, reply(200, { ok: false, error: { code: "x", message: "m" } }))).ok).toBe(false);
  });
});

describe("simulate inputs", () => {
  it("defaults are inside the documented ranges, for both generators", () => {
    expect(validateLocally(defaultSimulateInput("rect_fins"))).toEqual([]);
    expect(validateLocally(defaultSimulateInput("radial_spokes"))).toEqual([]);
  });
  it("flags out-of-range and non-numeric values with the field path", () => {
    const i = defaultSimulateInput();
    i.gen_params.spine = 99;
    i.spreader.Q = Number.NaN;
    expect(validateLocally(i).map((e) => e.path)).toEqual(["gen_params.spine", "spreader.Q"]);
  });
});
