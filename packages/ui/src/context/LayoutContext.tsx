import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DockviewApi } from 'dockview-react';
import type { ValidationResult } from '@forgeflow/types';
import type { CompilePreviewResult } from '../lib/api-client';

/* ── Tab types ────────────────────────────────────────────── */

export interface EditorTab {
  id: string;
  type: 'agent' | 'skill' | 'reference' | 'artifact' | 'validation' | 'compile' | 'run' | 'output' | 'run-history';
  label: string;
  nodeId?: string;
  skillName?: string;
  refPath?: string;
  artifactName?: string;
  validationResult?: ValidationResult;
  compileResult?: CompilePreviewResult;
  runId?: string;
  outputFileName?: string;
  projectId?: string;
}

/* ── Component map ────────────────────────────────────────── */

const COMPONENT_MAP: Record<EditorTab['type'], string> = {
  agent: 'agent-editor',
  skill: 'skill-editor',
  artifact: 'artifact-editor',
  reference: 'reference-viewer',
  validation: 'validation-panel',
  compile: 'compile-panel',
  run: 'run-panel',
  output: 'output-viewer',
  'run-history': 'run-history-panel',
};

export type WorkspaceSelection =
  | { type: 'agent'; nodeId: string }
  | { type: 'skill'; skillName: string }
  | { type: 'reference'; refPath: string }
  | { type: 'artifact'; artifactName: string }
  | null;

/* ── Context value ────────────────────────────────────────── */

interface LayoutContextValue {
  /** Store the dockview API ref when it's ready */
  setApi: (api: DockviewApi) => void;
  /** Get the current dockview API (may be null before onReady) */
  api: DockviewApi | null;

  /** Open a tab (or focus existing) */
  openTab: (tab: EditorTab) => void;
  /** Close a tab by its panel ID */
  closeTab: (tabId: string) => void;
  /** Update a tab's title */
  updateTabLabel: (tabId: string, label: string) => void;

  /** Convenience: open an agent tab */
  selectAgent: (nodeId: string, label?: string) => void;
  /** Convenience: open a skill tab */
  selectSkill: (skillName: string) => void;
  /** Convenience: open a reference tab */
  selectReference: (refPath: string, label?: string) => void;
  /** Convenience: open an artifact tab */
  selectArtifact: (artifactName: string) => void;
  /** Convenience: open a run output file tab */
  selectOutput: (runId: string, fileName: string) => void;
  /** Convenience: open run history tab */
  selectRunHistory: (projectId: string) => void;

  /** Current active panel's selection info */
  selection: WorkspaceSelection;
  /** The active tab ID (panel id from dockview) */
  activeTabId: string | null;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

/* ── Provider ─────────────────────────────────────────────── */

export function LayoutProvider({ children }: { children: ReactNode }) {
  const apiRef = useRef<DockviewApi | null>(null);
  const [selection, setSelection] = useState<WorkspaceSelection>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const setApi = useCallback((api: DockviewApi) => {
    apiRef.current = api;

    // Listen for active panel changes to derive selection
    api.onDidActivePanelChange((e) => {
      if (!e) {
        setSelection(null);
        setActiveTabId(null);
        return;
      }
      const params = e.params as EditorTab | undefined;
      if (!params) {
        setSelection(null);
        setActiveTabId(e.id);
        return;
      }
      setActiveTabId(e.id);
      if (params.type === 'agent' && params.nodeId) {
        setSelection({ type: 'agent', nodeId: params.nodeId });
      } else if (params.type === 'skill' && params.skillName) {
        setSelection({ type: 'skill', skillName: params.skillName });
      } else if (params.type === 'reference' && params.refPath) {
        setSelection({ type: 'reference', refPath: params.refPath });
      } else if (params.type === 'artifact' && params.artifactName) {
        setSelection({ type: 'artifact', artifactName: params.artifactName });
      } else {
        setSelection(null);
      }
    });
  }, []);

  const openTab = useCallback((tab: EditorTab) => {
    const api = apiRef.current;
    if (!api) return;

    // Check if panel already exists — update params and focus it
    const existing = api.getPanel(tab.id);
    if (existing) {
      existing.api.updateParameters(tab);
      existing.api.setTitle(tab.label);
      existing.api.setActive();
      return;
    }

    const component = COMPONENT_MAP[tab.type] ?? 'reference-viewer';

    api.addPanel({
      id: tab.id,
      component,
      title: tab.label,
      params: tab,
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    const api = apiRef.current;
    if (!api) return;
    const panel = api.getPanel(tabId);
    if (panel) {
      api.removePanel(panel);
    }
  }, []);

  const updateTabLabel = useCallback((tabId: string, label: string) => {
    const api = apiRef.current;
    if (!api) return;
    const panel = api.getPanel(tabId);
    if (panel) {
      panel.api.updateParameters({ label } as Partial<EditorTab>);
      panel.api.setTitle(label);
    }
  }, []);

  const selectAgent = useCallback((nodeId: string, label?: string) => {
    openTab({ id: nodeId, type: 'agent', label: label ?? nodeId, nodeId });
  }, [openTab]);

  const selectSkill = useCallback((skillName: string) => {
    openTab({ id: `skill:${skillName}`, type: 'skill', label: skillName, skillName });
  }, [openTab]);

  const selectReference = useCallback((refPath: string, label?: string) => {
    const displayLabel = label ?? refPath.split('/').pop() ?? refPath;
    openTab({ id: `ref:${refPath}`, type: 'reference', label: displayLabel, refPath });
  }, [openTab]);

  const selectArtifact = useCallback((artifactName: string) => {
    openTab({ id: `artifact:${artifactName}`, type: 'artifact', label: artifactName, artifactName });
  }, [openTab]);

  const selectOutput = useCallback((runId: string, fileName: string) => {
    openTab({ id: `output:${runId}:${fileName}`, type: 'output', label: fileName, runId, outputFileName: fileName });
  }, [openTab]);

  const selectRunHistory = useCallback((projectId: string) => {
    openTab({ id: 'run-history', type: 'run-history', label: 'Run History', projectId });
  }, [openTab]);

  const value = useMemo<LayoutContextValue>(
    () => ({
      setApi,
      api: apiRef.current,
      openTab,
      closeTab,
      updateTabLabel,
      selectAgent,
      selectSkill,
      selectReference,
      selectArtifact,
      selectOutput,
      selectRunHistory,
      selection,
      activeTabId,
    }),
    [setApi, openTab, closeTab, updateTabLabel, selectAgent, selectSkill, selectReference, selectArtifact, selectOutput, selectRunHistory, selection, activeTabId],
  );

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
