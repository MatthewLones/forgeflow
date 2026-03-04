import type {
  FlowDefinition, ValidationResult,
  GitStatus, GitCommit, GitBranch, GitDiffEntry,
  GitHubConnection, GitHubRepo,
} from '@forgeflow/types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

// --- Types matching server responses ---

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  updatedAt: string;
}

export interface ProjectSummary extends ProjectMeta {
  nodeCount: number;
  skillCount: number;
  hasCheckpoints: boolean;
}

export interface SkillSummary {
  name: string;
  description: string;
  referenceCount: number;
  subSkills: string[];
}

export interface ChatMeta {
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalCostUsd: number;
}

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillState {
  skillName: string;
  files: SkillFile[];
}

export type ReferenceFileType = 'folder' | 'pdf' | 'md' | 'json' | 'txt' | 'image' | 'other';

export interface ReferenceEntry {
  name: string;
  type: ReferenceFileType;
  path: string;
  size?: number;
  modifiedAt?: string;
  children?: ReferenceEntry[];
}

export interface CompilePhase {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  ir?: unknown;
  prompt: string;
  childPrompts: Record<string, { ir?: unknown; markdown: string }>;
}

export interface CompilePreviewResult {
  valid: boolean;
  errors?: Array<{ message: string }>;
  phases: CompilePhase[];
}

// --- Fetch helpers ---

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  }
}

async function postFormData<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function getRaw(path: string): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText);
  }
  return res;
}

// --- API client ---

export const api = {
  health: () => get<{ status: string; version: string }>('/health'),

  projects: {
    list: () => get<ProjectSummary[]>('/projects'),

    get: (id: string) =>
      get<{ meta: ProjectMeta; flow: FlowDefinition | null }>(`/projects/${id}`),

    create: (name: string, description: string) =>
      post<ProjectMeta>('/projects', { name, description }),

    update: (id: string, updates: Partial<ProjectMeta>) =>
      put<ProjectMeta>(`/projects/${id}`, updates),

    delete: (id: string) => del(`/projects/${id}`),

    saveFlow: (id: string, flow: FlowDefinition) =>
      put<{ ok: boolean }>(`/projects/${id}/flow`, flow),

    getFlow: (id: string) => get<FlowDefinition>(`/projects/${id}/flow`),

    /** Download a .forge bundle as a Blob and trigger browser download */
    exportBundle: async (id: string, fileName?: string) => {
      const res = await fetch(`${API_BASE}/projects/${id}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName ?? `${id}.forge`;
      // Extract filename from Content-Disposition if available
      const cd = res.headers.get('Content-Disposition');
      if (cd) {
        const match = cd.match(/filename="?([^"]+)"?/);
        if (match) a.download = match[1];
      }
      a.click();
      URL.revokeObjectURL(url);
    },

    /** Import a .forge bundle file */
    importBundle: async (file: File): Promise<ProjectMeta> => {
      const formData = new FormData();
      formData.append('file', file);
      return postFormData<ProjectMeta>('/projects/import', formData);
    },
  },

  skills: {
    list: (projectId: string) =>
      get<SkillSummary[]>(`/projects/${projectId}/skills`),

    get: (projectId: string, name: string) =>
      get<SkillState>(`/projects/${projectId}/skills/${name}`),

    save: (projectId: string, name: string, files: SkillFile[]) =>
      put<{ ok: boolean }>(`/projects/${projectId}/skills/${name}`, { files }),

    create: (projectId: string, name: string) =>
      post<{ ok: boolean; name: string }>(`/projects/${projectId}/skills`, { name }),

    delete: (projectId: string, name: string) =>
      del(`/projects/${projectId}/skills/${name}`),

    rename: (projectId: string, oldName: string, newName: string) =>
      patch<{ ok: boolean; name: string }>(`/projects/${projectId}/skills/${oldName}`, { newName }),
  },

  references: {
    list: (projectId: string) =>
      get<ReferenceEntry[]>(`/projects/${projectId}/references`),

    upload: (projectId: string, files: File[], targetFolder?: string) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }
      if (targetFolder) {
        formData.append('targetFolder', targetFolder);
      }
      return postFormData<ReferenceEntry[]>(
        `/projects/${projectId}/references/upload`,
        formData,
      );
    },

    getFileUrl: (projectId: string, refPath: string) =>
      `${API_BASE}/projects/${projectId}/references/file/${refPath.split('/').map(encodeURIComponent).join('/')}`,

    getTextContent: async (projectId: string, refPath: string): Promise<string> => {
      const encodedPath = refPath.split('/').map(encodeURIComponent).join('/');
      const res = await getRaw(`/projects/${projectId}/references/file/${encodedPath}`);
      return res.text();
    },

    delete: (projectId: string, refPath: string) =>
      del(`/projects/${projectId}/references/file/${refPath.split('/').map(encodeURIComponent).join('/')}`),

    createFolder: (projectId: string, path: string) =>
      post<{ ok: boolean }>(`/projects/${projectId}/references/folder`, { path }),

    rename: (projectId: string, oldPath: string, newPath: string) =>
      put<{ ok: boolean }>(`/projects/${projectId}/references/rename`, { oldPath, newPath }),
  },

  flows: {
    validate: (flow: FlowDefinition) =>
      post<ValidationResult>('/validate', flow),

    compilePreview: (flow: FlowDefinition) =>
      post<CompilePreviewResult>('/compile/preview', flow),

    requiredInputs: (projectId: string) =>
      get<{
        requiredInputs: Array<{
          name: string;
          schema: {
            name: string;
            format: string;
            description: string;
            fields?: Array<{
              key: string;
              type: string;
              description: string;
              required?: boolean;
            }>;
          } | null;
        }>;
      }>(`/projects/${projectId}/required-inputs`),
  },

  runs: {
    start: (projectId: string, runner: 'mock' | 'local' | 'docker' = 'mock', files?: File[], model?: string) => {
      const formData = new FormData();
      formData.append('runner', runner);
      if (model) formData.append('model', model);
      if (files) {
        for (const file of files) {
          formData.append('files', file, file.name);
        }
      }
      return postFormData<{ runId: string }>(`/projects/${projectId}/run`, formData);
    },

    stop: (runId: string) =>
      post<{ ok: boolean }>(`/runs/${runId}/stop`),

    getState: (runId: string) =>
      get<import('@forgeflow/types').RunState>(`/runs/${runId}`),

    answerInterrupt: (runId: string, answer: import('@forgeflow/types').InterruptAnswer) =>
      post<{ ok: boolean }>(`/runs/${runId}/interrupt-answer`, answer),

    resume: (
      runId: string,
      projectId: string,
      fileName: string,
      content: string, // base64
      runner: 'mock' | 'local' | 'docker' = 'mock',
    ) =>
      post<{ runId: string }>(`/runs/${runId}/resume`, {
        projectId,
        fileName,
        content,
        runner,
      }),

    /** Connect to SSE progress stream. Returns EventSource. */
    streamProgress: (runId: string): EventSource => {
      return new EventSource(`${API_BASE}/runs/${runId}/progress`);
    },

    /** List runs for a project */
    listByProject: (projectId: string) =>
      get<import('@forgeflow/types').RunState[]>(`/projects/${projectId}/runs`),

    /** List output artifacts for a run */
    listOutputs: (runId: string) =>
      get<Array<{ name: string; size: number }>>(`/runs/${runId}/outputs`),

    /** Get URL for an output file (for download links) */
    getOutputFileUrl: (runId: string, fileName: string) =>
      `${API_BASE}/runs/${runId}/outputs/${encodeURIComponent(fileName)}`,

    /** Fetch output file as text */
    getOutputText: async (runId: string, fileName: string): Promise<string> => {
      const res = await getRaw(`/runs/${runId}/outputs/${encodeURIComponent(fileName)}`);
      return res.text();
    },

    /** Get computed post-run summary */
    getSummary: (runId: string) =>
      get<{
        runId: string;
        status: string;
        duration: { startedAt: string; completedAt: string };
        cost: { turns: number; usd: number };
        phases: Array<{
          nodeId: string;
          nodeName: string;
          cost: number;
          outputFiles: string[];
          missingOutputs: string[];
          toolCallCount: number;
          textBlockCount: number;
        }>;
        artifacts: Array<{ name: string; size: number; producedBy: string }>;
        errors: string[];
        interrupts: Array<{ id: string; type: string; nodeId: string; escalated: boolean }>;
      }>(`/runs/${runId}/summary`),

    /** List workspace files for a run organized by phase */
    getWorkspaceTree: (runId: string) =>
      get<{
        phases: Array<{
          phaseId: string;
          files: Array<{ path: string; size: number }>;
        }>;
      }>(`/runs/${runId}/workspace`),

    /** Fetch a specific workspace file as text */
    getWorkspaceFileText: async (runId: string, phaseId: string, filePath: string): Promise<string> => {
      const res = await getRaw(`/runs/${runId}/workspace/${encodeURIComponent(phaseId)}/${filePath}`);
      return res.text();
    },

    /** Get URL for a workspace file */
    getWorkspaceFileUrl: (runId: string, phaseId: string, filePath: string) =>
      `${API_BASE}/runs/${runId}/workspace/${encodeURIComponent(phaseId)}/${filePath}`,
  },

  copilot: {
    /** Send a message to the copilot. Returns sessionId. */
    sendMessage: (projectId: string, message: string, options?: { maxTurns?: number; maxBudgetUsd?: number; model?: string }) =>
      post<{ sessionId: string; eventCount: number }>(`/copilot/${projectId}/message`, { message, ...options }),

    /** SSE stream of copilot events with replay */
    streamProgress: (sessionId: string): EventSource =>
      new EventSource(`${API_BASE}/copilot/${sessionId}/progress`),

    /** Answer a pending ask_user question */
    answerQuestion: (sessionId: string, questionId: string, answer: string) =>
      post<{ ok: boolean }>(`/copilot/${sessionId}/answer-question`, { questionId, answer }),

    /** Stop the current query */
    stop: (sessionId: string) =>
      post<{ ok: boolean }>(`/copilot/${sessionId}/stop`),

    /** Reset the session (clear history) */
    reset: (sessionId: string) =>
      post<{ ok: boolean }>(`/copilot/${sessionId}/reset`),

    /** Check if there's an active copilot session for this project */
    getActiveSession: (projectId: string) =>
      get<{ active: boolean; sessionId?: string; activeQuery?: boolean; hasPendingQuestion?: boolean; eventCount?: number }>(`/copilot/${projectId}/active-session`),

    /** Load past copilot events from disk */
    loadHistory: (projectId: string) =>
      get<{ events: import('@forgeflow/types').ProgressEvent[] }>(`/copilot/${projectId}/history`),

    /** List all chats for a project */
    listChats: (projectId: string) =>
      get<{ chats: ChatMeta[]; activeChatId: string | null }>(`/copilot/${projectId}/chats`),

    /** Load events for a specific chat */
    loadChatHistory: (projectId: string, chatId: string) =>
      get<{ events: import('@forgeflow/types').ProgressEvent[] }>(`/copilot/${projectId}/chats/${chatId}`),

    /** Archive current chat and start a new one */
    newChat: (projectId: string) =>
      post<ChatMeta>(`/copilot/${projectId}/chats/new`),

    /** Switch to a different chat */
    switchChat: (projectId: string, chatId: string) =>
      post<ChatMeta>(`/copilot/${projectId}/chats/${chatId}/switch`),

    /** Delete a chat */
    deleteChat: (projectId: string, chatId: string) =>
      del(`/copilot/${projectId}/chats/${chatId}`),
  },

  git: {
    status: (projectId: string) =>
      get<GitStatus>(`/projects/${projectId}/git/status`),

    init: (projectId: string) =>
      post<{ success: boolean }>(`/projects/${projectId}/git/init`),

    stageAll: (projectId: string) =>
      post<{ success: boolean }>(`/projects/${projectId}/git/stage`),

    stageFiles: (projectId: string, paths: string[]) =>
      post<{ success: boolean }>(`/projects/${projectId}/git/stage`, { paths }),

    unstageFiles: (projectId: string, paths: string[]) =>
      post<{ success: boolean }>(`/projects/${projectId}/git/unstage`, { paths }),

    commit: (projectId: string, message: string) =>
      post<{ hash: string }>(`/projects/${projectId}/git/commit`, { message }),

    log: (projectId: string, limit?: number) =>
      get<GitCommit[]>(`/projects/${projectId}/git/log${limit ? `?limit=${limit}` : ''}`),

    diff: (projectId: string, hash?: string) =>
      get<GitDiffEntry[]>(`/projects/${projectId}/git/diff${hash ? `?hash=${hash}` : ''}`),

    branches: (projectId: string) =>
      get<GitBranch[]>(`/projects/${projectId}/git/branches`),

    createBranch: (projectId: string, name: string) =>
      post<{ success: boolean }>(`/projects/${projectId}/git/branches`, { name }),

    switchBranch: (projectId: string, name: string) =>
      put<{ success: boolean }>(`/projects/${projectId}/git/branches`, { name }),

    push: (projectId: string) =>
      post<{ success: boolean }>(`/projects/${projectId}/git/push`),

    pull: (projectId: string) =>
      post<{ success: boolean; changes?: number }>(`/projects/${projectId}/git/pull`),

    reset: (projectId: string, hash: string) =>
      post<{ success: boolean }>(`/projects/${projectId}/git/reset`, { hash }),

    setRemote: (projectId: string, url: string) =>
      post<{ success: boolean }>(`/projects/${projectId}/git/remote`, { url }),

    getRemote: (projectId: string) =>
      get<{ url: string | null }>(`/projects/${projectId}/git/remote`),
  },

  github: {
    status: () =>
      get<GitHubConnection>('/github/status'),

    getAuthUrl: () =>
      get<{ url: string }>('/github/auth-url'),

    repos: () =>
      get<GitHubRepo[]>('/github/repos'),

    createRepo: (name: string, description: string, isPrivate: boolean) =>
      post<GitHubRepo>('/github/repos', { name, description, private: isPrivate }),

    linkRepo: (projectId: string, repoUrl: string) =>
      post<{ success: boolean }>('/github/repos/link', { projectId, repoUrl }),

    disconnect: () =>
      post<{ success: boolean }>('/github/disconnect'),
  },
};
