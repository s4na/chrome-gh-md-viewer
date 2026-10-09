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
function markdownNodes(source: string): Node[] {
  // Parse and sanitize the complete input so HTML containers spanning
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
  return Array.from(template.content.childNodes).filter(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE ||
      (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()),
  );
}

function nodeHtml(node: Node): string {
  return node instanceof Element
    ? node.outerHTML
    : escapeHtml(node.textContent ?? "");
}

function markNode(node: Node, added: boolean): string {
  const side = added ? "after" : "before";
  const kind = added ? "added" : "removed";
  if (node instanceof Element) {
    const marked = node.cloneNode(true) as Element;
    marked.classList.add("change", kind);
    marked.setAttribute("data-revision", side);
    return marked.outerHTML;
  }
  const tag = added ? "ins" : "del";
  return `<${tag} class="change ${kind}" data-revision="${side}">${nodeHtml(node)}</${tag}>`;
}

function compatibleNodes(before: Node, after: Node): boolean {
  return (
    (before.nodeType === after.nodeType &&
      before.cloneNode(false).isEqualNode(after.cloneNode(false))) ||
    (before.nodeType === Node.TEXT_NODE && after.nodeType === Node.TEXT_NODE)
  );
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
function diffNode(before: Node, after: Node, deadline: number): string {
  if (before.isEqualNode(after)) return nodeHtml(after);
  if (before instanceof Element && after instanceof Element) {
    const result = after.cloneNode(false) as Element;
    result.innerHTML = diffNodes(
      Array.from(before.childNodes),
      Array.from(after.childNodes),
      deadline,
    );
    return result.outerHTML;
  }
  const tokenize = (node: Node) =>
    Array.from(
      segmenter.segment(node.textContent ?? ""),
      (part) => part.segment,
    );
  const changes = diffArrays(tokenize(before), tokenize(after), {
    timeout: Math.max(1, deadline - performance.now()),
  });
  if (!changes) return markNode(before, false) + markNode(after, true);
  return changes
    .map((part) => {
      const text = part.value.join("");
      return part.added || part.removed
        ? markNode(document.createTextNode(text), !!part.added)
        : escapeHtml(text);
    })
    .join("");
}

function alignChangedNodes(
  before: Node[],
  after: Node[],
  deadline: number,
): string | null {
  if (before.length * after.length > 10000) return null;
  const tokens = (node: Node) => {
    const counts = new Map<string, number>();
    let size = 0;
    for (const { segment } of segmenter.segment(node.textContent ?? "")) {
      if (!segment.trim()) continue;
      counts.set(segment, (counts.get(segment) ?? 0) + 1);
      size++;
    }
    return { counts, size };
  };
  const oldTokens = before.map(tokens);
  const newTokens = after.map(tokens);
  const width = after.length + 1;
  const costs = new Float64Array((before.length + 1) * width);
  const steps = new Uint8Array(costs.length);
  for (let i = 1; i <= before.length; i++) {
    costs[i * width] = i;
    steps[i * width] = 1;
  }
  for (let j = 1; j <= after.length; j++) {
    costs[j] = j;
    steps[j] = 2;
  }
  for (let i = 1; i <= before.length; i++) {
    for (let j = 1; j <= after.length; j++) {
      if (performance.now() >= deadline) return null;
      let replace = Number.POSITIVE_INFINITY;
      if (compatibleNodes(before[i - 1], after[j - 1])) {
        const old = oldTokens[i - 1];
        const next = newTokens[j - 1];
        let common = 0;
        for (const [token, count] of old.counts)
          common += Math.min(count, next.counts.get(token) ?? 0);
        const size = Math.max(old.size, next.size);
        const similarity = size ? common / size : 1;
        replace = costs[(i - 1) * width + j - 1] + 2 * (1 - similarity);
      }
      const remove = costs[(i - 1) * width + j] + 1;
      const add = costs[i * width + j - 1] + 1;
      const index = i * width + j;
      costs[index] = Math.min(replace, remove, add);
      steps[index] =
        replace <= remove && replace <= add ? 0 : remove < add ? 1 : 2;
    }
  }
  const pairs: { before?: Node; after?: Node }[] = [];
  let i = before.length;
  let j = after.length;
  while (i || j) {
    const step = steps[i * width + j];
    if (step === 1) pairs.push({ before: before[--i] });
    else if (step === 2) pairs.push({ after: after[--j] });
    else pairs.push({ before: before[--i], after: after[--j] });
  }
  return pairs
    .reverse()
    .map((pair) =>
      pair.before && pair.after
        ? diffNode(pair.before, pair.after, deadline)
        : markNode((pair.before ?? pair.after) as Node, !!pair.after),
    )
    .join("");
}

function diffNodes(before: Node[], after: Node[], deadline: number): string {
  const blockTags = new Set([
    "P",
    "DIV",
    "SECTION",
    "ARTICLE",
    "DETAILS",
    "SUMMARY",
    "BLOCKQUOTE",
    "PRE",
    "UL",
    "OL",
    "LI",
    "TABLE",
    "THEAD",
    "TBODY",
    "TFOOT",
    "TR",
    "TH",
    "TD",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
  ]);
  const visibleNode = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) return true;
    if (node.nodeType !== Node.TEXT_NODE) return false;
    if (node.textContent?.trim()) return true;
    // Formatting whitespace between block elements is not a visible diff anchor.
    return ![node.previousSibling, node.nextSibling].some(
      (sibling) => sibling instanceof Element && blockTags.has(sibling.tagName),
    );
  };
  before = before.filter(visibleNode);
  after = after.filter(visibleNode);
  const changes = diffArrays(before, after, {
    comparator: (a, b) => a.isEqualNode(b),
    timeout: Math.max(1, deadline - performance.now()),
  });
  if (!changes)
    return (
      before.map((node) => markNode(node, false)).join("") +
      after.map((node) => markNode(node, true)).join("")
    );
  let result = "";
  for (let index = 0; index < changes.length; index++) {
    const part = changes[index];
    const next = changes[index + 1];
    if (part.removed && next?.added) {
      // Align changed elements by shared content so adjacent deletions stay separate.
      const aligned = alignChangedNodes(part.value, next.value, deadline);
      if (aligned !== null) {
        result += aligned;
        index++;
        continue;
      }
    }
    result += part.value
      .map((node) =>
        part.added || part.removed
          ? markNode(node, !!part.added)
          : nodeHtml(node),
      )
      .join("");
  }
  return result;
}
export function renderMarkdown(
  before: string,
  after: string,
  diff: boolean,
  removed = false,
): string {
  const oldBlocks = markdownNodes(before);
  const newBlocks = markdownNodes(after);
  if (!diff)
    return (removed ? oldBlocks : newBlocks)
      .map(
        (block) =>
          `<div data-revision="${removed ? "before" : "after"}">${nodeHtml(block)}</div>`,
      )
      .join("");
  return `<div data-revision="after">${diffNodes(oldBlocks, newBlocks, performance.now() + 1000)}</div>`;
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
  revisions: { before: Revision | null; after: Revision | null },
  loadImage?: (path: string, side: "before" | "after") => Promise<string>,
  beforeFilename = filename,
): void {
  const slugCounts = new Map<string, number>();
  const headingTargets = new Map<string, HTMLElement>();
  for (const heading of container.querySelectorAll<HTMLElement>(
    "h1,h2,h3,h4,h5,h6",
  )) {
    const ownSide = heading.closest('[data-revision="before"]')
      ? "before"
      : "after";
    for (const side of ["before", "after"] as const) {
      const excluded = side === "before" ? "added" : "removed";
      if (heading.closest(`.change.${excluded}`)) continue;
      const projected = heading.cloneNode(true) as HTMLElement;
      for (const node of projected.querySelectorAll(`.change.${excluded}`))
        node.remove();
      const slug = (projected.textContent ?? "")
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
        .replace(/\s/g, "-");
      const key = (side === "before" ? "before-" : "") + slug;
      const count = slugCounts.get(key) ?? 0;
      const id = key + (count ? `-${count}` : "");
      headingTargets.set(id, heading);
      if (side === ownSide) heading.id = id;
      slugCounts.set(key, count + 1);
    }
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
              ? headingTargets.get(`before-${target}`)
              : null) ??
            headingTargets.get(target) ??
            headings.find((node) => node.id === target);
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
      const revision = revisions[side];
      if (path && !revision) {
        link.removeAttribute("href");
        link.title = "元の差分でリンク先を確認してください。";
        continue;
      }
      const url = new URL(path ? blobUrl(revision as Revision, path) : href);
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
        if (!loadImage) {
          image.alt = `${image.alt || path}（元の差分で画像を確認）`;
          continue;
        }
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
