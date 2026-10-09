import { GitHubClient, parsePullUrl } from "./github";
import type { Request, Snapshot } from "./types";

const snapshots = new Map<string, Snapshot>();
const storageReady = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
chrome.runtime.onMessage.addListener((message: Request, sender, respond) => {
  const context = parsePullUrl(sender.tab?.url ?? "");
  if (sender.id !== chrome.runtime.id || !context) {
    respond({ ok: false, error: "GitHubのPRから開いてください。" });
    return false;
  }
  const key = `${context.owner}/${context.repo}/${context.number}`;
  void (async () => {
    await storageReady;
    if (message.type === "open-options") {
      await chrome.runtime.openOptionsPage();
      return null;
    }
    const { token } = await chrome.storage.local.get("token");
    const client = new GitHubClient(typeof token === "string" ? token : "");
    if (message.type === "load-pr") {
      const snapshot = await client.snapshot(context);
      snapshots.set(key, snapshot);
      return snapshot;
    }
    if (message.type !== "load-file" && message.type !== "load-image")
      throw new Error("不明な要求です。");
    const snapshot = snapshots.get(key) ?? (await client.snapshot(context));
    snapshots.set(key, snapshot);
    if (snapshot.id !== message.snapshotId)
      throw new Error(
        "PRが更新されました。プレビューを再読み込みしてください。",
      );
    if (message.type === "load-file") {
      const file = snapshot.files.find(
        (file) => file.filename === message.filename,
      );
      if (!file) throw new Error("このPRで変更されたMarkdownではありません。");
      return client.file(snapshot, file);
    }
    if (message.side !== "before" && message.side !== "after")
      throw new Error("画像の比較元が不正です。");
    return client.image(snapshot[message.side], message.path);
  })().then(
    (data) => respond({ ok: true, data }),
    (error) =>
      respond({
        ok: false,
        error:
          error instanceof Error ? error.message : "読み込みに失敗しました。",
      }),
  );
  return true;
});
