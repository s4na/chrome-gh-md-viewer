export interface PullContext {
  owner: string;
  repo: string;
  number: number;
}
export interface Revision {
  owner: string;
  repo: string;
  sha: string;
}
export interface ChangedFile {
  filename: string;
  previous_filename?: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
}
export interface Snapshot {
  id: string;
  context: PullContext;
  before: Revision;
  after: Revision;
  files: ChangedFile[];
}
export interface FileContents {
  before: string;
  after: string;
}
export type Request =
  | { type: "load-pr" }
  | { type: "load-file"; snapshotId: string; filename: string }
  | {
      type: "load-image";
      snapshotId: string;
      side: "before" | "after";
      path: string;
    }
  | { type: "open-options" };
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
