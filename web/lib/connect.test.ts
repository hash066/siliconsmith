import { describe, expect, it } from "vitest";
import { CLIENTS, INSTALL_GIT, TOOLS } from "./connect";

describe("connect page content", () => {
  it("every client starts the same server command the Python package documents", () => {
    for (const c of CLIENTS) expect(c.code).toMatch(/hardwright[",\s-]*(?:args|mcp)/);
    expect(CLIENTS.map((c) => c.id)).toEqual(["claude-code", "codex", "cursor", "vscode", "claude-desktop"]);
  });
  it("the JSON snippets are valid JSON", () => {
    for (const c of CLIENTS.filter((c) => c.code.startsWith("{"))) expect(() => JSON.parse(c.code)).not.toThrow();
  });
  it("lists the six tools the server exposes", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(["board_check", "board_fix_pin", "board_get_template", "board_parts", "board_templates", "matter_simulate"]);
  });
  it("installs the package by its real name from the engine folder", () => {
    expect(INSTALL_GIT).toContain("hardwright[matter]");
    expect(INSTALL_GIT).toContain("#subdirectory=engine");
  });
});
