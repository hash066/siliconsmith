import { describe, expect, it } from "vitest";
import type { AgentMessage } from "./agent";
import { addProject, byWorkbench, createProject, MAX_PROJECTS, parseProjects, patchProject, removeProject, renameProject, sanitizeChat, serializeProjects, titleFrom } from "./projects";

const msg = (id: string, text: string, streaming = false): AgentMessage => ({ id, role: "assistant", text, toolCalls: [], evidence: [], streaming });

describe("projects", () => {
  it("titles come from the first words and never exceed 48 characters", () => {
    expect(titleFrom("  A heat   sink for a 5 W chip ")).toBe("A heat sink for a 5 W chip");
    expect(titleFrom("x".repeat(100)).length).toBe(48);
    expect(titleFrom("   ")).toBe("Untitled project");
  });

  it("adds newest first, groups by workbench and removes", () => {
    let l = addProject([], createProject("matter", "one", 1));
    l = addProject(l, createProject("board", "two", 2));
    l = addProject(l, createProject("matter", "three", 3));
    expect(l.map((p) => p.title)).toEqual(["three", "two", "one"]);
    expect(byWorkbench(l, "matter").map((p) => p.title)).toEqual(["three", "one"]);
    expect(removeProject(l, l[0].id)).toHaveLength(2);
  });

  it("caps the list and keeps the newest", () => {
    let l = [] as ReturnType<typeof createProject>[];
    for (let i = 0; i < MAX_PROJECTS + 5; i++) l = addProject(l, createProject("matter", `p${i}`, i + 1));
    expect(l).toHaveLength(MAX_PROJECTS);
    expect(l[0].title).toBe(`p${MAX_PROJECTS + 4}`);
  });

  it("patch bumps updatedAt and rename shortens", () => {
    const p = createProject("silicon", "a", 10);
    const l = renameProject(patchProject([p], p.id, { snap: { matter: { generator: "rect_fins" } } }, 20), p.id, "b".repeat(80), 30);
    expect(l[0].updatedAt).toBe(30);
    expect(l[0].title.length).toBe(48);
    expect(l[0].snap.matter?.generator).toBe("rect_fins");
  });

  it("a saved chat drops empty streaming replies, settles half-streamed ones and clears the proposal", () => {
    const s = sanitizeChat({ messages: [msg("1", "hello"), msg("2", "", true), msg("3", "partial", true)], pending: { tool: "board_design", summary: "s", costEstimateUsd: 0.05, args: {}, id: "x" } as never, activeModel: "super" });
    expect(s.messages.map((m) => m.id)).toEqual(["1", "3"]);
    expect(s.messages[1].streaming).toBe(false);
    expect(s.pending).toBeNull();
  });

  it("round-trips and ignores corrupt or foreign storage", () => {
    const p = createProject("board", "my board", 5);
    p.chat = { messages: [msg("1", "hi")], pending: null, activeModel: "ultra" };
    const back = parseProjects(serializeProjects([p]));
    expect(back).toHaveLength(1);
    expect(back[0].chat.messages[0].text).toBe("hi");
    expect(parseProjects("not json")).toEqual([]);
    expect(parseProjects('{"a":1}')).toEqual([]);
    expect(parseProjects(JSON.stringify([{ id: "x", title: "t", wb: "nope" }, { id: 3 }]))).toEqual([]);
    expect(parseProjects(null)).toEqual([]);
  });

  it("stays under the size budget by trimming the oldest chats first", () => {
    const big = "y".repeat(40_000);
    let l = [] as ReturnType<typeof createProject>[];
    for (let i = 0; i < 30; i++) {
      const p = createProject("matter", `p${i}`, i + 1);
      p.chat = { messages: [msg("1", big)], pending: null, activeModel: null };
      l = addProject(l, p);
    }
    const s = serializeProjects(l);
    expect(s.length).toBeLessThanOrEqual(900_000);
    const back = parseProjects(s);
    expect(back[0].chat.messages).toHaveLength(1); // newest keeps its chat
  });
});
