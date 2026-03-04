/* ── Git version-control types ──────────────────────────── */

export interface GitStatusFile {
  path: string;
  status: 'M' | 'A' | 'D' | '?' | 'R' | 'MM' | 'UU';
  staged: boolean;
}

export interface GitStatus {
  initialized: boolean;
  branch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
  hasRemote: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
}

export interface GitBranch {
  name: string;
  current: boolean;
  tracking?: string;
}

export interface GitDiffEntry {
  file: string;
  insertions: number;
  deletions: number;
  diff: string;
}

/* ── GitHub integration types ──────────────────────────── */

export interface GitHubConnection {
  connected: boolean;
  username?: string;
  avatarUrl?: string;
}

export interface GitHubRepo {
  fullName: string;
  htmlUrl: string;
  private: boolean;
  cloneUrl: string;
}
