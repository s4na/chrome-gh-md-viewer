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
      const item = document.createElement("li");
      const folder = document.createElement("details");
      folder.open = true;
      folder.dataset.path = parentPath + name;
      const summary = document.createElement("summary");
      summary.className = "tree-row";
      summary.style.setProperty("--depth", String(depth));
      summary.innerHTML = `${icon("chevron-right")}${icon("file-directory")}<span class="file-name"></span><span></span>`;
      summary
        .querySelector(".file-name")
        ?.append(document.createTextNode(name));
      summary.title = parentPath + name;
      folder.append(summary, draw(child, depth + 1, `${parentPath}${name}/`));
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
  return tree;
}
