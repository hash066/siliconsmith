import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvidence, cliWorkload, reproduceCommand } from "./evidence";
import { parseNdjson } from "./events";
import { reduceAll } from "./run-state";

const load = (id: string) => reduceAll(parseNdjson(readFileSync(resolve(__dirname, `../public/replays/${id}.ndjson`), "utf8")).events);

describe("evidence references (r_w1_contree3, a real run)", () => {
  const s = load("r_w1_contree3");
  const best = s.best!;

  it("derives a CLI workload id and a command from the run's own config", () => {
    expect(cliWorkload("w1_tinymaix_fc")).toBe("w1");
    expect(cliWorkload("custom")).toBeNull();
    expect(reproduceCommand(s)).toBe("siliconsmith accelerate w1 --area-budget 5 --k 6 --k-child 4 --beam 2 --depth 2 --concurrency 12 --backend contree --run-id r_w1_contree3");
  });

  it("points each number at the event that carries it", () => {
    const sc = s.nodes[best].score!;
    for (const metric of ["wall_speedup", "cycles", "area"] as const) {
      const ev = buildEvidence(s, best, metric)!;
      expect(ev.runId).toBe("r_w1_contree3");
      expect(ev.nodeId).toBe(best);
      expect(ev.seqs).toContain(sc.seq);
      expect(ev.tool.length).toBeGreaterThan(0);
    }
    expect(buildEvidence(s, best, "cycles")!.value).toBe(sc.cycles.toLocaleString("en-US"));
  });

  it("never invents a tool version: null when the stream carries none, the value when it does", () => {
    expect(buildEvidence(s, best, "area")!.version).toBeNull();
    const withVersion = { ...s, toolVersions: { Yosys: "0.99" } };
    expect(buildEvidence(withVersion, best, "area")!.version).toBe("0.99");
  });

  it("has no replay path for a live run, and nothing for an unscored node", () => {
    expect(buildEvidence(s, best, "area", "live")!.replayPath).toBeNull();
    expect(buildEvidence(s, s.rootId!, "area")).toBeNull();
  });

  it("Fmax uses the nextpnr timing event when there is one", () => {
    const n = s.nodes[best];
    const ev = buildEvidence(s, best, "fmax");
    if (n.timing) expect(ev!.seqs).toEqual([n.timing.seq]);
    else expect(ev === null || ev.seqs[0] === n.score!.seq).toBe(true);
  });
});
