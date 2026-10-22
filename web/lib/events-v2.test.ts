import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateStream } from "./contract";
import { parseNdjson, type RunEvent } from "./events";
import { reduceAll } from "./run-state";

const SHA = "a".repeat(64);
const CONFIG = { area_budget_pct: 5, beam: 1, k_root: 1, k_child: 1, max_depth: 1, max_concurrency: 1 };
const PROPOSAL = { mnemonic: "m", title: "M", semantics_c: "", operands: { rs1: "", rs2: "", rd: "" }, rationale: "" };

function stream(started: Record<string, unknown>, rest: Array<[RunEvent["type"], Record<string, unknown>]>): RunEvent[] {
  const all: Array<[RunEvent["type"], Record<string, unknown>]> = [
    ["run.started", { workload: { id: "x", title: "X", lang: "c" }, config: CONFIG, backend: "local", ...started }],
    ["node.created", { node_id: "root", parent_id: null, depth: 0, proposal: null, instruction_set: [] }],
    ["node.created", { node_id: "n1", parent_id: "root", depth: 1, proposal: PROPOSAL, instruction_set: ["m"] }],
    ...rest,
  ];
  return all.map(([type, body], seq) => ({ v: 1, seq, t: seq * 10, run_id: "r_v2", type, ...body }) as unknown as RunEvent);
}

describe("event contract v2 (additive)", () => {
  it("every existing replay still validates with no errors and reduces to the silicon domain", () => {
    const dir = resolve(__dirname, "../public/replays");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ndjson"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const { events, errors } = parseNdjson(readFileSync(resolve(dir, f), "utf8"));
      expect(errors).toEqual([]);
      expect(validateStream(events).filter((i) => i.level === "error")).toEqual([]);
      const s = reduceAll(events);
      expect(s.domain).toBe("silicon");
      expect(s.ladderSpec).toBeNull();
      expect(s.artifacts).toEqual([]);
      expect(s.toolVersions).toEqual({});
    }
  });

  it("run.started.domain and ladder are accepted and kept in the state", () => {
    const events = stream({ domain: "board", ladder: [{ id: "B1", label: "Netlist is well formed", tool: "board.check" }, { id: "B2", label: "Electrical limits respected" }] }, []);
    expect(validateStream(events)).toEqual([]);
    const s = reduceAll(events);
    expect(s.domain).toBe("board");
    expect(s.ladderSpec).toEqual([{ id: "B1", label: "Netlist is well formed", tool: "board.check" }, { id: "B2", label: "Electrical limits respected" }]);
  });

  it("rejects a malformed ladder or domain", () => {
    const dup = validateStream(stream({ domain: "board", ladder: [{ id: "B1", label: "a" }, { id: "B1", label: "b" }] }, []));
    expect(dup.map((i) => i.rule)).toContain("ladder");
    const bad = validateStream(stream({ domain: "", ladder: "nope" }, []));
    expect(bad.map((i) => i.rule)).toEqual(expect.arrayContaining(["domain", "ladder"]));
  });

  it("accepts free-string stages for a non-silicon domain, but not for silicon", () => {
    const stage = ["node.stage", { node_id: "n1", stage: "B1", status: "pass", attempt: 0, detail: "12 pins checked" }] as [RunEvent["type"], Record<string, unknown>];
    expect(validateStream(stream({ domain: "board" }, [stage]))).toEqual([]);
    expect(validateStream(stream({}, [stage])).map((i) => i.rule)).toContain("stage");
    const s = reduceAll(stream({ domain: "board" }, [stage]));
    expect((s.nodes.n1.stages as Record<string, { status: string }>)["B1"]?.status).toBe("pass");
    expect(s.warnings).toEqual([]);
  });

  it("allows a non-silicon node to retry without the silicon repair rule", () => {
    const events = stream({ domain: "matter" }, [
      ["node.stage", { node_id: "n1", stage: "M2", status: "fail", attempt: 0 }],
      ["node.stage", { node_id: "n1", stage: "M2", status: "pass", attempt: 1 }],
    ]);
    expect(validateStream(events)).toEqual([]);
  });

  it("artifact.created is validated and recorded", () => {
    const artifact = ["artifact.created", { kind: "kicad-netlist", path: "out/board.net", sha256: SHA, node_id: "n1" }] as [RunEvent["type"], Record<string, unknown>];
    const events = stream({ domain: "board" }, [artifact]);
    expect(validateStream(events)).toEqual([]);
    const s = reduceAll(events);
    expect(s.artifacts).toEqual([{ kind: "kicad-netlist", path: "out/board.net", sha256: SHA, nodeId: "n1", seq: 3, t: 30 }]);
    expect(s.ticker.at(-1)?.kind).toBe("artifact");
  });

  it("artifact.created needs kind, path and a 64-hex sha256, and a node that exists", () => {
    const no = (body: Record<string, unknown>) => validateStream(stream({}, [["artifact.created", body]])).map((i) => i.rule);
    expect(no({ kind: "stl", path: "a.stl", sha256: "xyz" })).toContain("artifact");
    expect(no({ kind: "stl", path: "a.stl", sha256: SHA.toUpperCase() })).toContain("artifact");
    expect(no({ kind: "", path: "a.stl", sha256: SHA })).toContain("artifact");
    expect(no({ kind: "stl", path: "a.stl" })).toContain("fields");
    expect(no({ kind: "stl", path: "a.stl", sha256: SHA, node_id: "ghost" })).toContain("node-order");
    expect(no({ kind: "stl", path: "a.stl", sha256: SHA, node_id: null })).toEqual([]);
  });

  it("keeps tool_versions only when the engine sends them", () => {
    expect(reduceAll(stream({ tool_versions: { yosys: "0.9" } }, [])).toolVersions).toEqual({ yosys: "0.9" });
    expect(reduceAll(stream({}, [])).toolVersions).toEqual({});
  });
});
