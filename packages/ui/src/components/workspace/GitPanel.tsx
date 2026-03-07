import { useState, useCallback, useEffect, useRef } from 'react';
import type { GitDiffEntry } from '@forgeflow/types';
import { useGit } from '../../context/GitContext';

/* ── Tab definitions ─────────────────────────────────── */

const GIT_TABS = [
  { id: 'status', label: 'Changes' },
  { id: 'commit', label: 'Commit' },
  { id: 'history', label: 'History' },
  { id: 'branches', label: 'Branches' },
] as const;

type TabId = typeof GIT_TABS[number]['id'];

/* ── Main component ──────────────────────────────────── */

interface GitPanelProps {
  onClose: () => void;
}

export function GitPanel({ onClose }: GitPanelProps) {
  const git = useGit();
  const [activeTab, setActiveTab] = useState<TabId>('status');
  // Lifted so commit message persists across tab switches
  const [commitMessage, setCommitMessage] = useState('');

  // Poll status periodically when panel is visible
  useEffect(() => {
    const interval = setInterval(() => git.refresh(), 5000);
    return () => clearInterval(interval);
  }, [git.refresh]);

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Header / tab bar */}
      <div className="shrink-0 flex items-center gap-0 border-b border-[var(--color-border)] bg-[var(--color-sidebar-bg)] min-h-[32px]">
        {/* Branch indicator */}
        <div className="flex items-center gap-1.5 px-3 border-r border-[var(--color-border)]">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M6 3v12m0 0a3 3 0 1 0 3 3M6 15a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3V3" />
          </svg>
          <span className="text-xs font-mono text-gray-500">
            {git.status?.branch || 'main'}
          </span>
          {(git.status?.ahead ?? 0) > 0 && (
            <span className="text-[10px] bg-blue-500/15 text-blue-600 px-1 rounded">{git.status!.ahead}↑</span>
          )}
          {(git.status?.behind ?? 0) > 0 && (
            <span className="text-[10px] bg-amber-500/15 text-amber-600 px-1 rounded">{git.status!.behind}↓</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center">
          {GIT_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-[var(--color-node-agent)] border-b-2 border-[var(--color-node-agent)]'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.id === 'status' && git.status && git.status.files.length > 0 && (
                <span className="ml-1 text-[10px] bg-amber-500/15 text-amber-600 px-1 rounded">
                  {git.status.files.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-1 px-2">
          {git.status?.hasRemote && (
            <>
              <button
                onClick={() => git.pull()}
                disabled={git.loading}
                className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-40"
                title="Pull"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </button>
              <button
                onClick={() => git.push()}
                disabled={git.loading}
                className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-40"
                title="Push"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700"
            title="Close"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {git.error && (
        <div className="shrink-0 px-3 py-1.5 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between">
          <span>{git.error}</span>
          <button onClick={() => git.refresh()} className="text-red-500 hover:text-red-700 underline">Retry</button>
        </div>
      )}

      {/* Not initialized banner */}
      {git.status && !git.status.initialized && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path d="M6 3v12m0 0a3 3 0 1 0 3 3M6 15a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3V3" />
          </svg>
          <p className="text-xs text-gray-500">Version control is not initialized for this project</p>
          <button
            onClick={() => git.init()}
            disabled={git.loading}
            className="px-3 py-1.5 text-xs font-medium bg-[var(--color-node-agent)] text-white rounded hover:opacity-90 disabled:opacity-50"
          >
            {git.loading ? 'Initializing...' : 'Initialize Git'}
          </button>
        </div>
      )}

      {/* Tab content */}
      {git.status?.initialized && (
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'status' && <StatusTab />}
          {activeTab === 'commit' && <CommitTab message={commitMessage} setMessage={setCommitMessage} />}
          {activeTab === 'history' && <HistoryTab />}
          {activeTab === 'branches' && <BranchesTab />}
        </div>
      )}
    </div>
  );
}

/* ── Status Tab ──────────────────────────────────────── */

function StatusTab() {
  const git = useGit();
  const files = git.status?.files ?? [];

  const stagedFiles = files.filter(f => f.staged);
  const unstagedFiles = files.filter(f => !f.staged);

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-gray-400">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs">Working tree clean</span>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-3">
      {/* Staged files */}
      {stagedFiles.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Staged ({stagedFiles.length})
            </span>
            <button
              onClick={() => git.unstageFiles(stagedFiles.map(f => f.path))}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              Unstage All
            </button>
          </div>
          {stagedFiles.map(f => (
            <FileRow
              key={f.path}
              path={f.path}
              status={f.status}
              staged
              onToggle={() => git.unstageFiles([f.path])}
            />
          ))}
        </div>
      )}

      {/* Unstaged / untracked files */}
      {unstagedFiles.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Changes ({unstagedFiles.length})
            </span>
            <button
              onClick={() => git.stageAll()}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              Stage All
            </button>
          </div>
          {unstagedFiles.map(f => (
            <FileRow
              key={f.path}
              path={f.path}
              status={f.status}
              staged={false}
              onToggle={() => git.stageFiles([f.path])}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── File row ────────────────────────────────────────── */

function FileRow({
  path, status, staged, onToggle,
}: {
  path: string;
  status: string;
  staged: boolean;
  onToggle: () => void;
}) {
  const statusColors: Record<string, string> = {
    'M': 'text-amber-500',
    'MM': 'text-amber-500',
    'A': 'text-emerald-500',
    'D': 'text-red-500',
    '?': 'text-gray-400',
    'R': 'text-blue-500',
    'UU': 'text-red-600',
  };

  return (
    <div className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-gray-50 group">
      <button
        onClick={onToggle}
        className="w-4 h-4 rounded border border-gray-300 flex items-center justify-center text-[10px] hover:border-gray-500 shrink-0"
        title={staged ? 'Unstage' : 'Stage'}
      >
        {staged && (
          <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <span className={`text-xs font-mono w-5 text-center ${statusColors[status] ?? 'text-gray-500'}`}>
        {status}
      </span>
      <span className="text-xs font-mono text-gray-700 truncate">{path}</span>
    </div>
  );
}

/* ── Commit Tab ──────────────────────────────────────── */

function CommitTab({ message, setMessage }: { message: string; setMessage: (m: string) => void }) {
  const git = useGit();
  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning'; text: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stagedCount = git.status?.files.filter(f => f.staged).length ?? 0;

  const handleCommit = useCallback(async () => {
    if (git.loading) return;
    if (stagedCount === 0) {
      setFeedback({ type: 'warning', text: 'No files staged. Go to Changes tab to stage files.' });
      setTimeout(() => setFeedback(null), 3000);
      return;
    }
    if (!message.trim()) return;
    try {
      // Set success feedback before await so it's visible during the status refresh re-render
      setFeedback({ type: 'success', text: 'Successfully committed.' });
      setMessage('');
      await git.commit(message.trim());
      setTimeout(() => setFeedback(null), 3000);
    } catch {
      setFeedback(null);
    }
  }, [stagedCount, message, git.loading, git.commit, setMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
    }
  }, [handleCommit]);

  return (
    <div className="p-3 space-y-3">
      {/* Feedback / staged summary */}
      <div className="text-xs text-gray-500">
        {feedback ? (
          <span className={feedback.type === 'success' ? 'text-emerald-600' : 'text-amber-600'}>{feedback.text}</span>
        ) : stagedCount > 0 ? (
          <span>{stagedCount} file{stagedCount !== 1 ? 's' : ''} staged for commit</span>
        ) : null}
      </div>

      {/* Commit message */}
      <div>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          className="w-full text-xs font-mono bg-white border border-gray-200 rounded p-2 resize-none focus:outline-none focus:border-[var(--color-node-agent)] focus:ring-1 focus:ring-[var(--color-node-agent)]/20"
          rows={3}
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-gray-400">
            {(navigator.platform ?? '').includes('Mac') ? '⌘' : 'Ctrl'}+Enter to commit
          </span>
          <button
            onClick={handleCommit}
            disabled={git.loading || !message.trim()}
            className="px-3 py-1 text-xs font-medium bg-[var(--color-node-agent)] text-white rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {git.loading ? 'Committing...' : 'Commit'}
          </button>
        </div>
      </div>

      {/* Last commit info */}
      {git.commits.length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <span className="text-[10px] text-gray-400">Last commit: </span>
          <span className="text-[10px] font-mono text-gray-500">{git.commits[0].hash.substring(0, 7)}</span>
          <span className="text-[10px] text-gray-500"> — {git.commits[0].message}</span>
        </div>
      )}
    </div>
  );
}

/* ── History Tab ─────────────────────────────────────── */

function HistoryTab() {
  const git = useGit();
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [diffEntries, setDiffEntries] = useState<GitDiffEntry[]>([]);
  const [loadingDiff, setLoadingDiff] = useState(false);

  useEffect(() => {
    git.fetchLog();
  }, [git.fetchLog]);

  const toggleDiff = useCallback(async (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
      setDiffEntries([]);
      return;
    }
    setExpandedHash(hash);
    setLoadingDiff(true);
    try {
      const entries = await git.fetchDiff(hash);
      setDiffEntries(entries);
    } finally {
      setLoadingDiff(false);
    }
  }, [expandedHash, git.fetchDiff]);

  const handleReset = useCallback(async (hash: string) => {
    if (!window.confirm(`Reset to commit ${hash.substring(0, 7)}? This will discard all changes after this commit.`)) {
      return;
    }
    await git.resetToCommit(hash);
  }, [git.resetToCommit]);

  if (git.commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-gray-400">
        <span className="text-xs">No commits yet</span>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {git.commits.map((c) => (
        <div key={c.hash}>
          <div
            className="flex items-start gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer group"
            onClick={() => toggleDiff(c.hash)}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-node-agent)] mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-800 truncate">{c.message}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-mono text-gray-400">{c.hash.substring(0, 7)}</span>
                <span className="text-[10px] text-gray-400">{c.author}</span>
                <span className="text-[10px] text-gray-400">{formatDate(c.date)}</span>
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleReset(c.hash); }}
              className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 hover:text-red-500 px-1.5 py-0.5 rounded border border-gray-200 hover:border-red-200 transition-all"
              title="Reset to this commit"
            >
              Reset
            </button>
          </div>

          {/* Expanded diff */}
          {expandedHash === c.hash && (
            <div className="px-3 pb-2 bg-gray-50">
              {loadingDiff ? (
                <div className="text-[10px] text-gray-400 py-2">Loading diff...</div>
              ) : diffEntries.length === 0 ? (
                <div className="text-[10px] text-gray-400 py-2">No changes in this commit</div>
              ) : (
                <div className="space-y-2">
                  {diffEntries.map((entry) => (
                    <DiffBlock key={entry.file} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Diff block ──────────────────────────────────────── */

function DiffBlock({ entry }: { entry: GitDiffEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <div
        className="flex items-center gap-2 px-2 py-1 bg-white cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-gray-400">{expanded ? '▾' : '▸'}</span>
        <span className="text-xs font-mono text-gray-700 truncate">{entry.file}</span>
        <span className="text-[10px] text-emerald-500">+{entry.insertions}</span>
        <span className="text-[10px] text-red-500">-{entry.deletions}</span>
      </div>
      {expanded && entry.diff && (
        <pre className="text-[10px] font-mono p-2 bg-gray-50 overflow-x-auto max-h-[200px] overflow-y-auto leading-4">
          {entry.diff.split('\n').map((line, i) => (
            <div
              key={i}
              className={
                line.startsWith('+') ? 'text-emerald-700 bg-emerald-50' :
                line.startsWith('-') ? 'text-red-700 bg-red-50' :
                line.startsWith('@@') ? 'text-blue-600 bg-blue-50' :
                'text-gray-600'
              }
            >
              {line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

/* ── Branches Tab ────────────────────────────────────── */

function BranchesTab() {
  const git = useGit();
  const [newBranch, setNewBranch] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    git.fetchBranches();
  }, [git.fetchBranches]);

  const handleCreate = useCallback(async () => {
    if (!newBranch.trim()) return;
    setCreating(true);
    try {
      await git.createBranch(newBranch.trim());
      setNewBranch('');
    } finally {
      setCreating(false);
    }
  }, [newBranch, git.createBranch]);

  return (
    <div className="p-3 space-y-3">
      {/* Create branch */}
      <div className="flex items-center gap-2">
        <input
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="New branch name..."
          className="flex-1 text-xs font-mono bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-[var(--color-node-agent)]"
        />
        <button
          onClick={handleCreate}
          disabled={!newBranch.trim() || creating}
          className="px-2 py-1 text-xs font-medium bg-[var(--color-node-agent)] text-white rounded hover:opacity-90 disabled:opacity-40"
        >
          Create
        </button>
      </div>

      {/* Branch list */}
      <div className="space-y-0.5">
        {git.branches.map((b) => (
          <div
            key={b.name}
            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50 ${
              b.current ? 'bg-blue-50' : ''
            }`}
            onClick={() => !b.current && git.switchBranch(b.name)}
          >
            {b.current ? (
              <svg className="w-3 h-3 text-[var(--color-node-agent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <div className="w-3 h-3" />
            )}
            <span className={`text-xs font-mono ${b.current ? 'text-[var(--color-node-agent)] font-semibold' : 'text-gray-700'}`}>
              {b.name}
            </span>
            {b.tracking && (
              <span className="text-[10px] text-gray-400">→ {b.tracking}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────── */

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
