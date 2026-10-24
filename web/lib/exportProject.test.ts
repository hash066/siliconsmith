import { describe, expect, it } from "vitest";
import { createProject } from "./projects";
import { buildProjectZip, readmeFor, zipName } from "../components/app/exportProject";

describe("project export", () => {
  it("names the zip from the title", () => {
    expect(zipName("A heat sink for a 5 W chip, 40 mm square…")).toBe("a-heat-sink-for-a-5-w-chip-40-mm-square.zip");
    expect(zipName("???")).toBe("project.zip");
  });
  it("the README says what is in the zip and flags files that could not be fetched", () => {
    const r = readmeFor({ title: "T", wb: "board", request: "check it", verdict: "4 of 5 pass", files: [{ name: "a.csv", note: "parts", included: true }, { name: "b.zip", note: "gerbers", included: false }], when: new Date("2026-10-24T00:00:00Z") });
    expect(r).toContain("Workbench: board");
    expect(r).toContain("- a.csv: parts\n");
    expect(r).toContain("b.zip: gerbers (could not be fetched, not included)");
    expect(r).toContain("nothing in this folder has been fabricated");
  });
  it("builds a zip with the README, the project record and each file", async () => {
    const p = createProject("matter", "A heat sink", 1000);
    const zip = await buildProjectZip({ project: p, request: "A heat sink", verdict: "Peak 80 C", files: [{ name: "parameters.json", mime: "application/json", note: "settings", text: "{}" }, { name: "part.stl", mime: "model/stl", note: "stl", base64: btoa("solid x") }, { name: "gone.bin", mime: "x", note: "n", href: "http://127.0.0.1:1/none" }], now: new Date(2026, 9, 24) });
    const text = new TextDecoder("latin1").decode(zip);
    for (const n of ["README.txt", "project.json", "files/parameters.json", "files/part.stl"]) expect(text).toContain(n);
    expect(text).not.toContain("files/gone.bin");
    expect(text).toContain("solid x");
  });
});
