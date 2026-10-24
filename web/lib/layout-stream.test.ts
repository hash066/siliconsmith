import { describe, expect, it } from "vitest";
import { readLayoutStream } from "../components/app/useBoardLayout";

const stream = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const x of chunks) c.enqueue(enc.encode(x));
      c.close();
    },
  });
const result = { type: "result", summary: { status: "ok" }, board: { width: 1 }, downloads: [{ name: "a" }] };

describe("layout stream", () => {
  it("reports progress and heartbeats, then returns the result (lines may be split across chunks)", async () => {
    const seen: string[] = [];
    const beats: number[] = [];
    const line = JSON.stringify(result);
    const r = await readLayoutStream(stream(['{"type":"progress","message":"Placing the parts"}\n{"type":"heart', 'beat","seconds":8}\n', line.slice(0, 20), line.slice(20) + "\n"]), { progress: (m) => seen.push(m), heartbeat: (s) => beats.push(s) });
    expect(seen).toEqual(["Placing the parts"]);
    expect(beats).toEqual([8]);
    expect(r.summary).toEqual({ status: "ok" });
  });
  it("an error line becomes an Error with the server's message", async () => {
    await expect(readLayoutStream(stream(['{"type":"error","code":"layout_failed","message":"the Sandbox could not run the layout"}\n']), { progress() {}, heartbeat() {} })).rejects.toThrow("the Sandbox could not run the layout");
  });
  it("a stream that ends without a result is an error, not a silent success", async () => {
    await expect(readLayoutStream(stream(['{"type":"progress","message":"x"}\n']), { progress() {}, heartbeat() {} })).rejects.toThrow("ended before");
  });
  it("a result without a trailing newline still counts", async () => {
    const r = await readLayoutStream(stream([JSON.stringify(result)]), { progress() {}, heartbeat() {} });
    expect(r.downloads).toHaveLength(1);
  });
});
