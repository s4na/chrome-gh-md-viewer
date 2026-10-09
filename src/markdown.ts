import { diffArrays } from "diff";
import DOMPurify from "dompurify";
import { marked } from "marked";
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
function markdownBlocks(source: string): { html: string }[] {
  // Parse and sanitize the complete document so HTML containers spanning
  // Markdown tokens (for example details/summary) stay structurally intact.
  const template = document.createElement("template");
  template.innerHTML = DOMPurify.sanitize(
    marked.parse(source, { gfm: true, async: false }),
    {
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
    },
  );
  return Array.from(template.content.childNodes)
    .filter(
      (node) =>
        node.nodeType === Node.ELEMENT_NODE ||
        (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
    )
    .map((node) => ({
      html:
        node instanceof Element
          ? node.outerHTML
          : escapeHtml(node.textContent ?? ""),
    }));
}
export function renderMarkdown(
  before: string,
  after: string,
  diff: boolean,
  removed = false,
): string {
  const oldBlocks = markdownBlocks(before);
  const newBlocks = markdownBlocks(after);
  if (!diff)
    return (removed ? oldBlocks : newBlocks)
      .map(
        (block) =>
          `<div data-revision="${removed ? "before" : "after"}">${block.html}</div>`,
      )
      .join("");
  const changes = diffArrays(oldBlocks, newBlocks, {
    comparator: (a, b) => a.html === b.html,
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
          const body = block.html;
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
