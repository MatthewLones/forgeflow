import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FlowProvider, useFlow } from '../context/FlowContext';
import { DagProvider, useDag } from '../context/DagContext';
import { LayoutProvider } from '../context/LayoutContext';
import { RunProvider } from '../context/RunContext';
import { useProjectStore } from '../context/ProjectStore';
import { AgentExplorer } from '../components/workspace/AgentExplorer';
import { WorkspaceToolbar } from '../components/workspace/WorkspaceToolbar';
import { DagMiniView } from '../components/workspace/DagMiniView';
import { EditorLayout } from '../components/workspace/EditorLayout';
import { AISidePanel } from '../components/ai/AISidePanel';
import { autoLayout } from '../lib/flow-to-reactflow';
import { useSyncFlow, type SaveStatus } from '../hooks/useSyncFlow';
import { useAutoEdges } from '../hooks/useAutoEdges';

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
  const { dagCollapsed } = useDag();
  const { state, dispatch } = useFlow();
  const sidebar = useResize('x', SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX);
  const dag = useResize('y', DAG_DEFAULT, DAG_MIN, DAG_MAX);
  const aiPanel = useResize('x', AI_PANEL_DEFAULT, AI_PANEL_MIN, AI_PANEL_MAX, true);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);

  const saveStatus = useSyncFlow(projectId, state.flow, state.dirty, dispatch);

  // Auto-create/remove DAG edges based on artifact dependencies
  useAutoEdges();

  return (
    <div className="h-screen flex flex-col">
      <WorkspaceToolbar projectId={projectId} onToggleAI={() => setAiPanelOpen((v) => !v)} aiPanelOpen={aiPanelOpen} saveStatus={saveStatus} />

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar — Agent Explorer */}
        <div
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
              className="shrink-0 border-l border-[var(--color-border)] overflow-hidden"
              style={{ width: aiPanel.size }}
            >
              <AISidePanel />
            </div>
          </>
        )}
      </div>
    </div>
  );
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

  const positions = useMemo(
    () => (flow ? autoLayout(flow.nodes, flow.edges) : {}),
    [flow],
  );

  if (!id) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No project ID specified
      </div>
    );
  }

  if (loading) {
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
    <FlowProvider key={id} flow={flow} positions={positions}>
      <DagProvider>
        <LayoutProvider>
          <RunProvider>
            <WorkspaceContent projectId={id} />
          </RunProvider>
        </LayoutProvider>
      </DagProvider>
    </FlowProvider>
  );
}
