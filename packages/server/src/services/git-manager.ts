import { simpleGit, type SimpleGit } from 'simple-git';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import type {
  GitStatus, GitStatusFile, GitCommit,
  GitBranch, GitDiffEntry,
} from '@forgeflow/types';

const LOG_PREFIX = '[GitManager]';
function log(...args: unknown[]) { console.log(LOG_PREFIX, ...args); }

/** Per-project mutex to prevent concurrent git operations (avoids index.lock errors) */
class GitMutex {
  private locks = new Map<string, Promise<void>>();

  async acquire<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any pending operation on this project
    while (this.locks.has(projectId)) {
      await this.locks.get(projectId);
    }

    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    this.locks.set(projectId, promise);

    try {
      return await fn();
    } finally {
      this.locks.delete(projectId);
      resolve();
    }
  }
}

const mutex = new GitMutex();

const DEFAULT_GITIGNORE = `# ForgeFlow auto-generated
references/
copilot-chats/
*.log
.DS_Store
`;

export class GitManager {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? join(homedir(), '.forgeflow', 'projects');
  }

  private projectDir(id: string): string {
    return join(this.basePath, id);
  }

  private git(projectId: string): SimpleGit {
    return simpleGit(this.projectDir(projectId));
  }

  /** Remove stale lock file if it exists (e.g. from a crashed operation) */
  private async cleanLock(projectId: string): Promise<void> {
    const lockPath = join(this.projectDir(projectId), '.git', 'index.lock');
    try {
      if (existsSync(lockPath)) {
        await unlink(lockPath);
        log(`Removed stale lock file for project ${projectId}`);
      }
    } catch { /* ignore */ }
  }

  /** Check if project has a .git directory */
  isInitialized(projectId: string): boolean {
    return existsSync(join(this.projectDir(projectId), '.git'));
  }

  /** Initialize git repo if not already, write .gitignore, create initial commit */
  async ensureInit(projectId: string): Promise<void> {
    if (this.isInitialized(projectId)) return;

    await mutex.acquire(projectId, async () => {
      // Double-check after acquiring lock
      if (this.isInitialized(projectId)) return;

      const dir = this.projectDir(projectId);
      if (!existsSync(dir)) throw new Error(`Project directory not found: ${dir}`);

      const git = simpleGit(dir);
      await git.init();

      // Write .gitignore
      const ignorePath = join(dir, '.gitignore');
      if (!existsSync(ignorePath)) {
        await writeFile(ignorePath, DEFAULT_GITIGNORE);
      }

      // Initial commit
      await git.add('-A');
      await git.commit('Initial commit');
      log(`Initialized git repo for project ${projectId}`);
    });
  }

  /** Get git status for project */
  async status(projectId: string): Promise<GitStatus> {
    if (!this.isInitialized(projectId)) {
      return {
        initialized: false,
        branch: 'main',
        tracking: null,
        ahead: 0,
        behind: 0,
        files: [],
        hasRemote: false,
      };
    }

    return mutex.acquire(projectId, async () => {
    await this.cleanLock(projectId);
    const git = this.git(projectId);
    const s = await git.status();

    const files: GitStatusFile[] = [];

    // Staged files
    for (const f of s.created) {
      files.push({ path: f, status: 'A', staged: true });
    }
    for (const f of s.staged) {
      // staged contains modified files that are in the index
      if (!s.created.includes(f)) {
        files.push({ path: f, status: 'M', staged: true });
      }
    }
    for (const f of s.deleted) {
      files.push({ path: f, status: 'D', staged: true });
    }
    for (const f of s.renamed) {
      files.push({ path: f.to, status: 'R', staged: true });
    }

    // Unstaged / working tree changes
    for (const f of s.modified) {
      // Avoid duplicating files that are both staged and modified
      const existing = files.find(e => e.path === f);
      if (existing) {
        existing.status = 'MM';
      } else {
        files.push({ path: f, status: 'M', staged: false });
      }
    }
    for (const f of s.not_added) {
      files.push({ path: f, status: '?', staged: false });
    }
    for (const f of s.conflicted) {
      files.push({ path: f, status: 'UU', staged: false });
    }

    // Check for remote
    let hasRemote = false;
    try {
      const remotes = await git.getRemotes(true);
      hasRemote = remotes.length > 0;
    } catch { /* no remotes */ }

    return {
      initialized: true,
      branch: s.current || 'main',
      tracking: s.tracking || null,
      ahead: s.ahead,
      behind: s.behind,
      files,
      hasRemote,
    };
    });
  }

  /** Stage all changes */
  async stageAll(projectId: string): Promise<void> {
    await this.ensureInit(projectId);
    await mutex.acquire(projectId, () => this.git(projectId).add('-A'));
  }

  /** Stage specific files */
  async stageFiles(projectId: string, paths: string[]): Promise<void> {
    await this.ensureInit(projectId);
    await mutex.acquire(projectId, () => this.git(projectId).add(paths));
  }

  /** Unstage specific files */
  async unstageFiles(projectId: string, paths: string[]): Promise<void> {
    await this.ensureInit(projectId);
    await mutex.acquire(projectId, () => this.git(projectId).reset(['HEAD', '--', ...paths]));
  }

  /** Commit staged changes */
  async commit(projectId: string, message: string): Promise<string> {
    await this.ensureInit(projectId);
    return mutex.acquire(projectId, async () => {
      const result = await this.git(projectId).commit(message);
      const hash = result.commit || '';
      log(`Committed ${hash.substring(0, 7)} to project ${projectId}`);
      return hash;
    });
  }

  /** Get commit log */
  async log(projectId: string, limit = 50): Promise<GitCommit[]> {
    if (!this.isInitialized(projectId)) return [];

    return mutex.acquire(projectId, async () => {
      const git = this.git(projectId);
      const result = await git.log({ maxCount: limit, '--stat': null });

      return result.all.map(entry => ({
        hash: entry.hash,
        message: entry.message,
        author: entry.author_name,
        date: entry.date,
        filesChanged: (entry as any).diff?.files?.length ?? 0,
      }));
    });
  }

  /** Get diff for a specific commit or working tree */
  async diff(projectId: string, hash?: string): Promise<GitDiffEntry[]> {
    if (!this.isInitialized(projectId)) return [];

    return mutex.acquire(projectId, async () => {
      const git = this.git(projectId);
      let diffText: string;

      if (hash) {
        diffText = await git.diff([`${hash}~1`, hash]);
      } else {
        diffText = await git.diff();
        const stagedDiff = await git.diff(['--cached']);
        if (stagedDiff) {
          diffText = (diffText ? diffText + '\n' : '') + stagedDiff;
        }
      }

      return parseDiffText(diffText);
    });
  }

  /** List branches */
  async branches(projectId: string): Promise<GitBranch[]> {
    if (!this.isInitialized(projectId)) return [];

    return mutex.acquire(projectId, async () => {
      const git = this.git(projectId);
      const result = await git.branch(['-v', '--no-color']);

      return Object.entries(result.branches).map(([name, info]) => ({
        name,
        current: info.current,
        tracking: (info as any).tracking || undefined,
      }));
    });
  }

  /** Create and checkout a new branch */
  async createBranch(projectId: string, name: string): Promise<void> {
    await this.ensureInit(projectId);
    await mutex.acquire(projectId, async () => {
      await this.git(projectId).checkoutLocalBranch(name);
      log(`Created branch ${name} in project ${projectId}`);
    });
  }

  /** Switch to an existing branch */
  async switchBranch(projectId: string, name: string): Promise<void> {
    await this.ensureInit(projectId);
    await mutex.acquire(projectId, async () => {
      await this.git(projectId).checkout(name);
      log(`Switched to branch ${name} in project ${projectId}`);
    });
  }

  /** Push to remote */
  async push(projectId: string): Promise<void> {
    await mutex.acquire(projectId, async () => {
      const git = this.git(projectId);
      const status = await git.status();
      const branch = status.current || 'main';

      if (!status.tracking) {
        await git.push(['-u', 'origin', branch]);
      } else {
        await git.push();
      }
      log(`Pushed ${branch} for project ${projectId}`);
    });
  }

  /** Pull from remote */
  async pull(projectId: string): Promise<number> {
    return mutex.acquire(projectId, async () => {
      const git = this.git(projectId);
      const result = await git.pull();
      const commits = result.summary.changes;
      log(`Pulled ${commits} change(s) for project ${projectId}`);
      return commits;
    });
  }

  /** Hard reset to a specific commit */
  async resetToCommit(projectId: string, hash: string): Promise<void> {
    await this.ensureInit(projectId);
    await mutex.acquire(projectId, async () => {
      await this.cleanLock(projectId);
      await this.git(projectId).reset(['--hard', hash]);
      log(`Reset project ${projectId} to ${hash.substring(0, 7)}`);
    });
  }

  /** Add remote origin */
  async addRemote(projectId: string, url: string): Promise<void> {
    await this.ensureInit(projectId);
    await mutex.acquire(projectId, async () => {
      const git = this.git(projectId);
      try { await git.removeRemote('origin'); } catch { /* no existing remote */ }
      await git.addRemote('origin', url);
      log(`Set remote origin to ${url} for project ${projectId}`);
    });
  }

  /** Get remote origin URL */
  async getRemote(projectId: string): Promise<string | null> {
    if (!this.isInitialized(projectId)) return null;

    return mutex.acquire(projectId, async () => {
      try {
        const remotes = await this.git(projectId).getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        return origin?.refs?.push || origin?.refs?.fetch || null;
      } catch {
        return null;
      }
    });
  }
}

/* ── Diff parser ────────────────────────────────────────── */

function parseDiffText(text: string): GitDiffEntry[] {
  if (!text.trim()) return [];

  const entries: GitDiffEntry[] = [];
  const fileDiffs = text.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileDiffs) {
    const lines = chunk.split('\n');
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    const file = headerMatch?.[2] ?? headerMatch?.[1] ?? 'unknown';

    let insertions = 0;
    let deletions = 0;
    const diffLines: string[] = [];
    let inHunk = false;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        inHunk = true;
        diffLines.push(line);
      } else if (inHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          insertions++;
          diffLines.push(line);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
          diffLines.push(line);
        } else if (line.startsWith(' ') || line === '') {
          diffLines.push(line);
        }
      }
    }

    entries.push({
      file,
      insertions,
      deletions,
      diff: diffLines.join('\n'),
    });
  }

  return entries;
}
