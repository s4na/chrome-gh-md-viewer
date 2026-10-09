import type { PullContext } from "./types";

export function parsePullUrl(value: string): PullContext | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/|$)/,
    );
    if (url.origin !== "https://github.com" || !match) return null;
    return { owner: match[1], repo: match[2], number: Number(match[3]) };
  } catch {
    return null;
  }
}
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
