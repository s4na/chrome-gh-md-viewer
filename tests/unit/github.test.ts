import { describe, expect, it } from "vitest";
import { isMarkdown, parsePullUrl } from "../../src/github";

describe("GitHub PR URLs", () => {
  it("accepts PR source-diff routes only on GitHub", () => {
    for (const route of ["files", "changes", "changes/abcdef"])
      expect(
        parsePullUrl(`https://github.com/owner/repo/pull/42/${route}`),
      ).toEqual({ owner: "owner", repo: "repo", number: 42 });
    expect(
      parsePullUrl("https://github.com.attacker.test/owner/repo/pull/42"),
    ).toBeNull();
    expect(parsePullUrl("https://github.com/owner/repo/issues/42")).toBeNull();
  });
  it("recognizes Markdown extensions", () => {
    expect(isMarkdown("docs/日本語.MD")).toBe(true);
    expect(isMarkdown("docs/readme.markdown")).toBe(true);
    expect(isMarkdown("example.rb")).toBe(false);
  });
});
