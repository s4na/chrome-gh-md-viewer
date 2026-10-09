import octicons from "@primer/octicons";
import type { ChangedFile } from "./types";

export function icon(name: keyof typeof octicons): string {
  return octicons[name].toSVG({ "aria-hidden": "true", width: 16, height: 16 });
}
export function createTree(
  files: ChangedFile[],
  onSelect: (file: ChangedFile) => void,
): HTMLElement {
  interface Node {
    directories: Map<string, Node>;
    files: ChangedFile[];
  }
  const root: Node = { directories: new Map(), files: [] };
  for (const file of files) {
    let current = root;
    for (const part of file.filename.split("/").slice(0, -1)) {
      if (!current.directories.has(part))
        current.directories.set(part, { directories: new Map(), files: [] });
      current = current.directories.get(part) as Node;
    }
    current.files.push(file);
  }
  function draw(
    node: Node,
    depth: number,
    parentPath: string,
  ): HTMLUListElement {
    const list = document.createElement("ul");
    for (const [name, child] of Array.from(node.directories).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      let label = name;
      let directory = child;
      while (!directory.files.length && directory.directories.size === 1) {
        const [nextName, next] = Array.from(directory.directories)[0];
        label += `/${nextName}`;
        directory = next;
      }
      const item = document.createElement("li");
      const folder = document.createElement("details");
      folder.open = true;
      folder.dataset.path = parentPath + label;
      const summary = document.createElement("summary");
      summary.className = "tree-row tree-folder";
      summary.style.setProperty("--depth", String(depth));
      summary.innerHTML = `${icon("chevron-right")}${icon("file-directory")}<span class="file-name"></span><span></span>`;
      summary
        .querySelector(".file-name")
        ?.append(document.createTextNode(label));
      summary.title = parentPath + label;
      folder.append(
        summary,
        draw(directory, depth + 1, `${parentPath}${label}/`),
      );
      item.append(folder);
      list.append(item);
    }
    for (const file of node.files.sort((a, b) =>
      a.filename.localeCompare(b.filename),
    )) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tree-row";
      button.style.setProperty("--depth", String(depth));
      button.dataset.filename = file.filename;
      const status =
        file.status === "added" || file.status === "copied"
          ? "added"
          : file.status === "removed"
            ? "removed"
            : "modified";
      const label =
        status === "added" ? "追加" : status === "removed" ? "削除" : "変更";
      button.title = `${file.filename} · ${label}`;
      button.setAttribute("aria-label", `${file.filename}、${label}`);
      button.innerHTML = `<span></span>${icon("file")}<span class="file-name"></span><span class="file-status ${status}">${icon(status === "added" ? "diff-added" : status === "removed" ? "diff-removed" : "diff-modified")}</span>`;
      button
        .querySelector(".file-name")
        ?.append(
          document.createTextNode(
            file.filename.split("/").at(-1) ?? file.filename,
          ),
        );
      button.addEventListener("click", () => onSelect(file));
      item.append(button);
      list.append(item);
    }
    return list;
  }
  const tree = document.createElement("div");
  tree.className = "tree-content";
  tree.append(draw(root, 0, ""));
  const empty = document.createElement("p");
  empty.className = "tree-empty";
  empty.textContent = "一致するファイルがありません。";
  empty.setAttribute("role", "status");
  empty.hidden = true;
  tree.append(empty);
  return tree;
}

export function filterTree(tree: HTMLElement, value: string): void {
  const query = value.trim().toLocaleLowerCase();
  const files = Array.from(
    tree.querySelectorAll<HTMLButtonElement>("[data-filename]"),
  );
  for (const button of files)
    button.hidden = !button.dataset.filename
      ?.toLocaleLowerCase()
      .includes(query);
  const folders = Array.from(
    tree.querySelectorAll<HTMLDetailsElement>("details"),
  );
  for (const folder of folders) {
    if (query && folder.dataset.filterOpen === undefined)
      folder.dataset.filterOpen = String(folder.open);
    const visible = Array.from(
      folder.querySelectorAll<HTMLButtonElement>("[data-filename]"),
    ).some((button) => !button.hidden);
    folder.hidden = !visible;
    if (query) folder.open = visible;
    else if (folder.dataset.filterOpen !== undefined) {
      folder.open = folder.dataset.filterOpen === "true";
      delete folder.dataset.filterOpen;
    }
  }
  const empty = tree.querySelector<HTMLElement>(".tree-empty");
  if (empty) empty.hidden = files.some((file) => !file.hidden);
}
