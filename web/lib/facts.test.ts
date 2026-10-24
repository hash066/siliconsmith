import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractEngineFacts } from "./facts-engine";
import { getFacts } from "./facts";

const web = process.cwd();
const count = (file: string, needle: string) => (readFileSync(file, "utf8").match(new RegExp(`"type":"${needle}"`, "g")) ?? []).length;
const board = resolve(web, "..", "engine", "siliconsmith", "board", "README.md");
const matter = resolve(web, "..", "engine", "siliconsmith", "matter", "EVALS.md");
const snapshot = resolve(web, "public", "recorded", "engine-facts.json");

describe("landing facts are derived from the data", () => {
  const f = getFacts();
  const replays = readdirSync(resolve(web, "public", "replays")).filter((x) => x.endsWith(".ndjson"));

  it("counts candidates, rejections and survivors straight from the replay files", () => {
    let rej = 0;
    let ver = 0;
    let created = 0;
    for (const r of replays) {
      const p = resolve(web, "public", "replays", r);
      rej += count(p, "node.pruned");
      ver += count(p, "node.scored");
      created += count(p, "node.created") - 1; // minus the root of each run
    }
    expect(f.silicon.runs).toHaveLength(replays.length);
    expect(f.silicon.rejected).toBe(rej);
    expect(f.silicon.verified).toBe(ver);
    expect(f.silicon.candidates).toBe(created);
    expect(f.silicon.rejected + f.silicon.verified).toBe(f.silicon.candidates);
  });

  it("the best speedup is the best of the runs, with its run id", () => {
    const top = Math.max(...f.silicon.runs.map((r) => r.wallSpeedup ?? r.speedup));
    expect(f.silicon.best.wallSpeedup ?? f.silicon.best.speedup).toBe(top);
    expect(replays).toContain(`${f.silicon.best.id}.ndjson`);
  });

  it("Board and Matter figures equal what the engine write-ups say", () => {
    const e = extractEngineFacts(readFileSync(board, "utf8"), readFileSync(matter, "utf8"));
    expect(f.board).toEqual(e.board);
    expect(f.matter.runs).toEqual(e.matter.runs);
    expect(f.board.faultsDetected).toBe(f.board.faultsCatalogued);
    expect(f.board.structuralFaults).toBe(3);
    expect(f.board.rungs).toEqual(["B1", "B2", "B3", "B4", "B5"]);
    expect(f.matter.marginK).toBeCloseTo(f.matter.baselineC - f.matter.bestPeakC, 2);
  });

  it("the committed engine snapshot (used when the engine docs are absent from a build) has not drifted", () => {
    const e = extractEngineFacts(readFileSync(board, "utf8"), readFileSync(matter, "utf8"));
    if (process.env.UPDATE_FACTS === "1") writeFileSync(snapshot, JSON.stringify(e, null, 1));
    expect(existsSync(snapshot)).toBe(true);
    expect(JSON.parse(readFileSync(snapshot, "utf8"))).toEqual(e);
  });

  it("library entries come from the evidence index", () => {
    const idx = JSON.parse(readFileSync(resolve(web, "..", "evidence", "index.json"), "utf8")) as { id: string }[];
    expect(f.library.entries.map((x) => x.id)).toEqual(idx.map((x) => x.id));
  });

  it("recorded sessions are real captures: agent events in stream form, chatbot with model, date and cost", () => {
    expect(f.recorded.agent.length).toBeGreaterThanOrEqual(4);
    for (const a of f.recorded.agent) {
      expect(a.events[0].type).toBe("turn.started");
      expect(a.events.at(-1)?.type).toBe("turn.done");
      expect(a.model).toMatch(/^nemotron-/);
    }
    expect(f.recorded.chat.model).toMatch(/nemotron/);
    expect(f.recorded.chat.costUsd).toBeGreaterThan(0);
    expect(f.recorded.chat.toolCalls).toBe(0);
  });
});
