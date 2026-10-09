import { describe, expect, it } from "vitest";
import {
  prepareDocument,
  relativePath,
  renderMarkdown,
} from "../../src/markdown";

describe("rendered Markdown", () => {
  it("preserves HTML containers across Markdown blocks", () => {
    const container = document.createElement("div");
    const source =
      "<details>\n<summary>Summary</summary>\n\nHidden body\n\n</details>";
    for (const diff of [false, true]) {
      container.innerHTML = renderMarkdown("", source, diff);
      expect(container.querySelector("details p")?.textContent).toBe(
        "Hidden body",
      );
      expect(container.querySelector("details summary")?.textContent).toBe(
        "Summary",
      );
    }
  });
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
    const container = document.createElement("div");
    container.innerHTML = diff;
    expect(container.querySelector("del")?.textContent).toBe("5");
    expect(container.querySelector("ins")?.textContent).toBe("3");
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.className).toBe("");
    expect(container.querySelector("table .change")).toBeNull();
  });
  it("keeps formatting and highlights only changed words inside a paragraph", () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(
      "# Retry\n\nRetry **five** times and keep reading.",
      "# Retry\n\nRetry **three** times and keep reading.",
      true,
    );
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("strong del")?.textContent).toBe("five");
    expect(container.querySelector("strong ins")?.textContent).toBe("three");
    expect(container.querySelectorAll(".change")).toHaveLength(2);
    expect(container.querySelector(".change-mark")).toBeNull();
  });
  it("preserves unchanged list items and table cells", () => {
    const source =
      "- Keep this\n- Wait 5 seconds\n- Finish\n\n| Key | Value |\n| --- | --- |\n| Retry | 5 |\n| Delay | 1 |";
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(
      source,
      source.replaceAll("5", "3"),
      true,
    );
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelectorAll("td")).toHaveLength(4);
    expect(
      Array.from(container.querySelectorAll("del"), (node) => node.textContent),
    ).toEqual(["5", "5"]);
    expect(
      Array.from(container.querySelectorAll("ins"), (node) => node.textContent),
    ).toEqual(["3", "3"]);
    expect(
      container.querySelector("li .change")?.parentElement?.textContent,
    ).toBe("Wait 53 seconds");
    expect(container.querySelector("ul")?.className).toBe("");
    expect(container.querySelector("table")?.className).toBe("");
  });
  it("preserves both code versions including indentation and escaped HTML", () => {
    const before = "```html\n<div>\n  old & safe\n</div>\n```";
    const after = "```html\n<div>\n    new & safe\n</div>\n```";
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(before, after, true);
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("code div")).toBeNull();
    for (const [side, source] of [
      ["added", before],
      ["removed", after],
    ]) {
      const projected = container.cloneNode(true) as HTMLElement;
      for (const node of projected.querySelectorAll(`.change.${side}`))
        node.remove();
      const plain = document.createElement("div");
      plain.innerHTML = renderMarkdown("", source, false);
      expect(projected.querySelector("code")?.textContent).toBe(
        plain.querySelector("code")?.textContent,
      );
    }
  });
  it("marks inserted and deleted blocks without duplicating unchanged siblings", () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(
      "# Heading\n\n- Keep\n- Remove\n\nOld paragraph",
      "# Heading\n\n- Keep\n- Add\n\nNew paragraph\n\n## New section",
      true,
    );
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("h2.change.added")?.textContent).toBe(
      "New section",
    );
    expect(container.querySelector("li")?.textContent).toBe("Keep");
    expect(container.querySelector("li")?.querySelector(".change")).toBeNull();
  });
  it("keeps nested HTML containers and ignores changed comments", () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(
      "<details>\n<summary>Summary</summary>\n\nWait 5 seconds\n\n<!-- old secret -->\n</details>",
      "<details>\n<summary>Summary</summary>\n\nWait 3 seconds\n\n<!-- new secret -->\n</details>",
      true,
    );
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(container.querySelector("details p del")?.textContent).toBe("5");
    expect(container.textContent).not.toContain("secret");
  });
  it.each([
    [
      "paragraphs",
      "Alpha unchanged\n\nBeta five\n\nGamma unchanged",
      "Beta three\n\nGamma unchanged",
    ],
    [
      "list items",
      "- Alpha unchanged\n- Beta five\n- Gamma unchanged",
      "- Beta three\n- Gamma unchanged",
    ],
    [
      "table rows",
      "| Item |\n| --- |\n| Alpha unchanged |\n| Beta five |\n| Gamma unchanged |",
      "| Item |\n| --- |\n| Beta three |\n| Gamma unchanged |",
    ],
  ])(
    "keeps adjacent additions/deletions separate from edits in %s",
    (_kind, before, after) => {
      for (const reverse of [false, true]) {
        const container = document.createElement("div");
        container.innerHTML = renderMarkdown(
          reverse ? after : before,
          reverse ? before : after,
          true,
        );
        const deleted = Array.from(
          container.querySelectorAll(".change.removed"),
          (node) => node.textContent?.trim(),
        );
        const added = Array.from(
          container.querySelectorAll(".change.added"),
          (node) => node.textContent?.trim(),
        );
        expect(deleted).toEqual(
          reverse ? ["three"] : ["Alpha unchanged", "five"],
        );
        expect(added).toEqual(
          reverse ? ["Alpha unchanged", "five"] : ["three"],
        );
      }
    },
  );
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
  it("links both revisions to an inline-edited heading", () => {
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown(
      "[Section](#old-heading)\n\n# Old heading",
      "[Section](#new-heading)\n\n# New heading",
      true,
    );
    const revision = { owner: "owner", repo: "repo", sha: "a".repeat(40) };
    prepareDocument(
      container,
      "readme.md",
      { before: revision, after: revision },
      async () => "",
    );
    const heading = container.querySelector("h1");
    expect(heading?.id).toBe("new-heading");
    let scrolls = 0;
    if (heading)
      heading.scrollIntoView = () => {
        scrolls++;
      };
    for (const link of container.querySelectorAll("a")) link.click();
    expect(scrolls).toBe(2);
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
