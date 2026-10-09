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
