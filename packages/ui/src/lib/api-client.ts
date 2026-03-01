import type { FlowDefinition, ValidationResult } from '@forgeflow/types';

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
  },

  runs: {
    start: (projectId: string, runner: 'mock' | 'local' | 'docker' = 'mock') =>
      post<{ runId: string }>(`/projects/${projectId}/run`, { runner }),

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
  },
};
