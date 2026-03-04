import { useState, useCallback, useEffect } from 'react';
import type { GitHubRepo } from '@forgeflow/types';
import { useGit } from '../../context/GitContext';

interface GitHubConnectDialogProps {
  projectId: string;
  onClose: () => void;
}

export function GitHubConnectDialog({ projectId, onClose }: GitHubConnectDialogProps) {
  const git = useGit();
  const [view, setView] = useState<'connect' | 'connected' | 'create' | 'link'>('connect');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoDesc, setNewRepoDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentRemote, setCurrentRemote] = useState<string | null>(null);

  // Determine initial view based on connection status
  useEffect(() => {
    if (git.githubConnection?.connected) {
      setView('connected');
      git.getRemote().then(setCurrentRemote);
    } else {
      setView('connect');
    }
  }, [git.githubConnection?.connected]);

  // Poll for OAuth callback completion
  useEffect(() => {
    if (view !== 'connect') return;

    const interval = setInterval(async () => {
      await git.refreshGitHub();
    }, 2000);

    return () => clearInterval(interval);
  }, [view, git.refreshGitHub]);

  // Auto-switch view when connection changes
  useEffect(() => {
    if (git.githubConnection?.connected && view === 'connect') {
      setView('connected');
    }
  }, [git.githubConnection?.connected, view]);

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const r = await git.listRepos();
      setRepos(r);
    } finally {
      setLoadingRepos(false);
    }
  }, [git.listRepos]);

  const handleCreateRepo = useCallback(async () => {
    if (!newRepoName.trim()) return;
    setCreating(true);
    try {
      const repo = await git.createRepo(newRepoName.trim(), newRepoDesc, isPrivate);
      await git.linkRepo(repo.cloneUrl);
      setSuccess(`Created and linked ${repo.fullName}`);
      setCurrentRemote(repo.htmlUrl);
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      // Error handled by context
    } finally {
      setCreating(false);
    }
  }, [newRepoName, newRepoDesc, isPrivate, git, onClose]);

  const handleLinkRepo = useCallback(async (repo: GitHubRepo) => {
    setLinking(true);
    try {
      await git.linkRepo(repo.cloneUrl);
      setSuccess(`Linked to ${repo.fullName}`);
      setCurrentRemote(repo.htmlUrl);
      setTimeout(() => onClose(), 2000);
    } finally {
      setLinking(false);
    }
  }, [git, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-[420px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            <span className="text-sm font-semibold">GitHub</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Success banner */}
        {success && (
          <div className="shrink-0 px-4 py-2 bg-emerald-50 text-emerald-700 text-xs flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M5 13l4 4L19 7" />
            </svg>
            {success}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Not connected */}
          {view === 'connect' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <p className="text-sm text-gray-600 text-center">
                Connect your GitHub account to push and pull your flows.
              </p>
              <button
                onClick={() => git.connectGitHub()}
                className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 flex items-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Connect to GitHub
              </button>
              <p className="text-[10px] text-gray-400 text-center">
                A browser window will open for authorization.
                <br />
                This dialog will update automatically once connected.
              </p>
            </div>
          )}

          {/* Connected — main menu */}
          {view === 'connected' && (
            <div className="space-y-4">
              {/* User info */}
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                {git.githubConnection?.avatarUrl && (
                  <img
                    src={git.githubConnection.avatarUrl}
                    className="w-8 h-8 rounded-full"
                    alt=""
                  />
                )}
                <div>
                  <div className="text-sm font-medium">{git.githubConnection?.username}</div>
                  <div className="text-[10px] text-gray-400">Connected to GitHub</div>
                </div>
              </div>

              {/* Current remote */}
              {currentRemote && (
                <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2 font-mono break-all">
                  Remote: {currentRemote}
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                <button
                  onClick={() => setView('create')}
                  className="w-full px-3 py-2 text-xs font-medium text-left bg-white border border-gray-200 rounded hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 4v16m8-8H4" />
                  </svg>
                  Create New Repository
                </button>
                <button
                  onClick={() => { setView('link'); loadRepos(); }}
                  className="w-full px-3 py-2 text-xs font-medium text-left bg-white border border-gray-200 rounded hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                    <path d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
                  </svg>
                  Link Existing Repository
                </button>
              </div>

              {/* Disconnect */}
              <button
                onClick={async () => {
                  await git.disconnectGitHub();
                  setView('connect');
                }}
                className="text-[10px] text-gray-400 hover:text-red-500"
              >
                Disconnect
              </button>
            </div>
          )}

          {/* Create new repo */}
          {view === 'create' && (
            <div className="space-y-3">
              <button
                onClick={() => setView('connected')}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Repository Name</label>
                <input
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  placeholder={projectId}
                  className="w-full text-xs font-mono border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-[var(--color-node-agent)]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Description</label>
                <input
                  value={newRepoDesc}
                  onChange={(e) => setNewRepoDesc(e.target.value)}
                  placeholder="A ForgeFlow project"
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-[var(--color-node-agent)]"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="rounded"
                />
                Private repository
              </label>

              <button
                onClick={handleCreateRepo}
                disabled={!newRepoName.trim() || creating}
                className="w-full px-3 py-2 text-xs font-medium bg-[var(--color-node-agent)] text-white rounded hover:opacity-90 disabled:opacity-40"
              >
                {creating ? 'Creating...' : 'Create & Link Repository'}
              </button>
            </div>
          )}

          {/* Link existing repo */}
          {view === 'link' && (
            <div className="space-y-3">
              <button
                onClick={() => setView('connected')}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              {loadingRepos ? (
                <div className="text-xs text-gray-400 py-4 text-center">Loading repositories...</div>
              ) : repos.length === 0 ? (
                <div className="text-xs text-gray-400 py-4 text-center">No repositories found</div>
              ) : (
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {repos.map((repo) => (
                    <button
                      key={repo.fullName}
                      onClick={() => handleLinkRepo(repo)}
                      disabled={linking}
                      className="w-full px-3 py-2 text-left bg-white border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      <div className="text-xs font-medium text-gray-800">{repo.fullName}</div>
                      <div className="text-[10px] text-gray-400 flex items-center gap-1">
                        {repo.private && <span className="text-amber-500">private</span>}
                        <span className="truncate">{repo.htmlUrl}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
