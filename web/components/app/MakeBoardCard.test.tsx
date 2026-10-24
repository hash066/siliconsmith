import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MakeBoardCard, MAX_CONSTRAINTS, RequestNote } from "./MakeBoardCard";

describe("MakeBoardCard", () => {
  it("offers the three styles, a length-limited wishes box and the make button", () => {
    const html = renderToStaticMarkup(<MakeBoardCard onMake={() => undefined} label="Make a routed board" />);
    for (const s of ["Default", "Smallest", "Reduce EMI"]) expect(html).toContain(s);
    expect(html).toContain(`maxLength="${MAX_CONSTRAINTS}"`);
    expect(html).toContain("Make a routed board");
    expect(html).toContain('checked=""');
  });

  it("shows an error as an alert", () => {
    expect(renderToStaticMarkup(<MakeBoardCard onMake={() => undefined} label="Try again" error="busy" />)).toContain('role="alert"');
  });
});

describe("RequestNote", () => {
  it("lists what was acted on and what was not", () => {
    const html = renderToStaticMarkup(<RequestNote request={{ style: "emi", understood: ["USB-C connector on the left edge"], ignored: ["make it blue"] }} />);
    expect(html).toContain("Reduce EMI");
    expect(html).toContain("Acted on: USB-C connector on the left edge");
    expect(html).toContain("Not acted on: make it blue");
  });
  it("is silent for a plain default board", () => {
    expect(renderToStaticMarkup(<RequestNote request={{ style: "default", understood: [], ignored: [] }} />)).toBe("");
    expect(renderToStaticMarkup(<RequestNote />)).toBe("");
  });
});
