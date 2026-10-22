// Dev/test only: real Board and Matter run logs (see lib/__fixtures__/README.md). Never served as product data.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateStream } from "./contract";
import { parseNdjson } from "./events";
import { nodeStatus, reduceAll } from "./run-state";

const load = (f: string) => {
  const { events, errors } = parseNdjson(readFileSync(resolve(__dirname, "__fixtures__", f), "utf8"));
  expect(errors).toEqual([]);
  return events;
};

describe("v2 fixtures (real Board and Matter runs)", () => {
  for (const f of ["m_eval_1.ndjson", "m_eval_2.ndjson", "m_eval_3.ndjson", "board-repair-pin_mismatch-2.ndjson"]) {
    it(`${f} validates with no contract errors`, () => {
      expect(validateStream(load(f)).filter((i) => i.level === "error")).toEqual([]);
    });
  }

  // Known deviation in the Board engine's logs (reported to its session): a repair's llm.call and the parent's node.expanded
  // arrive before the child's node.created. The validator is not relaxed; this pins that it is the only deviation.
  for (const f of ["board-propose-template-6.ndjson", "board-repair-pin_mismatch-1.ndjson"]) {
    it(`${f}: the only contract errors are children referenced before node.created`, () => {
      const errors = validateStream(load(f)).filter((i) => i.level === "error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((i) => i.rule === "expanded" || (i.rule === "node-order" && i.message.startsWith("llm.call")))).toBe(true);
    });
  }

  it("the board repair run: B4 fails on the injected fault, the repair passes B1 to B5, artifacts recorded", () => {
    const s = reduceAll(load("board-repair-pin_mismatch-1.ndjson"));
    expect(s.domain).toBe("board");
    expect(s.ladderSpec?.map((r) => r.id)).toEqual(["B1", "B2", "B3", "B4", "B5"]);
    expect(s.nodes.n1.domainScore?.ladder.B4).toBe("fail");
    expect(s.nodes["n1.1"].domainScore?.ladder).toEqual({ B1: "pass", B2: "pass", B3: "pass", B4: "pass", B5: "pass" });
    expect(nodeStatus(s.nodes.n1, s)).toBe("pruned");
    expect(s.best).toBe("n1.1");
    expect(s.artifacts.map((a) => a.kind).sort()).toEqual(["bom", "design", "firmware-header", "kicad-netlist"]);
    expect((s.nodes.n1.stages as Record<string, { evidence?: string[] }>)["B4"].evidence).toContain("part:esp32.gpio12.strapping");
    expect(s.warnings).toEqual([]);
  });

  it("the matter run: ladder by rung id, metrics, winner and artifacts", () => {
    const s = reduceAll(load("m_eval_1.ndjson"));
    expect(s.domain).toBe("matter");
    expect(s.ladderSpec?.map((r) => r.id)).toEqual(["M1", "M2", "M3", "M4", "M5"]);
    expect(s.best).toBe("n7");
    expect(s.nodes.n7.domainScore?.ladder.M5).toBe("pass");
    expect(typeof s.nodes.n7.domainScore?.metrics?.peak_temp_c).toBe("number");
    expect(s.artifacts.some((a) => a.kind === "stl")).toBe(true);
    expect(s.warnings).toEqual([]);
  });
});
