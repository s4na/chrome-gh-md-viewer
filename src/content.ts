import { logError, logEvent, logPrefix, viewerVersion } from "./diagnostics";
import { parsePullUrl } from "./github";
import { prepareDocument, renderMarkdown } from "./markdown";
import { type DisplayedFile, readDisplayedFiles } from "./page";
import { createTree, filterTree, icon } from "./tree";
import type { ChangedFile } from "./types";
import css from "./viewer.css";

logEvent("startup");
const host = document.createElement("gh-md-viewer");
host.dataset.version = viewerVersion;
const shadow = host.attachShadow({ mode: "open" });
const style = document.createElement("style");
style.textContent = css;
shadow.append(style);
const launcher = document.createElement("button");
launcher.type = "button";
launcher.className = "launcher";
launcher.innerHTML = `${icon("markdown")}<span>Markdownプレビュー</span>`;
launcher.hidden = true;
const dialog = document.createElement("dialog");
dialog.setAttribute("aria-labelledby", "viewer-title");
dialog.innerHTML = `<header class="modal-head"><div class="modal-title">${icon("markdown")}<h2 id="viewer-title">Markdownプレビュー</h2><span class="context"></span></div><div class="actions"><button class="tree-toggle icon-button" type="button" aria-label="ファイル一覧" aria-controls="file-list" aria-expanded="false">${icon("sidebar-collapse")}</button><button class="diff-toggle" type="button" aria-label="差分表示" aria-pressed="false"><span class="diff-symbol" aria-hidden="true">−＋</span><span class="diff-label">差分 OFF</span></button><span class="divider"></span><button class="maximize icon-button" type="button" aria-label="最大化" title="最大化" aria-pressed="false">${icon("screen-full")}</button><button class="close icon-button" type="button" aria-label="プレビューを閉じる" title="閉じる · Esc">${icon("x")}</button></div></header><div class="layout"><nav class="file-nav" id="file-list" aria-label="変更されたMarkdownファイル"><header class="tree-head">ファイル<span class="file-count">0</span></header><div class="filter-wrap">${icon("search")}<input class="file-filter" type="search" aria-label="ファイルを絞り込む" placeholder="ファイルを絞り込む…" disabled></div><div class="tree-slot"></div></nav><div class="document-pane"><div class="document-frame"><header class="document-head">${icon("file")}<span class="file-path"></span><span class="version" role="status"></span><button class="return" type="button" aria-label="このファイルの差分へ戻る" disabled>元の差分へ</button></header><div class="document-area"><div class="notice" hidden><span class="notice-text"></span><button class="refresh" type="button">再読み込み</button></div><article class="document" aria-label="Markdown本文"></article></div></div></div></div>`;
shadow.append(launcher, dialog);
document.body.append(host);
function element<T extends HTMLElement>(selector: string): T {
  const node = shadow.querySelector<T>(selector);
  if (!node) throw new Error(`UI要素が見つかりません: ${selector}`);
  return node;
}
const article = element<HTMLElement>(".document");
const area = element<HTMLElement>(".document-area");
const diffButton = element<HTMLButtonElement>(".diff-toggle");
const maxButton = element<HTMLButtonElement>(".maximize");
const fileToggle = element<HTMLButtonElement>(".tree-toggle");
const returnButton = element<HTMLButtonElement>(".return");
const fileFilter = element<HTMLInputElement>(".file-filter");
let files: DisplayedFile[] = [];
let selected: DisplayedFile | null = null;
let diffEnabled = false;
let route = "";
let opener: HTMLElement | null = null;
let previousOverflow = "";

function metrics(): Record<string, number | boolean> {
  return {
    files: files.length,
    selectedIndex: selected ? files.indexOf(selected) : -1,
    ranges: selected?.ranges.length ?? 0,
    diff: diffEnabled,
  };
}
function guarded(stage: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    logError(stage, error, metrics());
    element(".version").textContent = "";
    message(
      error instanceof Error
        ? error.message
        : "プレビューの処理に失敗しました。",
      true,
    );
    const detail = document.createElement("p");
    detail.className = "diagnostic-note";
    detail.textContent = `v${viewerVersion} · 詳細はコンソールの ${logPrefix} ログを確認してください。拡張を更新した後はPR画面も再読み込みしてください。`;
    article.querySelector(".message")?.append(detail);
  }
}
function filesOpen(open: boolean): void {
  element(".layout").classList.toggle("files-open", open);
  fileToggle.setAttribute("aria-expanded", String(open));
}
function render(): void {
  guarded("render", () => {
    if (!selected?.ranges.length) return;
    const started = performance.now();
    logEvent("render:start", metrics());
    const rendered = document.createElement("div");
    article.classList.toggle("with-diff", diffEnabled);
    for (const range of selected.ranges) {
      const section = document.createElement("section");
      section.className = "preview-range";
      const label = (start: number | null, end: number | null) =>
        start === null
          ? "なし"
          : start === end
            ? String(start)
            : `${start}〜${end}`;
      const rangeHead = document.createElement("header");
      rangeHead.className = "range-head";
      rangeHead.textContent = `変更前 ${label(range.beforeStart, range.beforeEnd)} 行 · 変更後 ${label(range.afterStart, range.afterEnd)} 行`;
      const body = document.createElement("div");
      body.innerHTML = renderMarkdown(
        range.before,
        range.after,
        diffEnabled,
        selected.status === "removed",
      );
      if (!body.textContent && !body.querySelector("img,hr,input"))
        body.textContent = "この範囲に表示する本文はありません。";
      section.append(rangeHead, body);
      rendered.append(section);
    }
    prepareDocument(
      rendered,
      selected.filename,
      { before: selected.before, after: selected.after },
      undefined,
      selected.previous_filename ?? selected.filename,
    );
    article.replaceChildren(...rendered.childNodes);
    element(".notice").hidden = false;
    element(".notice-text").textContent =
      "GitHubで読み込まれている行のみを表示しています。省略された行は元の差分で展開し、再読み込みしてください。";
    element(".version").textContent =
      selected.status === "removed" ? "削除前 · 表示範囲" : "変更後 · 表示範囲";
    logEvent("render:complete", {
      ...metrics(),
      durationMs: Math.round(performance.now() - started),
    });
  });
}
function message(text: string, error = false): void {
  article.replaceChildren();
  article.classList.remove("with-diff");
  element(".notice").hidden = true;
  const box = document.createElement("div");
  box.className = "message";
  box.setAttribute("role", error ? "alert" : "status");
  box.textContent = text;
  if (error) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "再読み込み";
    retry.addEventListener("click", refresh);
    actions.append(retry);
    box.append(actions);
  }
  article.append(box);
}
function choose(file: ChangedFile): void {
  guarded("select", () => {
    selected = files.find((item) => item.filename === file.filename) ?? null;
    if (!selected) return;
    logEvent("select", metrics());
    filesOpen(false);
    area.scrollTop = 0;
    if (matchMedia("(max-width:640px)").matches) fileToggle.focus();
    element(".file-path").textContent = selected.filename;
    element(".file-path").title = selected.filename;
    returnButton.disabled = false;
    for (const button of shadow.querySelectorAll<HTMLButtonElement>(
      "[data-filename]",
    )) {
      if (button.dataset.filename === selected.filename)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (!selected.ranges.length) {
      element(".version").textContent = "";
      message(
        "このファイルのソース差分はまだ読み込まれていません。元の差分を開き、ファイル・行を展開してから再読み込みしてください。",
        true,
      );
      return;
    }
    render();
  });
}
function load(preferred?: string): void {
  guarded("read", () => {
    logEvent("read:start");
    selected = null;
    files = [];
    returnButton.disabled = true;
    fileFilter.disabled = true;
    fileFilter.value = "";
    element(".tree-slot").replaceChildren();
    element(".file-count").textContent = "0";
    element(".file-path").textContent = "";
    element(".file-path").removeAttribute("title");
    element(".version").textContent = "";
    const context = parsePullUrl(location.href);
    element(".context").textContent = context
      ? `${context.owner}/${context.repo} #${context.number}`
      : "";
    files = readDisplayedFiles();
    logEvent("read:complete", {
      files: files.length,
      loadedFiles: files.filter((file) => file.ranges.length).length,
      sourceTables: document.querySelectorAll(
        'table[aria-label^="Diff for:"], .diff-table',
      ).length,
      treeItems: document.querySelectorAll('[role="treeitem"]').length,
    });
    element(".file-count").textContent = String(files.length);
    element(".tree-slot").replaceChildren(createTree(files, choose));
    if (!files.length) {
      message(
        /\/pull\/\d+\/(?:files|changes)(?:\/|$)/.test(location.pathname)
          ? "この画面に読み込まれたMarkdownの差分はありません。ファイル一覧でMarkdownファイルを開いてください。"
          : "PRの Files changed タブを開いて、Markdownの差分を表示してください。",
      );
      return;
    }
    fileFilter.disabled = false;
    choose(files.find((file) => file.filename === preferred) ?? files[0]);
  });
}
function maximize(): void {
  const scroll = area.scrollTop;
  const maximized = dialog.classList.toggle("maximized");
  maxButton.setAttribute("aria-pressed", String(maximized));
  maxButton.setAttribute(
    "aria-label",
    maximized ? "元のサイズに戻す" : "最大化",
  );
  maxButton.title = maximized ? "元のサイズに戻す" : "最大化";
  maxButton.innerHTML = icon(maximized ? "screen-normal" : "screen-full");
  requestAnimationFrame(() => {
    area.scrollTop = scroll;
  });
}
function close(): void {
  dialog.close();
}
dialog.addEventListener("close", () => {
  document.documentElement.style.overflow = previousOverflow;
  if (dialog.classList.contains("maximized")) maximize();
  filesOpen(false);
  if (opener?.isConnected) opener.focus();
});
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  close();
});
element(".close").addEventListener("click", close);
maxButton.addEventListener("click", maximize);
fileToggle.addEventListener("click", () =>
  filesOpen(fileToggle.getAttribute("aria-expanded") !== "true"),
);
fileFilter.addEventListener("input", () => {
  const tree = shadow.querySelector<HTMLElement>(".tree-content");
  if (tree) filterTree(tree, fileFilter.value);
});
diffButton.addEventListener("click", () => {
  diffEnabled = !diffEnabled;
  logEvent("diff", metrics());
  diffButton.setAttribute("aria-pressed", String(diffEnabled));
  element(".diff-label").textContent = `差分 ${diffEnabled ? "ON" : "OFF"}`;
  const scroll = area.scrollTop;
  render();
  area.scrollTop = scroll;
});
function refresh(): void {
  logEvent("refresh", metrics());
  load(selected?.filename);
}
element(".refresh").addEventListener("click", refresh);
returnButton.addEventListener("click", () => {
  const file = selected;
  close();
  if (!file) return;
  const node =
    document.getElementById(file.anchor) ??
    (file.node.isConnected ? file.node : null);
  if (node?.matches('[role="treeitem"]'))
    node.querySelector<HTMLAnchorElement>('a[href^="#diff-"]')?.click();
  else node?.scrollIntoView({ block: "start" });
});
function open(from: HTMLElement, preferred?: string): void {
  guarded("open", () => {
    if (!parsePullUrl(location.href) || dialog.open) return;
    logEvent("open");
    opener = from;
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    dialog.showModal();
    element<HTMLButtonElement>(".close").focus();
    load(preferred);
  });
}
launcher.addEventListener("click", () => open(launcher));
function scan(): void {
  guarded("scan", () => {
    const context = parsePullUrl(location.href);
    launcher.hidden = !context;
    const next = context
      ? `${context.owner}/${context.repo}/${context.number}`
      : "";
    if (route && route !== next && dialog.open) close();
    route = next;
    if (!context) return;
    for (const file of readDisplayedFiles(document, false)) {
      const header = file.header;
      if (!header || header.querySelector("[data-md-preview]")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-sm";
      button.dataset.mdPreview = "";
      button.textContent = "Markdownプレビュー";
      button.addEventListener("click", () => open(button, file.filename));
      header.append(button);
    }
  });
}
let scanTimer: ReturnType<typeof setTimeout> | undefined;
const observer = new MutationObserver(() => {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 100);
});
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("popstate", scan);
document.addEventListener("turbo:load", scan);
scan();
