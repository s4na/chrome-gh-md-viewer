import { describe, expect, it } from "vitest";
import { GitHubClient, parsePullUrl, safePath } from "../../src/github";
import type { ChangedFile, Snapshot } from "../../src/types";

const sha = "a".repeat(40);
const head = "b".repeat(40);
const merge = "c".repeat(40);
function pull(headSha = head) {
  return {
    head: {
      sha: headSha,
      repo: { name: "fork", owner: { login: "contributor" } },
    },
    base: { sha, repo: { name: "repo", owner: { login: "owner" } } },
    changed_files: 2,
  };
}
describe("GitHub PR snapshots", () => {
  it("stops reading oversized Markdown", async () => {
    const client = new GitHubClient(
      "",
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    );
    await expect(
      client.text({ owner: "owner", repo: "repo", sha }, "a.md"),
    ).rejects.toThrow("2MB");
  });
  it("accepts only GitHub PR URLs and safe repository-relative paths", () => {
    expect(parsePullUrl("https://github.com/owner/repo/pull/42/files")).toEqual(
      { owner: "owner", repo: "repo", number: 42 },
    );
    expect(
      parsePullUrl("https://github.com.attacker.test/owner/repo/pull/42"),
    ).toBeNull();
    expect(parsePullUrl("https://github.com/owner/repo/issues/42")).toBeNull();
    expect(safePath("docs/日本語 #.md")).toBe(
      "docs/%E6%97%A5%E6%9C%AC%E8%AA%9E%20%23.md",
    );
    expect(() => safePath("../secrets")).toThrow();
  });
  it("uses the merge base and the fork's pinned HEAD, filtering Markdown", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      expect(init?.credentials).toBe("omit");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer test-token",
      });
      return Response.json(
        url.includes("/compare/")
          ? { merge_base_commit: { sha: merge } }
          : url.includes("/files?")
            ? [
                { filename: "docs/a.md", status: "modified" },
                { filename: "index.ts", status: "added" },
              ]
            : pull(),
      );
    };
    const snapshot = await new GitHubClient("test-token", fetcher).snapshot({
      owner: "owner",
      repo: "repo",
      number: 42,
    });
    expect(snapshot.before).toEqual({
      owner: "owner",
      repo: "repo",
      sha: merge,
    });
    expect(snapshot.after).toEqual({
      owner: "contributor",
      repo: "fork",
      sha: head,
    });
    expect(snapshot.files.map((file) => file.filename)).toEqual(["docs/a.md"]);
    expect(
      calls.every((url) => url.startsWith("https://api.github.com/")),
    ).toBe(true);
  });
  it("rejects a snapshot when the PR changes during pagination", async () => {
    let pulls = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      return Response.json(
        url.includes("/compare/")
          ? { merge_base_commit: { sha: merge } }
          : url.includes("/files?")
            ? [{ filename: "a.md" }, { filename: "b.md" }]
            : pull(++pulls === 1 ? head : "d".repeat(40)),
      );
    };
    await expect(
      new GitHubClient("", fetcher).snapshot({
        owner: "owner",
        repo: "repo",
        number: 42,
      }),
    ).rejects.toThrow("更新");
  });
  it("loads renamed files at the old path and avoids missing sides of additions/deletions", async () => {
    const paths: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      paths.push(String(input));
      return new Response("# 文書");
    };
    const client = new GitHubClient("", fetcher);
    const snapshot: Snapshot = {
      id: "x",
      context: { owner: "owner", repo: "repo", number: 1 },
      before: { owner: "owner", repo: "repo", sha: merge },
      after: { owner: "contributor", repo: "fork", sha: head },
      files: [],
    };
    await client.file(snapshot, {
      filename: "new.md",
      previous_filename: "old.md",
      status: "renamed",
    });
    expect(paths[0]).toContain(`/contents/old.md?ref=${merge}`);
    expect(paths[1]).toContain(`/contents/new.md?ref=${head}`);
    paths.length = 0;
    for (const status of ["added", "removed"] as const)
      await client.file(snapshot, {
        filename: "a.md",
        status,
      } satisfies ChangedFile);
    expect(paths).toHaveLength(2);
  });
  it("keeps authentication failures visible", async () => {
    const client = new GitHubClient(
      "",
      async () => new Response("", { status: 401 }),
    );
    await expect(
      client.text({ owner: "owner", repo: "repo", sha }, "a.md"),
    ).rejects.toThrow("トークン");
  });
});
