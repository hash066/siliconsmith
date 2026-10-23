import { describe, expect, it } from "vitest";
import { BRAND } from "./brand";

describe("BRAND links", () => {
  it("repo is a github.com owner/repo URL", () => {
    expect(BRAND.repo).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  });
  it("example pull request is a github.com pull URL", () => {
    expect(BRAND.prExample).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/);
  });
});
