interface Row {
  before?: number;
  after?: number;
  kind: "context" | "added" | "removed" | "hunk";
  text: string;
}
function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
export function diffFile(
  filename: string,
  rows: Row[],
  anchor = "diff-fixture",
): string {
  return `<section role="region" id="${html(anchor)}" aria-labelledby="${html(anchor)}-heading"><header><h3 id="${html(anchor)}-heading"><code>${html(filename)}</code></h3></header><table role="grid" aria-label="Diff for: ${html(filename)}" data-diff-anchor="${html(anchor)}"><tbody>${rows
    .map((row) => {
      if (row.kind === "hunk")
        return `<tr><td class="diff-hunk-cell"><code class="hunk">${html(row.text)}</code></td></tr>`;
      const marker =
        row.kind === "added" ? "+" : row.kind === "removed" ? "-" : "";
      const kind =
        row.kind === "added"
          ? "addition"
          : row.kind === "removed"
            ? "deletion"
            : "";
      const side = row.kind === "removed" ? "left" : "right";
      return `<tr><td data-diff-side="left" ${row.before ? `data-line-number="${row.before}"` : ""}>${row.before ?? ""}</td><td data-diff-side="right" ${row.after ? `data-line-number="${row.after}"` : ""}>${row.after ?? ""}</td><td class="diff-text-cell" data-diff-side="${side}" data-line-number="${side === "left" ? (row.before ?? "") : (row.after ?? "")}"><code class="diff-text ${kind}"><span class="diff-text-marker">${marker}</span><div class="diff-text-inner">${html(row.text)}</div></code></td></tr>`;
    })
    .join("")}</tbody></table></section>`;
}
