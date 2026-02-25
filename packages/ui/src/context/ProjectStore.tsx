import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type { FlowDefinition } from '@forgeflow/types';
import { api } from '../lib/api-client';
import type { ProjectSummary, SkillSummary, SkillState } from '../lib/api-client';

export type { ProjectSummary, SkillSummary };

// Re-export SkillState for consumers that imported it from here
export type { SkillState } from '../lib/api-client';

interface ProjectStoreValue {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;

  skills: SkillSummary[];
  skillsLoading: boolean;
  skillData: Record<string, SkillState>;

  flows: Record<string, FlowDefinition>;

  createProject: (name: string, description: string) => Promise<string>;
  deleteProject: (id: string) => Promise<void>;
  getFlowById: (id: string) => FlowDefinition | null;
  updateFlow: (id: string, flow: FlowDefinition) => void;
  saveFlow: (id: string, flow: FlowDefinition) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  loadSkills: (projectId: string) => Promise<void>;
  loadSkill: (projectId: string, skillName: string) => Promise<SkillState | null>;
  saveSkill: (projectId: string, skillName: string, files: Array<{ path: string; content: string }>) => Promise<void>;
  createSkill: (projectId: string, name: string) => Promise<void>;
  deleteSkill: (projectId: string, name: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
}

const ProjectStoreContext = createContext<ProjectStoreValue | null>(null);

export function ProjectStoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [flows, setFlows] = useState<Record<string, FlowDefinition>>({});
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillData, setSkillData] = useState<Record<string, SkillState>>({});
  const [loading, setLoading] = useState(true);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch projects on mount
  const refreshProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.projects.list();
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Load a specific project's flow
  const loadProject = useCallback(async (id: string) => {
    try {
      const project = await api.projects.get(id);
      if (project?.flow) {
        setFlows((prev) => ({ ...prev, [id]: project.flow! }));
      }
    } catch (err) {
      console.error('Failed to load project:', err);
    }
  }, []);

  // Load skills for a project
  const loadSkills = useCallback(async (projectId: string) => {
    try {
      setSkillsLoading(true);
      const list = await api.skills.list(projectId);
      setSkills(list);
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  // Load a specific skill's file data
  const loadSkill = useCallback(async (projectId: string, skillName: string): Promise<SkillState | null> => {
    try {
      const data = await api.skills.get(projectId, skillName);
      setSkillData((prev) => ({
        ...prev,
        [skillName]: data,
      }));
      return data;
    } catch (err) {
      console.error('Failed to load skill:', err);
      return null;
    }
  }, []);

  const createProject = useCallback(async (name: string, description: string) => {
    const meta = await api.projects.create(name, description);
    // Refresh list to pick up the new project
    await refreshProjects();
    return meta.id;
  }, [refreshProjects]);

  const deleteProject = useCallback(async (id: string) => {
    await api.projects.delete(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setFlows((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const getFlowById = useCallback(
    (id: string): FlowDefinition | null => flows[id] ?? null,
    [flows],
  );

  // Update flow in local state only (for immediate UI responsiveness)
  const updateFlow = useCallback((id: string, flow: FlowDefinition) => {
    setFlows((prev) => ({ ...prev, [id]: flow }));
  }, []);

  // Save flow to server
  const saveFlow = useCallback(async (id: string, flow: FlowDefinition) => {
    try {
      await api.projects.saveFlow(id, flow);
    } catch (err) {
      console.error('Failed to save flow:', err);
    }
  }, []);

  // Save skill files
  const saveSkill = useCallback(async (projectId: string, skillName: string, files: Array<{ path: string; content: string }>) => {
    try {
      await api.skills.save(projectId, skillName, files);
    } catch (err) {
      console.error('Failed to save skill:', err);
    }
  }, []);

  // Create a new skill
  const createSkill = useCallback(async (projectId: string, name: string) => {
    await api.skills.create(projectId, name);
    await loadSkills(projectId);
  }, [loadSkills]);

  // Delete a skill
  const deleteSkill = useCallback(async (projectId: string, name: string) => {
    await api.skills.delete(projectId, name);
    setSkills((prev) => prev.filter((s) => s.name !== name));
    setSkillData((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const value = useMemo<ProjectStoreValue>(
    () => ({
      projects,
      loading,
      error,
      skills,
      skillsLoading,
      skillData,
      flows,
      createProject,
      deleteProject,
      getFlowById,
      updateFlow,
      saveFlow,
      loadProject,
      loadSkills,
      loadSkill,
      saveSkill,
      createSkill,
      deleteSkill,
      refreshProjects,
    }),
    [projects, loading, error, skills, skillsLoading, skillData, flows, createProject, deleteProject, getFlowById, updateFlow, saveFlow, loadProject, loadSkills, loadSkill, saveSkill, createSkill, deleteSkill, refreshProjects],
  );

  return (
    <ProjectStoreContext.Provider value={value}>
      {children}
    </ProjectStoreContext.Provider>
  );
}

export function useProjectStore(): ProjectStoreValue {
  const ctx = useContext(ProjectStoreContext);
  if (!ctx) throw new Error('useProjectStore must be used within ProjectStoreProvider');
  return ctx;
}
