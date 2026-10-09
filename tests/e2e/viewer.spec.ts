import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

const oldSha = "a".repeat(40);
const headSha = "b".repeat(40);
const mergeSha = "c".repeat(40);
const before =
  "# 再試行の設計\n\n最大5回まで再試行します。\n\n## 待機時間\n\n| 回数 | 秒 |\n| --- | --- |\n| 1 | 1 |\n\n```yaml\nretry: 5\n```\n";
const after =
  before.replaceAll("5", "3") +
  Array.from(
    { length: 20 },
    () => "\n日本語の文書を自然に読めることを確認します。\n",
  ).join("");
test("extension entry, API loader, rendered diff, tree, maximize and focus", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "gh-md-viewer-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const calls: string[] = [];
    await context.route("https://api.github.com/**", async (route) => {
      const url = new URL(route.request().url());
      calls.push(url.href);
      if (url.pathname.endsWith(`/compare/${oldSha}...${headSha}`))
        return route.fulfill({
          json: { merge_base_commit: { sha: mergeSha } },
        });
      if (url.pathname.endsWith("/pulls/42/files"))
        return route.fulfill({
          json: [
            { filename: "docs/design/retry.md", status: "modified" },
            { filename: "docs/guides/setup.md", status: "added" },
            { filename: "docs/legacy.md", status: "removed" },
          ],
        });
      if (url.pathname.endsWith("/pulls/42"))
        return route.fulfill({
          json: {
            head: {
              sha: headSha,
              repo: { name: "fork", owner: { login: "contributor" } },
            },
            base: {
              sha: oldSha,
              repo: { name: "repo", owner: { login: "owner" } },
            },
            changed_files: 3,
          },
        });
      if (url.pathname.includes("/contents/"))
        return route.fulfill({
          contentType: "text/plain",
          body: url.pathname.endsWith("setup.md")
            ? "# 開発環境\n\n起動手順です。"
            : url.searchParams.get("ref") === headSha
              ? after
              : before,
        });
      return route.fulfill({ status: 404 });
    });
    await context.route(
      "https://github.com/owner/repo/pull/42/files",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<html lang="ja"><body><h1>Pull request</h1><div class="file" data-path="docs/design/retry.md"><header class="file-header">docs/design/retry.md</header><pre>+ # 再試行の設計</pre></div></body></html>',
        }),
    );
    const page = await context.newPage();
    await page.goto("https://github.com/owner/repo/pull/42/files");
    await page.locator(".file-header button").click();
    const modal = page.getByRole("dialog");
    await expect(modal.locator(".document h1").first()).toHaveText(
      "再試行の設計",
    );
    await expect(modal.locator(".change")).toHaveCount(0);
    await expect(modal.locator(".document")).toContainText("最大3回");
    await modal.getByRole("button", { name: "差分表示", exact: true }).click();
    await expect(modal.locator(".change.added")).not.toHaveCount(0);
    await expect(modal.locator(".change.removed")).not.toHaveCount(0);
    await expect(modal.locator(".document p del")).toHaveText("5");
    await expect(modal.locator(".document p ins")).toHaveText("3");
    await expect(modal.locator(".document pre")).toHaveCount(1);
    await expect(modal.locator(".document code del")).toHaveText("5");
    await expect(modal.locator(".document code ins")).toHaveText("3");
    await expect(modal.locator(".document table .change")).toHaveCount(0);
    await expect(modal.locator(".change-mark")).toHaveCount(0);
    expect(
      await modal
        .locator(".document p del")
        .evaluate((node) => getComputedStyle(node).textDecorationLine),
    ).toBe("line-through");
    await modal.getByRole("button", { name: "差分表示", exact: true }).click();
    await expect(modal.locator(".change")).toHaveCount(0);
    await expect(modal.locator(".document")).toContainText("最大3回");
    await expect(modal.locator(".document")).not.toContainText("最大5回");
    await modal.locator('[data-path="docs/guides"] > summary').click();
    const filter = modal.getByRole("searchbox", {
      name: "ファイルを絞り込む",
      exact: true,
    });
    await filter.fill("setup");
    await expect(
      modal.getByRole("button", {
        name: "docs/guides/setup.md、追加",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      modal.getByRole("button", { name: "docs/legacy.md、削除", exact: true }),
    ).not.toBeVisible();
    await filter.fill("missing-file");
    await expect(modal.locator(".tree-empty")).toBeVisible();
    await filter.fill("");
    await expect(
      modal.locator('[data-path="docs/guides"]'),
    ).not.toHaveAttribute("open");
    await modal.locator(".document-area").evaluate((element) => {
      element.scrollTop = 120;
    });
    await modal.getByRole("button", { name: "最大化", exact: true }).click();
    const box = await modal.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.y).toBe(0);
    expect(box?.width).toBe(page.viewportSize()?.width);
    await modal
      .getByRole("button", { name: "元のサイズに戻す", exact: true })
      .click();
    await expect(
      modal.locator('[data-path="docs/guides"]'),
    ).not.toHaveAttribute("open");
    expect(
      await modal
        .locator(".document-area")
        .evaluate((element) => element.scrollTop),
    ).toBe(120);
    await modal.locator('[data-path="docs/guides"] > summary').click();
    await modal
      .getByRole("button", { name: "docs/guides/setup.md、追加", exact: true })
      .click();
    await expect(modal.locator(".document h1")).toHaveText("開発環境");
    expect(
      await modal
        .locator(".document-area")
        .evaluate((element) => element.scrollTop),
    ).toBe(0);
    await modal
      .getByRole("button", { name: "docs/legacy.md、削除", exact: true })
      .click();
    await expect(modal.locator(".notice")).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await modal
      .getByRole("button", { name: "ファイル一覧", exact: true })
      .click();
    await expect(filter).toBeVisible();
    await filter.fill("setup");
    await modal
      .getByRole("button", { name: "docs/guides/setup.md、追加", exact: true })
      .click();
    await expect(modal.locator(".document h1")).toHaveText("開発環境");
    await expect(filter).not.toBeVisible();
    const maxBox = await modal
      .getByRole("button", { name: "最大化", exact: true })
      .boundingBox();
    const closeBox = await modal
      .getByRole("button", { name: "プレビューを閉じる", exact: true })
      .boundingBox();
    expect(maxBox && closeBox && maxBox.x + maxBox.width <= closeBox.x).toBe(
      true,
    );
    expect(closeBox && closeBox.x + closeBox.width <= 375).toBe(true);
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
    await expect(page.locator(".file-header button")).toBeFocused();
    expect(
      calls.some(
        (url) =>
          url.includes("/repos/contributor/fork/contents/") &&
          url.includes(headSha),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (url) =>
          url.includes("/repos/owner/repo/contents/") && url.includes(mergeSha),
      ),
    ).toBe(true);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
test("authentication failure offers retry/settings", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "gh-md-viewer-"));
  const extension = path.resolve("dist");
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    await context.route("https://api.github.com/**", (route) =>
      route.fulfill({ status: 401, body: "Unauthorized" }),
    );
    await context.route(
      "https://github.com/owner/repo/pull/42/files",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<html><body>PR</body></html>",
        }),
    );
    const page = await context.newPage();
    await page.goto("https://github.com/owner/repo/pull/42/files");
    await page
      .getByRole("button", { name: "Markdownプレビュー", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("トークン");
    await expect(
      page.getByRole("button", { name: "再読み込み" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "拡張の設定" }),
    ).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
