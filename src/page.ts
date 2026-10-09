import { isMarkdown } from "./github";
import type { ChangedFile, Revision } from "./types";

export interface DisplayedRange {
  before: string;
  after: string;
  beforeStart: number | null;
  beforeEnd: number | null;
  afterStart: number | null;
  afterEnd: number | null;
}
export interface DisplayedFile extends ChangedFile {
  node: HTMLElement;
  header: HTMLElement | null;
  anchor: string;
  ranges: DisplayedRange[];
  before: Revision | null;
  after: Revision | null;
}

const GRID =
  'table[aria-label^="Diff for:"], [role="grid"][aria-label^="Diff for:"]';
const CONTAINER =
  '[role="region"][id^="diff-"], .file[data-path], [data-file-path], [data-tagsearch-path]';
const MAX_BYTES = 2 * 1024 * 1024;
function cleanPath(value: string): string {
  return value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
}

function rangesFromRows(node: HTMLElement): DisplayedRange[] {
  const ranges: DisplayedRange[] = [];
  let before = new Map<number, string>();
  let after = new Map<number, string>();
  let beforeLast = 0;
  let afterLast = 0;
  let bytes = 0;
  function flush(): void {
    if (!before.size && !after.size) return;
    const old = Array.from(before).sort(([a], [b]) => a - b);
    const next = Array.from(after).sort(([a], [b]) => a - b);
    ranges.push({
      before: old.map(([, text]) => text).join("\n"),
      after: next.map(([, text]) => text).join("\n"),
      beforeStart: old[0]?.[0] ?? null,
      beforeEnd: old.at(-1)?.[0] ?? null,
      afterStart: next[0]?.[0] ?? null,
      afterEnd: next.at(-1)?.[0] ?? null,
    });
    before = new Map();
    after = new Map();
    beforeLast = afterLast = 0;
  }
  for (const row of node.querySelectorAll<HTMLTableRowElement>("tr")) {
    if (row.querySelector(".hunk, .blob-code-hunk")) {
      flush();
      continue;
    }
    const oldRow = new Map<number, string>();
    const newRow = new Map<number, string>();
    const cells = Array.from(row.querySelectorAll<HTMLElement>(":scope > td"));
    const sourceCells = cells.filter(
      (cell) =>
        cell.matches(".blob-code, .diff-text-cell") &&
        !cell.querySelector(".hunk"),
    );
    for (const cell of sourceCells) {
      const code =
        cell.querySelector<HTMLElement>(".diff-text-inner, .blob-code-inner") ??
        cell.querySelector<HTMLElement>("code.diff-text") ??
        (cell.matches(".blob-code-inner") ? cell : null);
      if (!code || code.classList.contains("hunk")) continue;
      const text = code.textContent ?? "";
      bytes += new TextEncoder().encode(text).length;
      if (bytes > MAX_BYTES) throw new Error("表示するMarkdownは2MBまでです。");
      const number = (element: HTMLElement | undefined) => {
        const value = element?.getAttribute("data-line-number");
        return value && /^[1-9]\d*$/.test(value) ? Number(value) : null;
      };
      const line = number(cell);
      const deleted =
        cell.classList.contains("blob-code-deletion") ||
        !!cell.querySelector("code.deletion");
      const added =
        cell.classList.contains("blob-code-addition") ||
        !!cell.querySelector("code.addition");
      const split = sourceCells.length > 1;
      const oldNumber =
        number(
          cells.find(
            (c) => !sourceCells.includes(c) && c.dataset.diffSide === "left",
          ),
        ) ?? number(cells[0]);
      const newNumber =
        number(
          cells.find(
            (c) => !sourceCells.includes(c) && c.dataset.diffSide === "right",
          ),
        ) ?? (split ? number(cells[2]) : number(cells[1]));
      const side =
        cell.dataset.diffSide ?? (cells.indexOf(cell) < 2 ? "left" : "right");
      if (
        !added &&
        (!split || side === "left") &&
        (split ? (line ?? oldNumber) : oldNumber) !== null
      )
        oldRow.set((split ? (line ?? oldNumber) : oldNumber) as number, text);
      if (
        !deleted &&
        (!split || side === "right") &&
        (split ? (line ?? newNumber) : newNumber) !== null
      )
        newRow.set((split ? (line ?? newNumber) : newNumber) as number, text);
    }
    if (
      (beforeLast &&
        Array.from(oldRow.keys()).some((n) => n > beforeLast + 1)) ||
      (afterLast && Array.from(newRow.keys()).some((n) => n > afterLast + 1))
    )
      flush();
    for (const [number, text] of oldRow) {
      before.set(number, text);
      beforeLast = Math.max(beforeLast, number);
    }
    for (const [number, text] of newRow) {
      after.set(number, text);
      afterLast = Math.max(afterLast, number);
    }
  }
  flush();
  return ranges;
}

function pinnedRevision(
  node: HTMLElement,
  side: "before" | "after",
): Revision | null {
  for (const link of node.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/blob/"]',
  )) {
    const deleted = !!link.closest(".deletion, .blob-code-deletion, .removed");
    if ((side === "before") !== deleted) continue;
    const url = new URL(link.href);
    const match = url.pathname.match(
      /^\/([^/]+)\/([^/]+)\/blob\/([a-f\d]{40})\//i,
    );
    if (url.origin === "https://github.com" && match)
      return { owner: match[1], repo: match[2], sha: match[3] };
  }
  return null;
}

export function readDisplayedFiles(
  root: Document = document,
  readRows = true,
): DisplayedFile[] {
  const found = new Map<string, DisplayedFile>();
  const nodes = new Set(
    Array.from(root.querySelectorAll<HTMLElement>(CONTAINER)),
  );
  for (const grid of root.querySelectorAll<HTMLElement>(GRID))
    nodes.add(grid.closest<HTMLElement>(CONTAINER) ?? grid);
  for (const node of nodes) {
    const grid = node.matches(GRID)
      ? node
      : node.querySelector<HTMLElement>(GRID);
    const header =
      node.querySelector<HTMLElement>(
        '.file-header, [data-testid="diff-file-header"], [data-testid="file-header"]',
      ) ??
      node.querySelector<HTMLElement>("h3")?.parentElement ??
      null;
    const filename = cleanPath(
      node.dataset.path ??
        node.dataset.filePath ??
        node.dataset.tagsearchPath ??
        grid?.getAttribute("aria-label")?.replace(/^Diff for:\s*/, "") ??
        header?.querySelector("code")?.textContent ??
        "",
    );
    const previous = node.dataset.oldPath ?? node.dataset.previousFilename;
    if (!isMarkdown(filename) && (!previous || !isMarkdown(previous))) continue;
    if (found.get(filename)?.node.contains(node)) continue;
    const table = grid ?? node.querySelector<HTMLElement>(".diff-table, table");
    const ranges = table && readRows ? rangesFromRows(table) : [];
    if (found.get(filename)?.ranges.length && !ranges.length) continue;
    const hunk =
      table?.querySelector(".hunk, .blob-code-hunk")?.textContent ?? "";
    const status = /@@ -0,0 \+1(?:,| )/.test(hunk)
      ? "added"
      : /@@ -1(?:,\d+)? \+0,0/.test(hunk)
        ? "removed"
        : previous
          ? "renamed"
          : "modified";
    found.set(filename, {
      filename,
      previous_filename: previous,
      status,
      node,
      header,
      anchor: node.id || grid?.dataset.diffAnchor || "",
      ranges,
      before: pinnedRevision(node, "before"),
      after: pinnedRevision(node, "after"),
    });
  }
  for (const item of root.querySelectorAll<HTMLElement>(
    '[role="treeitem"][id]',
  )) {
    const filename = cleanPath(item.id);
    if (!isMarkdown(filename) || found.has(filename)) continue;
    const link = item.querySelector<HTMLAnchorElement>('a[href^="#diff-"]');
    if (!link) continue;
    found.set(filename, {
      filename,
      status: "modified",
      node: item,
      header: null,
      anchor: link.hash.slice(1),
      ranges: [],
      before: null,
      after: null,
    });
  }
  return Array.from(found.values());
}
