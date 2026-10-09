import { diffArrays } from "diff";
import DOMPurify from "dompurify";
import { marked, type Token, type TokensList } from "marked";
import type { Revision } from "./types";

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}
function tokenHtml(token: Token, links: TokensList["links"]): string {
  const tokens = [token] as TokensList;
  tokens.links = links;
  return DOMPurify.sanitize(marked.parser(tokens, { gfm: true }), {
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [
      "style",
      "script",
      "form",
      "button",
      "textarea",
      "select",
      "iframe",
      "object",
      "embed",
    ],
    FORBID_ATTR: ["style", "id", "name"],
  });
}
export function renderMarkdown(
  before: string,
  after: string,
  diff: boolean,
  removed = false,
): string {
  const oldTokens = marked.lexer(before, { gfm: true });
  const newTokens = marked.lexer(after, { gfm: true });
  const oldBlocks = oldTokens
    .filter((token) => token.type !== "space")
    .map((token) => ({
      raw: token.raw,
      html: tokenHtml(token, oldTokens.links),
    }));
  const newBlocks = newTokens
    .filter((token) => token.type !== "space")
    .map((token) => ({
      raw: token.raw,
      html: tokenHtml(token, newTokens.links),
    }));
  if (!diff)
    return (removed ? oldBlocks : newBlocks)
      .map(
        (block) =>
          `<div data-revision="${removed ? "before" : "after"}">${block.html}</div>`,
      )
      .join("");
  const changes = diffArrays(oldBlocks, newBlocks, {
    comparator: (a, b) => a.raw === b.raw && a.html === b.html,
    timeout: 1000,
  }) ?? [
    { removed: true, added: false, value: oldBlocks },
    { removed: false, added: true, value: newBlocks },
  ];
  return changes
    .map((part) => {
      const kind = part.added ? "added" : part.removed ? "removed" : "";
      const side = part.removed ? "before" : "after";
      return part.value
        .map((block) => {
          const body =
            block.html.trim() ||
            `<pre><code>${escapeHtml(block.raw)}</code></pre>`;
          return kind
            ? `<section class="change ${kind}" data-revision="${side}"><span class="change-mark" aria-label="${part.added ? "追加" : "削除"}">${part.added ? "+" : "−"}</span><div>${body}</div></section>`
            : `<div data-revision="${side}">${body}</div>`;
        })
        .join("");
    })
    .join("");
}
export function relativePath(filename: string, href: string): string | null {
  if (
    /^[a-z][a-z\d+.-]*:/i.test(href) ||
    href.startsWith("//") ||
    href.startsWith("#")
  )
    return null;
  const base = new URL(
    `https://repository.invalid/${filename.split("/").map(encodeURIComponent).join("/")}`,
  );
  const resolved = new URL(href, base);
  const path = decodeURIComponent(resolved.pathname.slice(1));
  return path || null;
}
export function blobUrl(revision: Revision, path: string): string {
  return `https://github.com/${encodeURIComponent(revision.owner)}/${encodeURIComponent(revision.repo)}/blob/${revision.sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function prepareDocument(
  container: HTMLElement,
  filename: string,
  revisions: { before: Revision; after: Revision },
  loadImage: (path: string, side: "before" | "after") => Promise<string>,
  beforeFilename = filename,
): void {
  const slugCounts = new Map<string, number>();
  for (const heading of container.querySelectorAll<HTMLElement>(
    "h1,h2,h3,h4,h5,h6",
  )) {
    const slug = (heading.textContent ?? "")
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    const prefix = heading.closest('[data-revision="before"]') ? "before-" : "";
    const key = prefix + slug;
    const count = slugCounts.get(key) ?? 0;
    heading.id = key + (count ? `-${count}` : "");
    slugCounts.set(key, count + 1);
  }
  for (const input of container.querySelectorAll<HTMLInputElement>("input")) {
    if (input.type === "checkbox") input.disabled = true;
    else input.remove();
  }
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a")) {
    const href = link.getAttribute("href") ?? "";
    const side = link.closest('[data-revision="before"]') ? "before" : "after";
    if (href.startsWith("#")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        try {
          const target = decodeURIComponent(href.slice(1));
          const headings = Array.from(
            container.querySelectorAll<HTMLElement>("[id]"),
          );
          const heading =
            (side === "before"
              ? headings.find((node) => node.id === `before-${target}`)
              : null) ?? headings.find((node) => node.id === target);
          heading?.scrollIntoView({ block: "start" });
        } catch {
          /* Invalid anchor remains inert. */
        }
      });
      continue;
    }
    try {
      if (!href) continue;
      const path = relativePath(
        side === "before" ? beforeFilename : filename,
        href,
      );
      const url = new URL(path ? blobUrl(revisions[side], path) : href);
      if (path) {
        const resolved = new URL(href, "https://repository.invalid/");
        url.search = resolved.search;
        url.hash = resolved.hash;
      }
      if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
        link.removeAttribute("href");
        continue;
      }
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } catch {
      link.removeAttribute("href");
    }
  }
  for (const image of container.querySelectorAll<HTMLImageElement>("img")) {
    const src = image.getAttribute("src") ?? "";
    image.removeAttribute("srcset");
    try {
      const side = image.closest('[data-revision="before"]')
        ? "before"
        : "after";
      const path = relativePath(
        side === "before" ? beforeFilename : filename,
        src,
      );
      if (path) {
        image.removeAttribute("src");
        void loadImage(path, side).then(
          (data) => {
            image.src = data;
          },
          () => {
            image.alt = `${image.alt || path}（画像の取得に失敗）`;
          },
        );
      } else if (!/^https:\/\//i.test(src)) image.removeAttribute("src");
      image.loading = "lazy";
    } catch {
      image.removeAttribute("src");
    }
  }
}
