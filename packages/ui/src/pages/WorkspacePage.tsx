import { useState, useCallback, useMemo, useRef, useEffect, Component, type ErrorInfo, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FlowProvider, useFlow } from '../context/FlowContext';
import { DagProvider, useDag } from '../context/DagContext';
import { LayoutProvider, useLayout } from '../context/LayoutContext';
import { RunProvider, useRun } from '../context/RunContext';
import { CopilotProvider } from '../context/CopilotContext';
import { useProjectStore } from '../context/ProjectStore';
import { AgentExplorer } from '../components/workspace/AgentExplorer';
import { WorkspaceToolbar } from '../components/workspace/WorkspaceToolbar';
import { DagMiniView } from '../components/workspace/DagMiniView';
import { EditorLayout } from '../components/workspace/EditorLayout';
import { AISidePanel } from '../components/ai/AISidePanel';
import { SettingsOverlay } from '../components/workspace/SettingsOverlay';
import { ExportDialog } from '../components/workspace/ExportDialog';
import { GitPanel } from '../components/workspace/GitPanel';
import { GitHubConnectDialog } from '../components/workspace/GitHubConnectDialog';
import { GitProvider } from '../context/GitContext';
import { autoLayout } from '../lib/flow-to-reactflow';
import { api } from '../lib/api-client';
import { useSyncFlow, type SaveStatus } from '../hooks/useSyncFlow';
import { useAutoEdges } from '../hooks/useAutoEdges';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { applyRemaps, type ShortcutBinding } from '../lib/keyboard-shortcuts';

/* ── Resize hook ────────────────────────────────────────── */

const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 224;
const DAG_MIN = 64;
const DAG_MAX = 400;
const DAG_DEFAULT = 128;
const AI_PANEL_MIN = 280;
const AI_PANEL_MAX = 600;
const AI_PANEL_DEFAULT = 360;
const GIT_PANEL_MIN = 100;
const GIT_PANEL_MAX = 400;
const GIT_PANEL_DEFAULT = 200;

function useResize(
  axis: 'x' | 'y',
  initial: number,
  min: number,
  max: number,
  reverse = false,
) {
  const [size, setSize] = useState(initial);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startPos.current = axis === 'x' ? e.clientX : e.clientY;
      startSize.current = size;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [axis, size],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const raw =
        axis === 'x'
          ? e.clientX - startPos.current
          : e.clientY - startPos.current;
      const delta = reverse ? -raw : raw;
      setSize(Math.min(max, Math.max(min, startSize.current + delta)));
    },
    [axis, min, max, reverse],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return { size, onPointerDown, onPointerMove, onPointerUp };
}

/* ── Workspace content (inside providers) ───────────────── */

function WorkspaceContent({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { dagCollapsed, toggleDag } = useDag();
  const { state, dispatch, addNode, removeNode, selectedNode } = useFlow();
  const layout = useLayout();
  const { loadSkills, clearSkillDataCache } = useProjectStore();
  const sidebar = useResize('x', SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX);
  const dag = useResize('y', DAG_DEFAULT, DAG_MIN, DAG_MAX);
  const aiPanel = useResize('x', AI_PANEL_DEFAULT, AI_PANEL_MIN, AI_PANEL_MAX, true);
  const gitPanel = useResize('y', GIT_PANEL_DEFAULT, GIT_PANEL_MIN, GIT_PANEL_MAX, true);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [githubDialogOpen, setGithubDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [remapVersion, setRemapVersion] = useState(0);

  // Toolbar action state (lifted from WorkspaceToolbar)
  const [validating, setValidating] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [exporting, setExporting] = useState(false);

  const saveStatus = useSyncFlow(projectId, state.flow, state.dirty, dispatch);

  // Auto-create/remove DAG edges based on artifact dependencies
  useAutoEdges();

  // Ref for layout to avoid cascading dependency instability in useCallback/useMemo
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ── Lifted toolbar actions ─────────────────────────────

  const handleValidate = useCallback(async () => {
    setValidating(true);
    try {
      const result = await api.flows.validate(state.flow);
      layoutRef.current.openTab({
        id: 'validation',
        type: 'validation',
        label: result.valid ? 'Valid' : 'Invalid',
        validationResult: result,
      });
    } finally {
      setValidating(false);
    }
  }, [state.flow]);

  const handleRun = useCallback(async () => {
    setValidating(true);
    try {
      const result = await api.flows.validate(state.flow);
      if (!result.valid) {
        // Show validation errors instead of navigating to run
        layoutRef.current.openTab({
          id: 'validation',
          type: 'validation',
          label: 'Invalid',
          validationResult: result,
        });
        return;
      }
      navigate(`/projects/${projectId}/runs/new`);
    } finally {
      setValidating(false);
    }
  }, [state.flow, projectId, navigate]);

  const { startRun } = useRun();

  const handleRunInWorkspace = useCallback(async () => {
    setValidating(true);
    try {
      const result = await api.flows.validate(state.flow);
      if (!result.valid) {
        layoutRef.current.openTab({
          id: 'validation',
          type: 'validation',
          label: 'Invalid',
          validationResult: result,
        });
        return;
      }
      // Fetch required inputs to decide whether to show pre-run panel
      const { requiredInputs } = await api.projects.requiredInputs(projectId);
      if (requiredInputs.length > 0) {
        // Open pre-run tab for file uploads
        layoutRef.current.openTab({
          id: 'pre-run',
          type: 'pre-run',
          label: 'Run Config',
          projectId,
          requiredInputs,
          fetchingInputs: false,
        });
      } else {
        // No inputs needed — start run directly and open run tab
        await startRun(projectId, 'local', []);
        layoutRef.current.openTab({ id: 'run', type: 'run', label: 'Run' });
      }
    } finally {
      setValidating(false);
    }
  }, [state.flow, projectId, startRun]);

  const handleCompile = useCallback(async () => {
    setCompiling(true);
    try {
      const result = await api.flows.compilePreview(state.flow, projectId);
      layoutRef.current.openTab({
        id: 'compile-preview',
        type: 'compile',
        label: 'Compile Preview',
        compileResult: result,
      });
    } finally {
      setCompiling(false);
    }
  }, [state.flow]);

  const handleExport = useCallback(() => {
    setExportDialogOpen(true);
  }, []);

  const handleExportConfirm = useCallback(async (fileName: string) => {
    setExportDialogOpen(false);
    setExporting(true);
    try {
      await api.projects.exportBundle(projectId, fileName);
    } catch {
      // silent
    } finally {
      setExporting(false);
    }
  }, [projectId]);

  const handleToggleAI = useCallback(() => setAiPanelOpen((v) => !v), []);

  // ── Keyboard shortcuts ─────────────────────────────────

  // Use a ref for settingsOpen to avoid re-creating bindings array on every toggle
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;

  const bindings = useMemo<ShortcutBinding[]>(() => [
    // ── General ──
    {
      id: 'help.toggle', label: 'Keyboard shortcuts', category: 'general',
      key: '/', mod: true, global: true,
      handler: () => setSettingsOpen((v) => !v),
    },
    {
      id: 'escape', label: 'Dismiss', category: 'general',
      key: 'Escape', global: true,
      handler: () => {
        if (settingsOpenRef.current) setSettingsOpen(false);
        // Other Escape handlers (DAG fullscreen, rename cancel) are component-local
      },
    },

    // ── Tabs & Panels ──
    {
      id: 'panel.close', label: 'Close tab', category: 'tabs',
      key: 'w', mod: true, electronOnly: true,
      handler: () => {
        const api = layoutRef.current.api;
        if (!api) return;
        const active = api.activePanel;
        if (active) api.removePanel(active);
      },
    },
    {
      id: 'panel.next', label: 'Next tab', category: 'tabs',
      key: ']', mod: true,
      handler: () => {
        const api = layoutRef.current.api;
        if (!api) return;
        const active = api.activePanel;
        if (!active) return;
        const group = active.group;
        if (!group) return;
        const panels = group.panels;
        const idx = panels.indexOf(active);
        const next = panels[(idx + 1) % panels.length];
        next?.api.setActive();
      },
    },
    {
      id: 'panel.prev', label: 'Previous tab', category: 'tabs',
      key: '[', mod: true,
      handler: () => {
        const api = layoutRef.current.api;
        if (!api) return;
        const active = api.activePanel;
        if (!active) return;
        const group = active.group;
        if (!group) return;
        const panels = group.panels;
        const idx = panels.indexOf(active);
        const prev = panels[(idx - 1 + panels.length) % panels.length];
        prev?.api.setActive();
      },
    },
    {
      id: 'panel.split-right', label: 'Split right', category: 'tabs',
      key: '\\', mod: true,
      handler: () => {
        const api = layoutRef.current.api;
        if (!api) return;
        const active = api.activePanel;
        if (active) {
          api.addPanel({
            id: `empty-${Date.now()}`,
            component: 'empty',
            title: 'Empty',
            position: { referencePanel: active.id, direction: 'right' },
          });
        }
      },
    },
    {
      id: 'panel.split-down', label: 'Split down', category: 'tabs',
      key: '\\', mod: true, shift: true,
      handler: () => {
        const api = layoutRef.current.api;
        if (!api) return;
        const active = api.activePanel;
        if (active) {
          api.addPanel({
            id: `empty-${Date.now()}`,
            component: 'empty',
            title: 'Empty',
            position: { referencePanel: active.id, direction: 'below' },
          });
        }
      },
    },
    // Cmd+1-9 — Focus group by index
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `group.${i + 1}` as const,
      label: `Focus group ${i + 1}`,
      category: 'tabs' as const,
      key: String(i + 1),
      mod: true,
      handler: () => {
        const api = layoutRef.current.api;
        if (!api) return;
        const groups = api.groups;
        if (i < groups.length) {
          groups[i].panels[0]?.api.setActive();
        }
      },
    })),

    // ── Toolbar Actions ──
    {
      id: 'toolbar.validate', label: 'Validate', category: 'toolbar',
      key: 'b', mod: true, shift: true,
      handler: () => handleValidate(),
    },
    {
      id: 'toolbar.compile', label: 'Compile preview', category: 'toolbar',
      key: 'e', mod: true, shift: true,
      handler: () => handleCompile(),
    },
    {
      id: 'toolbar.run', label: 'Run flow', category: 'toolbar',
      key: 'r', mod: true, shift: true,
      handler: () => handleRun(),
    },
    {
      id: 'toolbar.export', label: 'Export .forge', category: 'toolbar',
      key: 'x', mod: true, shift: true,
      handler: () => handleExport(),
    },

    // ── Layout ──
    {
      id: 'layout.toggle-dag', label: 'Toggle DAG', category: 'layout',
      key: 'd', mod: true, shift: true,
      handler: () => toggleDag(),
    },
    {
      id: 'layout.toggle-ai', label: 'Toggle Forge AI', category: 'layout',
      key: 'j', mod: true, shift: true,
      handler: () => handleToggleAI(),
    },
    {
      id: 'layout.focus-explorer', label: 'Focus explorer', category: 'layout',
      key: '0', mod: true,
      handler: () => {
        const el = document.querySelector('[data-panel="explorer"] [role="treeitem"]') as HTMLElement;
        el?.focus();
      },
    },
    {
      id: 'layout.toggle-git', label: 'Toggle Git panel', category: 'layout',
      key: 'g', mod: true, shift: true,
      handler: () => setGitPanelOpen((v) => !v),
    },
    {
      id: 'layout.focus-ai', label: 'Focus AI input', category: 'layout',
      key: 'l', mod: true, shift: true,
      handler: () => {
        // Ensure AI panel is open, then focus the textarea
        setAiPanelOpen(true);
        requestAnimationFrame(() => {
          const textarea = document.querySelector('[data-panel="ai"] textarea') as HTMLElement;
          textarea?.focus();
        });
      },
    },

    // ── Node Operations ──
    {
      id: 'node.add-agent', label: 'New agent', category: 'nodes',
      key: 'n', mod: true, shift: true,
      handler: () => addNode('agent', { x: 200, y: 200 }),
    },
    {
      id: 'node.add-checkpoint', label: 'New checkpoint', category: 'nodes',
      key: 'p', mod: true, shift: true,
      handler: () => addNode('checkpoint', { x: 200, y: 200 }),
    },
    {
      id: 'node.delete', label: 'Delete selected', category: 'nodes',
      key: 'Backspace', mod: true,
      handler: () => {
        if (selectedNode && window.confirm(`Delete "${selectedNode.name}"?`)) {
          removeNode(selectedNode.id);
        }
      },
    },

    // ── Navigation ──
    {
      id: 'nav.dashboard', label: 'Dashboard', category: 'navigation',
      key: 'h', mod: true, shift: true,
      handler: () => navigate('/'),
    },
    {
      id: 'nav.history', label: 'Run history', category: 'navigation',
      key: 'y', mod: true, shift: true,
      handler: () => navigate(`/projects/${projectId}/runs`),
    },
  ], [toggleDag, handleToggleAI, handleValidate, handleCompile, handleRun, handleExport, addNode, removeNode, selectedNode, navigate, projectId]);

  // Apply any custom remaps from localStorage
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeBindings = useMemo(() => applyRemaps(bindings), [bindings, remapVersion]);

  useKeyboardShortcuts(activeBindings);

  // Reload flow from server when copilot mutates it or after git operations
  const handleFlowChanged = useCallback(async () => {
    try {
      const flow = await api.projects.getFlow(projectId);
      if (!flow) return;

      // Compute positions for the updated flow (auto-layout if new nodes appeared)
      let newPositions: Record<string, { x: number; y: number }>;
      if (flow.layout && Object.keys(flow.layout).length > 0) {
        const allHavePositions = flow.nodes.every((n) => flow.layout![n.id]);
        if (allHavePositions) {
          newPositions = flow.layout;
        } else {
          // Mix saved + auto-layout for new nodes
          newPositions = await autoLayout(flow.nodes, flow.edges);
          // Prefer saved positions where available
          for (const [id, pos] of Object.entries(flow.layout)) {
            newPositions[id] = pos;
          }
        }
      } else {
        newPositions = await autoLayout(flow.nodes, flow.edges);
      }

      // Clear cached skill data so open skill tabs re-fetch from server
      clearSkillDataCache();

      dispatch({ type: 'SET_FLOW', flow, positions: newPositions });

      // Also reload skills — copilot may have created/updated skills
      loadSkills(projectId).catch(() => {});
    } catch (err) {
      console.error('Failed to reload flow after copilot change:', err);
    }
  }, [projectId, dispatch, loadSkills, clearSkillDataCache]);

  return (
    <CopilotProvider projectId={projectId} onFlowChanged={handleFlowChanged}>
      <GitProvider projectId={projectId} onFlowChanged={handleFlowChanged}>
      <div className="h-screen flex flex-col">
        <WorkspaceToolbar
          projectId={projectId}
          onToggleAI={handleToggleAI}
          aiPanelOpen={aiPanelOpen}
          saveStatus={saveStatus}
          onValidate={handleValidate}
          onCompile={handleCompile}
          onRun={handleRun}
          onRunInWorkspace={handleRunInWorkspace}
          onExport={handleExport}
          onShowSettings={() => setSettingsOpen(true)}
          validating={validating}
          compiling={compiling}
          exporting={exporting}
          onToggleGit={() => setGitPanelOpen((v) => !v)}
          gitPanelOpen={gitPanelOpen}
          onOpenGitHub={() => setGithubDialogOpen(true)}
        />

        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar — Agent Explorer */}
          <div
            data-panel="explorer"
            className="border-r border-[var(--color-border)] shrink-0 overflow-hidden bg-[var(--color-sidebar-bg)]"
            style={{ width: sidebar.size }}
          >
            <AgentExplorer />
          </div>

          {/* Sidebar resize handle */}
          <div
            className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-node-agent)]/20 active:bg-[var(--color-node-agent)]/30 transition-colors"
            onPointerDown={sidebar.onPointerDown}
            onPointerMove={sidebar.onPointerMove}
            onPointerUp={sidebar.onPointerUp}
          />

          {/* Main area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* DAG mini-view (collapsible + resizable) */}
            {!dagCollapsed && (
              <>
                <DagMiniView height={dag.size} />
                <div
                  className="h-1 shrink-0 cursor-row-resize hover:bg-[var(--color-node-agent)]/20 active:bg-[var(--color-node-agent)]/30 transition-colors"
                  onPointerDown={dag.onPointerDown}
                  onPointerMove={dag.onPointerMove}
                  onPointerUp={dag.onPointerUp}
                />
              </>
            )}
            {dagCollapsed && (
              <div className="h-0 border-b border-[var(--color-border)]" />
            )}

            {/* Editor panel(s) — dockview manages splits */}
            <div className="flex-1 overflow-hidden bg-white">
              <EditorLayout />
            </div>

            {/* Git Panel (bottom, resizable) */}
            {gitPanelOpen && (
              <>
                <div
                  className="h-1 shrink-0 cursor-row-resize hover:bg-[var(--color-node-agent)]/20 active:bg-[var(--color-node-agent)]/30 transition-colors"
                  onPointerDown={gitPanel.onPointerDown}
                  onPointerMove={gitPanel.onPointerMove}
                  onPointerUp={gitPanel.onPointerUp}
                />
                <div
                  data-panel="git"
                  className="shrink-0 overflow-hidden border-t border-[var(--color-border)]"
                  style={{ height: gitPanel.size }}
                >
                  <GitPanel onClose={() => setGitPanelOpen(false)} />
                </div>
              </>
            )}
          </div>

          {/* AI Side Panel */}
          {aiPanelOpen && (
            <>
              {/* AI panel resize handle */}
              <div
                className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-node-agent)]/20 active:bg-[var(--color-node-agent)]/30 transition-colors"
                onPointerDown={aiPanel.onPointerDown}
                onPointerMove={aiPanel.onPointerMove}
                onPointerUp={aiPanel.onPointerUp}
              />
              <div
                data-panel="ai"
                className="shrink-0 border-l border-[var(--color-border)] overflow-hidden"
                style={{ width: aiPanel.size }}
              >
                <AISidePanel />
              </div>
            </>
          )}
        </div>

        {/* Keyboard shortcut help overlay */}
        {settingsOpen && (
          <SettingsOverlay
            bindings={activeBindings}
            onClose={() => setSettingsOpen(false)}
            onRemapChange={() => setRemapVersion((v) => v + 1)}
          />
        )}

        {/* Export dialog */}
        {exportDialogOpen && (
          <ExportDialog
            defaultName={state.flow.name || projectId}
            onExport={handleExportConfirm}
            onClose={() => setExportDialogOpen(false)}
          />
        )}

        {/* GitHub connect dialog */}
        {githubDialogOpen && (
          <GitHubConnectDialog
            projectId={projectId}
            onClose={() => setGithubDialogOpen(false)}
          />
        )}
      </div>
      </GitProvider>
    </CopilotProvider>
  );
}

/* ── Error boundary ──────────────────────────────────────── */

class WorkspaceErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; info: string }
> {
  state: { error: Error | null; info: string } = { error: null, info: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[WorkspaceErrorBoundary]', error, info.componentStack);
    this.setState({ info: info.componentStack ?? '' });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex flex-col items-center justify-center gap-4 p-8">
          <div className="text-sm font-semibold text-red-600">Something went wrong</div>
          <pre className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl overflow-auto max-h-60 whitespace-pre-wrap">
            {this.state.error.message}
            {this.state.info}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs px-4 py-2 rounded-lg bg-[var(--color-node-agent)] text-white"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Page component (reads URL param, loads flow) ───────── */

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getFlowById, loadProject, loadSkills, loadReferences } = useProjectStore();
  const [loading, setLoading] = useState(true);

  // Load project data from API on mount
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      await loadProject(id!);
      await Promise.all([loadSkills(id!), loadReferences(id!)]);
      if (!cancelled) setLoading(false);
    }
    load();

    return () => { cancelled = true; };
  }, [id, loadProject, loadSkills, loadReferences]);

  const flow = id ? getFlowById(id) : null;

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [layoutReady, setLayoutReady] = useState(false);

  useEffect(() => {
    if (!flow) {
      setLayoutReady(true);
      return;
    }

    // If saved layout positions exist for all nodes, use them immediately
    if (flow.layout && Object.keys(flow.layout).length > 0) {
      const allHavePositions = flow.nodes.every((n) => flow.layout![n.id]);
      if (allHavePositions) {
        setPositions(flow.layout);
        setLayoutReady(true);
        return;
      }
    }

    // Otherwise compute layout via ELK (async)
    let cancelled = false;
    setLayoutReady(false);
    autoLayout(flow.nodes, flow.edges).then((pos) => {
      if (!cancelled) {
        setPositions(pos);
        setLayoutReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [flow]);

  if (!id) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No project ID specified
      </div>
    );
  }

  if (loading || !layoutReady) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
          <div className="w-4 h-4 border-2 border-[var(--color-node-agent)] border-t-transparent rounded-full animate-spin" />
          Loading project...
        </div>
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <div className="text-sm text-[var(--color-text-muted)]">
          Project not found: <span className="font-mono">{id}</span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--color-node-agent)] text-white hover:bg-[var(--color-node-agent)]/90 transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <WorkspaceErrorBoundary>
      <FlowProvider key={id} flow={flow} positions={positions}>
        <DagProvider>
          <LayoutProvider>
            <RunProvider>
              <WorkspaceContent projectId={id} />
            </RunProvider>
          </LayoutProvider>
        </DagProvider>
      </FlowProvider>
    </WorkspaceErrorBoundary>
  );
}
