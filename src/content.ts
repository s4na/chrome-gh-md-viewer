import { isMarkdown, parsePullUrl } from "./github";
import { prepareDocument, renderMarkdown } from "./markdown";
import { createTree, filterTree, icon } from "./tree";
import type {
  ChangedFile,
  FileContents,
  Request,
  Response,
  Snapshot,
} from "./types";
import css from "./viewer.css";

async function request<T>(message: Request): Promise<T> {
  const response = await chrome.runtime.sendMessage<Request, Response<T>>(
    message,
  );
  if (!response?.ok)
    throw new Error(
      response?.error ?? "拡張を再読み込みしてからPRを開き直してください。",
    );
  return response.data;
}
const host = document.createElement("gh-md-viewer");
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
dialog.innerHTML = `<header class="modal-head"><div class="modal-title">${icon("markdown")}<h2 id="viewer-title">Markdownプレビュー</h2><span class="context"></span></div><div class="actions"><button class="tree-toggle icon-button" type="button" aria-label="ファイル一覧" aria-controls="file-list" aria-expanded="false">${icon("sidebar-collapse")}</button><button class="diff-toggle" type="button" aria-label="差分表示" aria-pressed="false"><span class="diff-symbol" aria-hidden="true">−＋</span><span class="diff-label">差分 OFF</span></button><span class="divider"></span><button class="maximize icon-button" type="button" aria-label="最大化" title="最大化" aria-pressed="false">${icon("screen-full")}</button><button class="close icon-button" type="button" aria-label="プレビューを閉じる" title="閉じる · Esc">${icon("x")}</button></div></header><div class="layout"><nav class="file-nav" id="file-list" aria-label="変更されたMarkdownファイル"><header class="tree-head">ファイル<span class="file-count">0</span></header><div class="filter-wrap">${icon("search")}<input class="file-filter" type="search" aria-label="ファイルを絞り込む" placeholder="ファイルを絞り込む…" disabled></div><div class="tree-slot"></div></nav><div class="document-pane"><div class="document-frame"><header class="document-head">${icon("file")}<span class="file-path"></span><span class="version" role="status"></span><button class="return" type="button" aria-label="このファイルの差分へ戻る" disabled>元の差分へ</button></header><div class="document-area"><div class="notice" hidden>削除されたファイルの変更前を表示しています。</div><article class="document" aria-label="Markdown本文"></article></div></div></div></div>`;
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
let snapshot: Snapshot | null = null;
let selected: ChangedFile | null = null;
let contents: FileContents | null = null;
let diffEnabled = false;
let requestVersion = 0;
let route = "";
let opener: HTMLElement | null = null;
let previousOverflow = "";
const cache = new Map<string, FileContents>();

function filesOpen(open: boolean): void {
  element(".layout").classList.toggle("files-open", open);
  fileToggle.setAttribute("aria-expanded", String(open));
}
function render(): void {
  if (!snapshot || !selected || !contents) return;
  article.classList.toggle("with-diff", diffEnabled);
  article.innerHTML = renderMarkdown(
    contents.before,
    contents.after,
    diffEnabled,
    selected.status === "removed",
  );
  prepareDocument(
    article,
    selected.filename,
    { before: snapshot.before, after: snapshot.after },
    (path, side) =>
      request<string>({
        type: "load-image",
        snapshotId: snapshot?.id ?? "",
        side,
        path,
      }),
    selected.previous_filename ?? selected.filename,
  );
  if (!article.childNodes.length)
    article.textContent = "このMarkdownファイルは空です。";
  element(".notice").hidden = selected.status !== "removed";
  element(".version").textContent =
    `${selected.status === "removed" ? "削除前" : "変更後"} ${(selected.status === "removed" ? snapshot.before.sha : snapshot.after.sha).slice(0, 7)}`;
  for (const button of shadow.querySelectorAll<HTMLButtonElement>(
    "[data-filename]",
  )) {
    if (button.dataset.filename === selected.filename)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
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
    retry.addEventListener("click", () => {
      void load();
    });
    const settings = document.createElement("button");
    settings.type = "button";
    settings.textContent = "拡張の設定";
    settings.addEventListener("click", () => {
      void request({ type: "open-options" });
    });
    actions.append(retry, settings);
    box.append(actions);
  }
  article.append(box);
}
async function choose(file: ChangedFile): Promise<void> {
  if (!snapshot) return;
  const version = ++requestVersion;
  selected = file;
  contents = null;
  filesOpen(false);
  area.scrollTop = 0;
  if (matchMedia("(max-width:640px)").matches) fileToggle.focus();
  message("Markdown全文を読み込んでいます…");
  element(".file-path").textContent = file.filename;
  element(".file-path").title = file.filename;
  element(".version").textContent = "";
  for (const button of shadow.querySelectorAll<HTMLButtonElement>(
    "[data-filename]",
  )) {
    if (button.dataset.filename === file.filename)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  try {
    const data =
      cache.get(file.filename) ??
      (await request<FileContents>({
        type: "load-file",
        snapshotId: snapshot.id,
        filename: file.filename,
      }));
    if (version !== requestVersion || !dialog.open) return;
    cache.set(file.filename, data);
    contents = data;
    render();
  } catch (error) {
    if (version === requestVersion)
      message(
        error instanceof Error ? error.message : "読み込みに失敗しました。",
        true,
      );
  }
}
async function load(preferred?: string): Promise<void> {
  const version = ++requestVersion;
  selected = null;
  contents = null;
  snapshot = null;
  cache.clear();
  returnButton.disabled = true;
  fileFilter.disabled = true;
  fileFilter.value = "";
  element(".tree-slot").replaceChildren();
  element(".file-count").textContent = "0";
  element(".file-path").textContent = "";
  element(".file-path").removeAttribute("title");
  element(".version").textContent = "";
  element(".context").textContent = "";
  message("PRの変更ファイルを読み込んでいます…");
  try {
    const data = await request<Snapshot>({ type: "load-pr" });
    if (version !== requestVersion || !dialog.open) return;
    snapshot = data;
    element(".context").textContent =
      `${data.context.owner}/${data.context.repo} #${data.context.number}`;
    element(".file-count").textContent = String(data.files.length);
    element(".tree-slot").replaceChildren(
      createTree(data.files, (file) => {
        void choose(file);
      }),
    );
    if (!data.files.length) {
      message("このPRには変更されたMarkdownファイルがありません。");
      return;
    }
    returnButton.disabled = false;
    fileFilter.disabled = false;
    await choose(
      data.files.find((file) => file.filename === preferred) ?? data.files[0],
    );
  } catch (error) {
    if (version === requestVersion)
      message(
        error instanceof Error ? error.message : "読み込みに失敗しました。",
        true,
      );
  }
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
  requestVersion++;
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
  diffButton.setAttribute("aria-pressed", String(diffEnabled));
  element(".diff-label").textContent = `差分 ${diffEnabled ? "ON" : "OFF"}`;
  const scroll = area.scrollTop;
  render();
  area.scrollTop = scroll;
});
returnButton.addEventListener("click", () => {
  const filename = selected?.filename;
  close();
  if (filename)
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-path],[data-file-path],[data-tagsearch-path]",
      ),
    )
      .find((node) =>
        [
          node.dataset.path,
          node.dataset.filePath,
          node.dataset.tagsearchPath,
        ].includes(filename),
      )
      ?.scrollIntoView({ block: "start" });
});
function open(from: HTMLElement, preferred?: string): void {
  if (!parsePullUrl(location.href) || dialog.open) return;
  opener = from;
  previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  dialog.showModal();
  element<HTMLButtonElement>(".close").focus();
  void load(preferred);
}
launcher.addEventListener("click", () => open(launcher));
function scan(): void {
  const context = parsePullUrl(location.href);
  launcher.hidden = !context;
  const next = context
    ? `${context.owner}/${context.repo}/${context.number}`
    : "";
  if (route && route !== next && dialog.open) close();
  route = next;
  if (!context) return;
  for (const node of document.querySelectorAll<HTMLElement>(
    ".file[data-path],[data-file-path],[data-tagsearch-path]",
  )) {
    const path =
      node.dataset.path ?? node.dataset.filePath ?? node.dataset.tagsearchPath;
    if (!path || !isMarkdown(path)) continue;
    const header =
      node.querySelector<HTMLElement>(
        ".file-header,[data-testid='diff-file-header'],[data-testid='file-header']",
      ) ??
      (node.matches(
        ".file-header,[data-testid='diff-file-header'],[data-testid='file-header']",
      )
        ? node
        : null);
    if (!header || header.querySelector("[data-md-preview]")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm";
    button.dataset.mdPreview = "";
    button.textContent = "Markdownプレビュー";
    button.addEventListener("click", () => open(button, path));
    header.append(button);
  }
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
