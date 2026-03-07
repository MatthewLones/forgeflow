import {
  createContext, useContext, useState, useCallback,
  useEffect, type ReactNode,
} from 'react';
import type {
  GitStatus, GitCommit, GitBranch, GitDiffEntry,
  GitHubConnection, GitHubRepo,
} from '@forgeflow/types';
import { api } from '../lib/api-client';

/* ── Context shape ────────────────────────────────────── */

interface GitContextValue {
  // State
  status: GitStatus | null;
  commits: GitCommit[];
  branches: GitBranch[];
  githubConnection: GitHubConnection | null;
  loading: boolean;
  error: string | null;

  // Actions
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  stageAll: () => Promise<void>;
  stageFiles: (paths: string[]) => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<string>;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  resetToCommit: (hash: string) => Promise<void>;
  fetchLog: () => Promise<void>;
  fetchDiff: (hash?: string) => Promise<GitDiffEntry[]>;
  fetchBranches: () => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  switchBranch: (name: string) => Promise<void>;
  setRemote: (url: string) => Promise<void>;
  getRemote: () => Promise<string | null>;

  // GitHub
  refreshGitHub: () => Promise<void>;
  connectGitHub: () => Promise<void>;
  disconnectGitHub: () => Promise<void>;
  listRepos: () => Promise<GitHubRepo[]>;
  createRepo: (name: string, description: string, isPrivate: boolean) => Promise<GitHubRepo>;
  linkRepo: (repoUrl: string) => Promise<void>;
}

const GitContext = createContext<GitContextValue | null>(null);

export function useGit(): GitContextValue {
  const ctx = useContext(GitContext);
  if (!ctx) throw new Error('useGit must be used within <GitProvider>');
  return ctx;
}

/* ── Provider ─────────────────────────────────────────── */

interface GitProviderProps {
  projectId: string;
  children: ReactNode;
  onFlowChanged?: () => void;
}

export function GitProvider({ projectId, children, onFlowChanged }: GitProviderProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [githubConnection, setGithubConnection] = useState<GitHubConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // ── Refresh status ──
  const refresh = useCallback(async () => {
    try {
      clearError();
      const s = await api.git.status(projectId);
      setStatus(s);
    } catch (err: any) {
      setError(err.message || 'Failed to get git status');
    }
  }, [projectId, clearError]);

  // ── Init ──
  const init = useCallback(async () => {
    setLoading(true);
    try {
      clearError();
      await api.git.init(projectId);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to initialize git');
    } finally {
      setLoading(false);
    }
  }, [projectId, refresh, clearError]);

  // ── Stage all ──
  const stageAll = useCallback(async () => {
    try {
      clearError();
      await api.git.stageAll(projectId);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to stage files');
    }
  }, [projectId, refresh, clearError]);

  // ── Stage specific files ──
  const stageFiles = useCallback(async (paths: string[]) => {
    try {
      clearError();
      await api.git.stageFiles(projectId, paths);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to stage files');
    }
  }, [projectId, refresh, clearError]);

  // ── Unstage files ──
  const unstageFiles = useCallback(async (paths: string[]) => {
    try {
      clearError();
      await api.git.unstageFiles(projectId, paths);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to unstage files');
    }
  }, [projectId, refresh, clearError]);

  // ── Commit ──
  const commit = useCallback(async (message: string): Promise<string> => {
    setLoading(true);
    try {
      clearError();
      const { hash } = await api.git.commit(projectId, message);
      await refresh();
      await fetchLog();
      return hash;
    } catch (err: any) {
      setError(err.message || 'Failed to commit');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [projectId, refresh, clearError]);

  // ── Push ──
  const push = useCallback(async () => {
    setLoading(true);
    try {
      clearError();
      await api.git.push(projectId);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to push');
    } finally {
      setLoading(false);
    }
  }, [projectId, refresh, clearError]);

  // ── Pull ──
  const pull = useCallback(async () => {
    setLoading(true);
    try {
      clearError();
      await api.git.pull(projectId);
      await refresh();
      onFlowChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to pull');
    } finally {
      setLoading(false);
    }
  }, [projectId, refresh, clearError, onFlowChanged]);

  // ── Reset ──
  const resetToCommit = useCallback(async (hash: string) => {
    setLoading(true);
    try {
      clearError();
      await api.git.reset(projectId, hash);
      await refresh();
      await fetchLog();
      onFlowChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to reset');
    } finally {
      setLoading(false);
    }
  }, [projectId, refresh, clearError, onFlowChanged]);

  // ── Log ──
  const fetchLog = useCallback(async () => {
    try {
      const log = await api.git.log(projectId);
      setCommits(log);
    } catch (err: any) {
      // Not critical — status tab still works
      console.error('[GitContext] Failed to fetch log:', err.message);
    }
  }, [projectId]);

  // ── Diff ──
  const fetchDiff = useCallback(async (hash?: string): Promise<GitDiffEntry[]> => {
    try {
      return await api.git.diff(projectId, hash);
    } catch {
      return [];
    }
  }, [projectId]);

  // ── Branches ──
  const fetchBranches = useCallback(async () => {
    try {
      const b = await api.git.branches(projectId);
      setBranches(b);
    } catch (err: any) {
      console.error('[GitContext] Failed to fetch branches:', err.message);
    }
  }, [projectId]);

  const createBranch = useCallback(async (name: string) => {
    setLoading(true);
    try {
      clearError();
      await api.git.createBranch(projectId, name);
      await refresh();
      await fetchBranches();
    } catch (err: any) {
      setError(err.message || 'Failed to create branch');
    } finally {
      setLoading(false);
    }
  }, [projectId, refresh, fetchBranches, clearError]);

  const switchBranch = useCallback(async (name: string) => {
    setLoading(true);
    try {
      clearError();
      await api.git.switchBranch(projectId, name);
      await refresh();
      await fetchBranches();
      onFlowChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to switch branch');
    } finally {
      setLoading(false);
    }
  }, [projectId, refresh, fetchBranches, clearError, onFlowChanged]);

  // ── Remote ──
  const setRemote = useCallback(async (url: string) => {
    try {
      clearError();
      await api.git.setRemote(projectId, url);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to set remote');
    }
  }, [projectId, refresh, clearError]);

  const getRemote = useCallback(async (): Promise<string | null> => {
    try {
      const { url } = await api.git.getRemote(projectId);
      return url;
    } catch {
      return null;
    }
  }, [projectId]);

  // ── GitHub ──
  const refreshGitHub = useCallback(async () => {
    try {
      const conn = await api.github.status();
      setGithubConnection(conn);
    } catch {
      setGithubConnection({ connected: false });
    }
  }, []);

  const connectGitHub = useCallback(async () => {
    try {
      const { url } = await api.github.getAuthUrl();
      window.open(url, '_blank', 'width=600,height=700');
    } catch (err: any) {
      setError(err.message || 'Failed to start GitHub auth');
    }
  }, []);

  const disconnectGitHub = useCallback(async () => {
    try {
      await api.github.disconnect();
      setGithubConnection({ connected: false });
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect');
    }
  }, []);

  const listRepos = useCallback(async (): Promise<GitHubRepo[]> => {
    try {
      return await api.github.repos();
    } catch {
      return [];
    }
  }, []);

  const createRepo = useCallback(async (
    name: string, description: string, isPrivate: boolean,
  ): Promise<GitHubRepo> => {
    const repo = await api.github.createRepo(name, description, isPrivate);
    return repo;
  }, []);

  const linkRepo = useCallback(async (repoUrl: string) => {
    try {
      clearError();
      await api.github.linkRepo(projectId, repoUrl);
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to link repo');
    }
  }, [projectId, refresh, clearError]);

  // ── Initial load ──
  useEffect(() => {
    refresh();
    refreshGitHub();
  }, [refresh, refreshGitHub]);

  const value: GitContextValue = {
    status, commits, branches, githubConnection, loading, error,
    refresh, init, stageAll, stageFiles, unstageFiles,
    commit, push, pull, resetToCommit,
    fetchLog, fetchDiff, fetchBranches,
    createBranch, switchBranch,
    setRemote, getRemote,
    refreshGitHub, connectGitHub, disconnectGitHub,
    listRepos, createRepo, linkRepo,
  };

  return (
    <GitContext.Provider value={value}>
      {children}
    </GitContext.Provider>
  );
}
