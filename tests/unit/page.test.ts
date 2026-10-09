import { describe, expect, it } from "vitest";
import { readDisplayedFiles } from "../../src/page";
import { diffFile } from "../fixtures/diff";

describe("displayed PR source diffs", () => {
  it("reads source text and both line-number columns without decoration markers", () => {
    document.body.innerHTML = diffFile("docs/retry.md", [
      { kind: "hunk", text: "@@ -1,3 +1,3 @@" },
      { kind: "context", before: 1, after: 1, text: "# Retry" },
      { kind: "context", before: 2, after: 2, text: "" },
      { kind: "removed", before: 3, text: "最大5回" },
      { kind: "added", after: 3, text: "+ 最大3回" },
    ]);
    const [file] = readDisplayedFiles();
    expect(file.filename).toBe("docs/retry.md");
    expect(file.ranges).toEqual([
      {
        before: "# Retry\n\n最大5回",
        after: "# Retry\n\n+ 最大3回",
        beforeStart: 1,
        beforeEnd: 3,
        afterStart: 1,
        afterEnd: 3,
      },
    ]);
    expect(file.before).toBeNull();
    expect(file.after).toBeNull();
  });
  it("keeps separated hunks and missing lines out of the reconstructed Markdown", () => {
    document.body.innerHTML = diffFile("docs/a.md", [
      { kind: "context", before: 5, after: 5, text: "```yaml" },
      { kind: "context", before: 6, after: 6, text: "retry: 5" },
      { kind: "hunk", text: "@@ -20 +20 @@" },
      { kind: "removed", before: 20, text: "Old paragraph" },
      { kind: "added", after: 20, text: "New paragraph" },
      { kind: "context", before: 30, after: 30, text: "# Another section" },
    ]);
    expect(readDisplayedFiles()[0].ranges.map((range) => range.after)).toEqual([
      "```yaml\nretry: 5",
      "New paragraph",
      "# Another section",
    ]);
  });
  it("supports the legacy diff table", () => {
    document.body.innerHTML =
      '<div class="file" data-path="notes.md"><header class="file-header">notes.md</header><table class="diff-table"><tr><td class="blob-num" data-line-number="1"></td><td class="blob-num" data-line-number="1"></td><td class="blob-code blob-code-context"><span class="blob-code-inner"># Notes</span></td></tr><tr><td class="blob-num"></td><td class="blob-num" data-line-number="2"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner">+ Keep the literal plus</span></td></tr></table></div>';
    expect(readDisplayedFiles()[0].ranges[0].after).toBe(
      "# Notes\n+ Keep the literal plus",
    );
  });
  it("reads split-view cells separately and preserves code whitespace", () => {
    document.body.innerHTML =
      '<section role="region" id="diff-split"><header><h3><code>code.md</code></h3></header><table role="grid" aria-label="Diff for: code.md"><tr><td data-diff-side="left" data-line-number="1"></td><td class="diff-text-cell" data-diff-side="left" data-line-number="1"><code class="diff-text deletion"><div class="diff-text-inner">  retry: 5</div></code></td><td data-diff-side="right" data-line-number="1"></td><td class="diff-text-cell" data-diff-side="right" data-line-number="1"><code class="diff-text addition"><div class="diff-text-inner">    retry: 3</div></code></td></tr></table></section>';
    expect(readDisplayedFiles()[0].ranges[0]).toMatchObject({
      before: "  retry: 5",
      after: "    retry: 3",
    });
  });
  it("marks added/removed files using the displayed hunk and keeps unloaded tree entries", () => {
    document.body.innerHTML =
      diffFile(
        "added.md",
        [
          { kind: "hunk", text: "@@ -0,0 +1 @@" },
          { kind: "added", after: 1, text: "# Added" },
        ],
        "diff-added",
      ) +
      diffFile(
        "removed.md",
        [
          { kind: "hunk", text: "@@ -1 +0,0 @@" },
          { kind: "removed", before: 1, text: "# Removed" },
        ],
        "diff-removed",
      ) +
      '<div role="tree"><div role="treeitem" id="docs/unloaded.md"><a href="#diff-unloaded">unloaded.md</a></div></div>';
    expect(
      readDisplayedFiles().map((file) => [
        file.filename,
        file.status,
        file.ranges.length,
      ]),
    ).toEqual([
      ["added.md", "added", 1],
      ["removed.md", "removed", 1],
      ["docs/unloaded.md", "modified", 0],
    ]);
  });
  it("updates its snapshot only from the current DOM and ignores non-Markdown files", () => {
    document.body.innerHTML =
      diffFile("retry.md", [
        { kind: "context", before: 1, after: 1, text: "# Old" },
      ]) +
      diffFile(
        "code.rb",
        [{ kind: "context", before: 1, after: 1, text: "code" }],
        "diff-ruby",
      );
    expect(readDisplayedFiles()).toHaveLength(1);
    expect(readDisplayedFiles(document, false)[0].ranges).toHaveLength(0);
    const source = document.querySelector(".diff-text-inner");
    if (source) source.textContent = "# New";
    expect(readDisplayedFiles()[0].ranges[0].after).toBe("# New");
  });
  it("does not mistake a duplicate path on the file header for an unloaded file", () => {
    document.body.innerHTML = diffFile("docs/a.md", [
      { kind: "context", before: 1, after: 1, text: "# Content" },
    ]);
    document.querySelector("h3")?.setAttribute("data-file-path", "docs/a.md");
    expect(readDisplayedFiles()).toHaveLength(1);
    expect(readDisplayedFiles()[0].ranges[0].after).toBe("# Content");
  });
  it("keeps renamed Markdown paths and uses only visible pinned blob URLs", () => {
    document.body.innerHTML =
      '<div class="file" data-path="new.txt" data-old-path="old.md"><header class="file-header"><a href="https://github.com/owner/repo/blob/' +
      "a".repeat(40) +
      '/new.txt">View</a></header></div>';
    const [file] = readDisplayedFiles();
    expect(file.previous_filename).toBe("old.md");
    expect(file.status).toBe("renamed");
    expect(file.after?.sha).toBe("a".repeat(40));
    expect(file.before).toBeNull();
  });
});
