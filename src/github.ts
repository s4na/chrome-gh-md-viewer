import type {
  ChangedFile,
  FileContents,
  PullContext,
  Revision,
  Snapshot,
} from "./types";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
async function boundedBody(
  response: Response,
  limit: number,
  error: string,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error(error);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
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
export function safePath(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "." || part === ".." || !part) ||
    Array.from(path).some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error("ファイルパスが不正です。");
  return path.split("/").map(encodeURIComponent).join("/");
}
export function repoPath(revision: Pick<Revision, "owner" | "repo">): string {
  return `/repos/${encodeURIComponent(revision.owner)}/${encodeURIComponent(revision.repo)}`;
}
interface PullData {
  head: {
    sha: string;
    repo: { name: string; owner: { login: string } } | null;
  };
  base: { sha: string; repo: { name: string; owner: { login: string } } };
  changed_files: number;
}
export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  private async request(
    path: string,
    accept = "application/vnd.github+json",
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await this.fetcher(`https://api.github.com${path}`, {
      headers,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      )
        throw new Error(
          `GitHub API (${response.status})：アクセス権、トークン、API利用制限を確認してください。拡張の設定からトークンを登録できます。`,
        );
      throw new Error(`GitHub APIの取得に失敗しました (${response.status})。`);
    }
    return response;
  }
  private async json<T>(path: string): Promise<T> {
    return (await this.request(path)).json() as Promise<T>;
  }
  async snapshot(context: PullContext): Promise<Snapshot> {
    const pullPath = `${repoPath(context)}/pulls/${context.number}`;
    const pull = await this.json<PullData>(pullPath);
    if (!pull.head.repo) throw new Error("PRの元リポジトリを取得できません。");
    if (pull.changed_files > 3000)
      throw new Error(
        "GitHub APIの上限（変更ファイル3,000件）を超えるPRです。",
      );
    const comparison = await this.json<{ merge_base_commit: { sha: string } }>(
      `${repoPath(context)}/compare/${pull.base.sha}...${pull.head.sha}`,
    );
    const allFiles: ChangedFile[] = [];
    for (let page = 1; page <= 30; page++) {
      const files = await this.json<ChangedFile[]>(
        `${pullPath}/files?per_page=100&page=${page}`,
      );
      allFiles.push(...files);
      if (files.length < 100) break;
    }
    const latest = await this.json<PullData>(pullPath);
    if (
      latest.head.sha !== pull.head.sha ||
      latest.base.sha !== pull.base.sha ||
      allFiles.length !== pull.changed_files
    )
      throw new Error("取得中にPRが更新されました。再読み込みしてください。");
    return {
      id: `${comparison.merge_base_commit.sha}:${pull.head.sha}`,
      context,
      before: {
        owner: pull.base.repo.owner.login,
        repo: pull.base.repo.name,
        sha: comparison.merge_base_commit.sha,
      },
      after: {
        owner: pull.head.repo.owner.login,
        repo: pull.head.repo.name,
        sha: pull.head.sha,
      },
      files: allFiles.filter(
        (file) =>
          isMarkdown(file.filename) ||
          (file.previous_filename !== undefined &&
            isMarkdown(file.previous_filename)),
      ),
    };
  }
  async text(revision: Revision, path: string): Promise<string> {
    const response = await this.request(
      `${repoPath(revision)}/contents/${safePath(path)}?ref=${revision.sha}`,
      "application/vnd.github.raw+json",
    );
    return new TextDecoder().decode(
      await boundedBody(
        response,
        MAX_TEXT_BYTES,
        "Markdownは2MBまでプレビューできます。",
      ),
    );
  }
  async file(snapshot: Snapshot, file: ChangedFile): Promise<FileContents> {
    const [before, after] = await Promise.all([
      file.status === "added" || file.status === "copied"
        ? ""
        : this.text(snapshot.before, file.previous_filename ?? file.filename),
      file.status === "removed" ? "" : this.text(snapshot.after, file.filename),
    ]);
    return { before, after };
  }
  async image(revision: Revision, path: string): Promise<string> {
    const extensions: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      avif: "image/avif",
    };
    const mime = extensions[path.split(".").at(-1)?.toLowerCase() ?? ""];
    if (!mime) throw new Error("対応していない画像形式です。");
    const response = await this.request(
      `${repoPath(revision)}/contents/${safePath(path)}?ref=${revision.sha}`,
      "application/vnd.github.raw+json",
    );
    const bytes = await boundedBody(
      response,
      MAX_IMAGE_BYTES,
      "画像は5MBまで表示できます。",
    );
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return `data:${mime};base64,${btoa(binary)}`;
  }
}
