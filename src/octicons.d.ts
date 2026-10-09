declare module "@primer/octicons" {
  type IconName =
    | "chevron-right"
    | "file-directory"
    | "file"
    | "diff-added"
    | "diff-removed"
    | "diff-modified"
    | "screen-full"
    | "screen-normal"
    | "x"
    | "sidebar-collapse"
    | "sidebar-expand"
    | "markdown"
    | "search";
  const icons: Record<
    IconName,
    { toSVG(options?: Record<string, string | number>): string }
  >;
  export default icons;
}
