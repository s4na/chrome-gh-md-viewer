import { describe, expect, it } from "vitest";
import { createTree, filterTree } from "../../src/tree";

describe("file navigation", () => {
  it("compresses single-directory chains without losing file paths", () => {
    const selected: string[] = [];
    const tree = createTree(
      [{ filename: "docs/design/retry.md", status: "modified" }],
      (file) => selected.push(file.filename),
    );
    expect(tree.querySelectorAll("details")).toHaveLength(1);
    expect(tree.querySelector("summary .file-name")?.textContent).toBe(
      "docs/design",
    );
    expect(tree.querySelector("details")?.dataset.path).toBe("docs/design");
    tree.querySelector<HTMLButtonElement>("button")?.click();
    expect(selected).toEqual(["docs/design/retry.md"]);
  });
  it("filters by full path and restores collapsed folders when cleared", () => {
    const tree = createTree(
      [
        { filename: "docs/guides/setup.md", status: "added" },
        { filename: "docs/design/retry.md", status: "modified" },
        { filename: "README.md", status: "modified" },
      ],
      () => {},
    );
    const guides = tree.querySelector<HTMLDetailsElement>(
      '[data-path="docs/guides"]',
    );
    if (!guides) throw new Error("Missing folder");
    guides.open = false;
    filterTree(tree, " DOCS/GUIDES ");
    expect(guides.open).toBe(true);
    expect(
      tree.querySelector<HTMLButtonElement>('[data-filename="README.md"]')
        ?.hidden,
    ).toBe(true);
    filterTree(tree, "no-such-file");
    expect(tree.querySelector<HTMLElement>(".tree-empty")?.hidden).toBe(false);
    filterTree(tree, "");
    expect(guides.open).toBe(false);
    expect(
      tree.querySelector<HTMLButtonElement>('[data-filename="README.md"]')
        ?.hidden,
    ).toBe(false);
    expect(tree.querySelector<HTMLElement>(".tree-empty")?.hidden).toBe(true);
  });
});
