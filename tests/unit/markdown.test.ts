import { describe, expect, it } from "vitest";
import {
  prepareDocument,
  relativePath,
  renderMarkdown,
} from "../../src/markdown";

describe("rendered Markdown", () => {
  it("resolves renamed file assets separately and preserves link fragments", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(
      "![旧図](image.png)\n\n[案内](guide.md#intro)",
      "![新図](image.png)\n\n[案内](guide.md#updated)",
      true,
    );
    const revision = { owner: "owner", repo: "repo", sha: "a".repeat(40) };
    const loaded: string[] = [];
    prepareDocument(
      container,
      "new/readme.md",
      { before: revision, after: revision },
      async (path, side) => {
        loaded.push(`${side}:${path}`);
        return "data:image/png;base64,AAA=";
      },
      "old/readme.md",
    );
    await Promise.resolve();
    expect(loaded).toEqual(["before:old/image.png", "after:new/image.png"]);
    expect(
      Array.from(container.querySelectorAll("a"), (link) => link.href),
    ).toEqual([
      `https://github.com/owner/repo/blob/${revision.sha}/old/guide.md#intro`,
      `https://github.com/owner/repo/blob/${revision.sha}/new/guide.md#updated`,
    ]);
  });
  it("shows the final document without deletions and both sides in diff mode", () => {
    const before =
      "# 日本語\n\n最大5回です。\n\n| 回数 | 秒 |\n| --- | --- |\n| 1 | 1 |\n";
    const after = before.replace("5回", "3回");
    const plain = renderMarkdown(before, after, false);
    expect(plain).toContain("<table>");
    expect(plain).toContain("最大3回");
    expect(plain).not.toContain("最大5回");
    const diff = renderMarkdown(before, after, true);
    expect(diff).toContain('class="change removed"');
    expect(diff).toContain('class="change added"');
    expect(diff).toContain("最大5回");
  });
  it("marks a changed reference link destination", () => {
    const diff = renderMarkdown(
      "[案内][guide]\n\n[guide]: ./old.md",
      "[案内][guide]\n\n[guide]: ./new.md",
      true,
    );
    expect(diff).toContain('href="./old.md"');
    expect(diff).toContain('href="./new.md"');
    expect(diff).toContain('class="change removed"');
  });
  it("sanitizes executable HTML and keeps code examples as code", () => {
    const html = renderMarkdown(
      "",
      '# 文書\n<script>alert(1)</script><img src="x.png" onerror="alert(1)"><a href="javascript:alert(1)">危険</a>\n\n```html\n<script>sample()</script>\n```',
      false,
    );
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;sample()");
  });
  it("resolves relative assets using the pinned repository", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(
      "",
      "# 見出し\n\n[手順](../setup.md)\n\n![画像](images/test.png)",
      false,
    );
    const loaded: string[] = [];
    const revision = { owner: "owner", repo: "repo", sha: "a".repeat(40) };
    prepareDocument(
      container,
      "docs/design.md",
      { before: revision, after: revision },
      async (path) => {
        loaded.push(path);
        return "data:image/png;base64,AAA=";
      },
    );
    await Promise.resolve();
    expect(container.querySelector("a")?.href).toBe(
      `https://github.com/owner/repo/blob/${revision.sha}/setup.md`,
    );
    expect(loaded).toEqual(["docs/images/test.png"]);
    expect(container.querySelector("h1")?.id).toBe("見出し");
    expect(relativePath("docs/a.md", "https://example.com/a.png")).toBeNull();
  });
});
