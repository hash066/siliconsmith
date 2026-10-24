import { describe, expect, it } from "vitest";
import { parseTemplates } from "./templates";

describe("templates manifest", () => {
  const known = ["r_w1_contree3"];
  it("accepts a template linked to a recorded run", () => {
    const r = parseTemplates({ version: 1, templates: [{ id: "int8-dot", title: "int8 dot product", run_id: "r_w1_contree3" }] }, known);
    expect(r.error).toBeNull();
    expect(r.rows[0].problem).toBeNull();
    expect(r.rows[0].template.domain).toBe("silicon");
  });
  it("flags a template whose run is not recorded, a duplicate id and a malformed entry", () => {
    const r = parseTemplates({ version: 1, templates: [{ id: "a", title: "A", run_id: "r_missing" }, { id: "b", title: "B", run_id: "r_w1_contree3" }, { id: "b", title: "B2", run_id: "r_w1_contree3" }, { title: "no id" }] }, known);
    expect(r.rows.map((x) => !!x.problem)).toEqual([true, false, true, true]);
  });
  it("rejects a manifest in another format", () => {
    expect(parseTemplates({ templates: [] }, known).error).toBeTruthy();
    expect(parseTemplates(null, known).error).toBeTruthy();
  });
});
