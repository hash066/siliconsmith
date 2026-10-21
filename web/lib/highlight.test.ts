import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";

describe("highlight (model-written code is rendered as HTML)", () => {
  it("escapes markup in the source instead of injecting it", async () => {
    const html = await highlight('// <img src=x onerror=alert(1)>\n<script>alert(2)</script>', "c");
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).toMatch(/&(lt|#x3C);/i);
  }, 30_000);
});
