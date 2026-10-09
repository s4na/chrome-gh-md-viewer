import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

import { diffFile } from "../fixtures/diff";

const pageDiff =
  diffFile(
    "docs/design/retry.md",
    [
      { kind: "hunk", text: "@@ -1,10 +1,10 @@" },
      { kind: "context", before: 1, after: 1, text: "# 再試行の設計" },
      { kind: "context", before: 2, after: 2, text: "" },
      { kind: "removed", before: 3, text: "最大5回まで再試行します。" },
      { kind: "added", after: 3, text: "最大3回まで再試行します。" },
      { kind: "context", before: 4, after: 4, text: "" },
      { kind: "context", before: 5, after: 5, text: "| 回数 | 秒 |" },
      { kind: "context", before: 6, after: 6, text: "| --- | --- |" },
      { kind: "context", before: 7, after: 7, text: "| 1 | 1 |" },
      { kind: "context", before: 8, after: 8, text: "" },
      { kind: "context", before: 9, after: 9, text: "```yaml" },
      { kind: "removed", before: 10, text: "retry: 5" },
      { kind: "added", after: 10, text: "retry: 3" },
      { kind: "context", before: 11, after: 11, text: "```" },
      ...Array.from({ length: 20 }, (_, index) => ({
        kind: "context" as const,
        before: 12 + index,
        after: 12 + index,
        text: index % 2 ? "" : "日本語の文書を自然に読めることを確認します。",
      })),
    ],
    "diff-retry",
  ) +
  diffFile(
    "docs/guides/setup.md",
    [
      { kind: "hunk", text: "@@ -0,0 +1,3 @@" },
      { kind: "added", after: 1, text: "# 開発環境" },
      { kind: "added", after: 2, text: "" },
      { kind: "added", after: 3, text: "起動手順です。" },
    ],
    "diff-setup",
  ) +
  diffFile(
    "docs/legacy.md",
    [
      { kind: "hunk", text: "@@ -1,3 +0,0 @@" },
      { kind: "removed", before: 1, text: "# 旧設計" },
      { kind: "removed", before: 2, text: "" },
      { kind: "removed", before: 3, text: "削除した手順です。" },
    ],
    "diff-legacy",
  );
test("extension reads displayed source only, with diff, tree, maximize and focus", async () => {
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
    context.on("request", (request) => {
      if (request.url().startsWith("https://api.github.com/"))
        calls.push(request.url());
    });
    await context.route("https://api.github.com/**", (route) =>
      route.fulfill({ status: 404 }),
    );
    await context.route(
      "https://github.com/owner/repo/pull/42/files",
      (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<html lang="ja"><body><h1>Private PR</h1>${pageDiff}</body></html>`,
        }),
    );
    const page = await context.newPage();
    await page.goto("https://github.com/owner/repo/pull/42/files");
    await page.locator("#diff-retry header button").click();
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
    await expect(page.locator("#diff-retry header button")).toBeFocused();
    expect(calls).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
test("empty or unloaded source never asks for authentication and can be re-read", async () => {
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
    context.on("request", (request) => {
      if (request.url().startsWith("https://api.github.com/"))
        calls.push(request.url());
    });
    await context.route("https://api.github.com/**", (route) =>
      route.fulfill({ status: 404 }),
    );
    await context.route(
      "https://github.com/owner/repo/pull/42/changes",
      (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: '<html><body><h1>Private PR</h1><div role="tree"><div role="treeitem" id="docs/not-loaded.md"><a href="#diff-not-loaded">not-loaded.md</a></div></div></body></html>',
        }),
    );
    const page = await context.newPage();
    await page.goto("https://github.com/owner/repo/pull/42/changes");
    await page
      .getByRole("button", { name: "Markdownプレビュー", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByRole("alert")).toContainText(
      "まだ読み込まれていません",
    );
    await expect(modal.getByRole("button", { name: "拡張の設定" })).toHaveCount(
      0,
    );
    await page.evaluate(
      (html) => {
        const box = document.createElement("div");
        box.innerHTML = html;
        document.body.append(box);
      },
      diffFile(
        "docs/not-loaded.md",
        [
          { kind: "context", before: 20, after: 20, text: "# 読み込んだ範囲" },
          { kind: "context", before: 21, after: 21, text: "" },
          { kind: "removed", before: 22, text: "5回" },
          { kind: "added", after: 22, text: "3回" },
          { kind: "context", before: 40, after: 40, text: "# 別の範囲" },
        ],
        "diff-not-loaded",
      ),
    );
    await modal
      .getByRole("button", { name: "再読み込み", exact: true })
      .click();
    await expect(modal.locator(".document h1")).toHaveCount(2);
    await expect(modal.locator(".preview-range")).toHaveCount(2);
    await expect(modal.locator(".range-head").first()).toContainText("20〜22");
    await expect(modal.locator(".notice")).toContainText(
      "読み込まれている行のみ",
    );
    await modal.getByRole("button", { name: "差分表示", exact: true }).click();
    await expect(modal.locator("del")).toHaveText("5");
    await expect(modal.locator("ins")).toHaveText("3");
    await modal
      .getByRole("button", { name: "このファイルの差分へ戻る", exact: true })
      .click();
    await expect(modal).not.toBeVisible();
    await page.evaluate(() => {
      for (const node of document.querySelectorAll(
        '[role="region"], [role="tree"]',
      ))
        node.remove();
    });
    await page
      .getByRole("button", { name: "Markdownプレビュー", exact: true })
      .click();
    await expect(modal.locator(".message")).toContainText(
      "Markdownの差分はありません",
    );
    expect(calls).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
