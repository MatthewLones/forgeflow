import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useRun } from '../context/RunContext';
import { useProjectStore } from '../context/ProjectStore';
import { DashboardToolbar } from '../components/run-dashboard/DashboardToolbar';
import { DashboardDAG } from '../components/run-dashboard/DashboardDAG';
import { EventStream } from '../components/run-dashboard/EventStream';
import { WorkspaceExplorer } from '../components/run-dashboard/WorkspaceExplorer';
import { PreviewDrawer, type PreviewTarget } from '../components/run-dashboard/PreviewDrawer';
import { NodePromptDrawer } from '../components/run-dashboard/NodePromptDrawer';
import { RunSummary } from '../components/run-dashboard/RunSummary';
import { InputWizard } from '../components/run-dashboard/InputWizard';
import { TodoWidget } from '../components/shared/TodoWidget';
import { derivePhaseTodos } from '../lib/derive-phase-todos';
import type { FlowDefinition } from '@forgeflow/types';
import { api } from '../lib/api-client';

/* ── Main content ─────────────────────────────────────── */

export function RunDashboardPage() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const navigate = useNavigate();
  const { run, interruptHistory, checkpointHistory, pendingCheckpoint, startRun, stopRun, resetRun, connectToRun } = useRun();
  const { projects } = useProjectStore();

  // Flow data for the DAG
  const [flow, setFlow] = useState<FlowDefinition | null>(null);
  const [loadingFlow, setLoadingFlow] = useState(true);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Dashboard state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [promptNodeId, setPromptNodeId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Wizard mode (runId === 'new')
  const isWizard = runId === 'new';

  // Load flow on mount
  const loadFlow = useCallback(() => {
    if (!projectId) return;
    setLoadingFlow(true);
    setFlowError(null);
    api.projects.getFlow(projectId)
      .then((f) => setFlow(f))
      .catch((err) => {
        console.error('[RunDashboard] Failed to load flow:', err);
        setFlowError(err instanceof Error ? err.message : 'Failed to load flow');
      })
      .finally(() => setLoadingFlow(false));
  }, [projectId]);

  useEffect(() => { loadFlow(); }, [loadFlow]);

  // Subscribe to SSE when navigating directly to an existing run
  useEffect(() => {
    if (isWizard || !runId || run.runId === runId) return;
    connectToRun(runId);
  }, [runId, isWizard, run.runId, connectToRun]);

  // Don't auto-switch to summary — let the user click "View Summary"
  // This prevents the "run disappearing" issue where the event stream
  // gets hidden and the summary fetch might fail.

  // Wizard error state (e.g. validation failures)
  const [wizardError, setWizardError] = useState<string | null>(null);

  // Handle wizard start
  const handleWizardStart = useCallback(async (runner: 'mock' | 'local' | 'docker', files: File[], model?: string) => {
    if (!projectId) return;
    setWizardError(null);
    console.log('[RunDashboard] handleWizardStart:', { runner, fileCount: files.length, model });
    try {
      await startRun(projectId, runner, files, model);
      console.log('[RunDashboard] startRun resolved, run state:', run.status, run.runId);
    } catch (err) {
      console.error('[RunDashboard] startRun FAILED:', err);
      setWizardError(err instanceof Error ? err.message : 'Failed to start run');
    }
  }, [projectId, startRun, run.status, run.runId]);

  // After startRun, update URL without re-mounting (replace avoids remount + new RunProvider)
  useEffect(() => {
    if (isWizard && run.runId && run.status !== 'idle') {
      window.history.replaceState(null, '', `/projects/${projectId}/runs/${run.runId}`);
    }
  }, [isWizard, run.runId, run.status, projectId]);

  const handleRerun = useCallback(() => {
    resetRun();
    setShowSummary(false);
    navigate(`/projects/${projectId}/runs/new`);
  }, [resetRun, projectId, navigate]);

  // File click handlers
  const handleEventFileClick = useCallback((fileName: string, nodeId?: string) => {
    if (!run.runId) return;
    setPreviewTarget({
      type: 'artifact',
      runId: run.runId,
      filePath: fileName,
      projectId,
    });
  }, [run.runId, projectId]);

  const handleWorkspaceFileClick = useCallback((phaseId: string, filePath: string) => {
    if (!run.runId) return;
    setPreviewTarget({
      type: 'workspace',
      runId: run.runId,
      phaseId,
      filePath,
      projectId,
    });
  }, [run.runId, projectId]);

  const handleArtifactClick = useCallback((fileName: string) => {
    if (!run.runId) return;
    setPreviewTarget({
      type: 'artifact',
      runId: run.runId,
      filePath: fileName,
      projectId,
    });
  }, [run.runId, projectId]);

  // Hooks must be called before any early returns
  const phaseTodos = useMemo(() => derivePhaseTodos(run.events), [run.events]);

  // Debug logging
  console.log('[RunDashboard] render:', {
    projectId,
    runId,
    isWizard,
    'run.status': run.status,
    'run.runId': run.runId,
    'run.events.length': run.events.length,
    loadingFlow,
    hasFlow: !!flow,
  });

  if (!projectId) return null;

  // Wizard mode
  if (isWizard && run.status === 'idle') {
    return (
      <div className="h-screen flex flex-col bg-[var(--color-canvas-bg)]">
        <DashboardToolbar
          projectId={projectId}
          status="idle"
          runId={null}
          totalCost={{ turns: 0, usd: 0 }}
          reconnecting={false}
          onStop={() => {}}
          onRerun={() => {}}
        />
        <div className="flex-1 overflow-hidden">
          <InputWizard
            projectId={projectId}
            onStartRun={handleWizardStart}
            onCancel={() => navigate(`/workspace/${projectId}`)}
            error={wizardError}
          />
        </div>
      </div>
    );
  }

  if (loadingFlow) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Loading...
      </div>
    );
  }

  const isRunning = run.status === 'running' || run.status === 'starting';
  const isDone = run.status === 'completed' || run.status === 'failed';

  const checkpointTotal = checkpointHistory.length + (pendingCheckpoint ? 1 : 0);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-canvas-bg)]">
      <DashboardToolbar
        projectId={projectId}
        status={run.status}
        runId={run.runId}
        totalCost={run.totalCost}
        reconnecting={run.reconnecting}
        onStop={stopRun}
        onRerun={handleRerun}
        interruptCount={interruptHistory.length}
        onInterrupts={() => navigate('interrupts')}
        checkpointCount={checkpointTotal}
        onCheckpoints={() => navigate('checkpoint')}
      />

      {/* Interrupt notification bar */}
      {run.pendingInterrupt && (
        <button
          type="button"
          onClick={() => navigate('interrupts')}
          className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer w-full text-left"
        >
          <span className="animate-pulse w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
          <span className="text-xs font-semibold text-amber-800 truncate">
            Interrupt: {run.pendingInterrupt.title}
          </span>
          <span className="text-[10px] font-mono text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
            {run.pendingInterrupt.type}
          </span>
          <span className="ml-auto text-[10px] text-amber-600 shrink-0">
            Click to respond &rarr;
          </span>
        </button>
      )}
      {/* Checkpoint notification bar */}
      {pendingCheckpoint && !run.pendingInterrupt && run.runId && (
        <button
          type="button"
          onClick={() => navigate('checkpoint')}
          className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer w-full text-left"
        >
          <span className="animate-pulse w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
          <span className="text-xs font-semibold text-amber-800 truncate">
            Checkpoint: {pendingCheckpoint.checkpoint.presentation?.title ?? pendingCheckpoint.checkpoint.checkpointNodeId}
          </span>
          <span className="text-[10px] font-mono text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
            {pendingCheckpoint.checkpoint.expectedFiles?.length ?? 0} files expected
          </span>
          <span className="ml-auto text-[10px] text-amber-600 shrink-0">
            Click to respond &rarr;
          </span>
        </button>
      )}

      {/* Main content — resizable panels */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup orientation="vertical">
          {/* Phase progress todos — resizable panel */}
          {phaseTodos.length > 0 && (
            <>
              <Panel defaultSize={20} minSize={3} maxSize={50}>
                <div className="h-full px-4 py-2 bg-white">
                  <TodoWidget todos={phaseTodos} isActive={run.status === 'running'} fillHeight />
                </div>
              </Panel>
              <PanelResizeHandle className="h-1.5 bg-transparent hover:bg-blue-200/60 transition-colors cursor-row-resize flex items-center justify-center group border-y border-[var(--color-border)]">
                <div className="w-8 h-0.5 rounded bg-gray-300 group-hover:bg-blue-400 transition-colors" />
              </PanelResizeHandle>
            </>
          )}

          {/* DAG panel */}
          <Panel defaultSize={flow ? (phaseTodos.length > 0 ? 30 : 40) : 0} minSize={flow ? 15 : 0}>
            {flow ? (
              <div className="h-full">
                <DashboardDAG
                  nodes={flow.nodes}
                  edges={flow.edges}
                  nodeStatuses={run.nodeStatuses}
                  selectedNodeId={selectedNodeId}
                  onNodeClick={setSelectedNodeId}
                  onNodeDoubleClick={setPromptNodeId}
                />
              </div>
            ) : !loadingFlow && flowError ? (
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50">
                <span className="text-xs text-amber-600">Could not load flow graph: {flowError}</span>
                <button
                  type="button"
                  onClick={loadFlow}
                  className="text-[10px] px-2 py-0.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-100"
                >
                  Retry
                </button>
              </div>
            ) : null}
          </Panel>

          {flow && (
            <PanelResizeHandle className="h-1.5 bg-transparent hover:bg-blue-200/60 transition-colors cursor-row-resize flex items-center justify-center group border-y border-[var(--color-border)]">
              <div className="w-8 h-0.5 rounded bg-gray-300 group-hover:bg-blue-400 transition-colors" />
            </PanelResizeHandle>
          )}

          {/* Bottom panel: EventStream + WorkspaceExplorer */}
          <Panel defaultSize={flow ? (phaseTodos.length > 0 ? 50 : 60) : (phaseTodos.length > 0 ? 80 : 100)} minSize={20}>
            {run.runId ? (
              <PanelGroup orientation="horizontal">
                <Panel defaultSize={70} minSize={30}>
                  <EventStreamPanel
                    showSummary={showSummary}
                    isDone={isDone}
                    isRunning={isRunning}
                    run={run}
                    selectedNodeId={selectedNodeId}
                    onSetShowSummary={setShowSummary}
                    onNodeClick={setSelectedNodeId}
                    onFileClick={handleEventFileClick}
                    onArtifactClick={handleArtifactClick}
                  />
                </Panel>
                <PanelResizeHandle className="w-1.5 bg-transparent hover:bg-blue-200/60 transition-colors cursor-col-resize flex items-center justify-center group border-x border-[var(--color-border)]">
                  <div className="h-8 w-0.5 rounded bg-gray-300 group-hover:bg-blue-400 transition-colors" />
                </PanelResizeHandle>
                <Panel defaultSize={30} minSize={15}>
                  <WorkspaceExplorer
                    runId={run.runId}
                    isRunning={isRunning}
                    onFileClick={handleWorkspaceFileClick}
                  />
                </Panel>
              </PanelGroup>
            ) : (
              <EventStreamPanel
                showSummary={showSummary}
                isDone={isDone}
                isRunning={isRunning}
                run={run}
                selectedNodeId={selectedNodeId}
                onSetShowSummary={setShowSummary}
                onNodeClick={setSelectedNodeId}
                onFileClick={handleEventFileClick}
                onArtifactClick={handleArtifactClick}
              />
            )}
          </Panel>
        </PanelGroup>
      </div>

      {/* Preview drawer */}
      <PreviewDrawer
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
      />

      {/* Node prompt drawer (double-click) */}
      <NodePromptDrawer
        nodeId={promptNodeId}
        projectId={projectId}
        flow={flow}
        onClose={() => setPromptNodeId(null)}
      />
    </div>
  );
}

/* ── Event Stream Panel (extracted to avoid duplication) ── */

function EventStreamPanel({
  showSummary,
  isDone,
  isRunning,
  run,
  selectedNodeId,
  onSetShowSummary,
  onNodeClick,
  onFileClick,
  onArtifactClick,
}: {
  showSummary: boolean;
  isDone: boolean;
  isRunning: boolean;
  run: ReturnType<typeof useRun>['run'];
  selectedNodeId: string | null;
  onSetShowSummary: (v: boolean) => void;
  onNodeClick: (nodeId: string | null) => void;
  onFileClick: (fileName: string, nodeId?: string) => void;
  onArtifactClick: (fileName: string) => void;
}) {
  if (showSummary && isDone && run.runId) {
    return (
      <div className="h-full flex flex-col">
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-white">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Summary</span>
          <button
            type="button"
            onClick={() => onSetShowSummary(false)}
            className="ml-auto text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Show Events
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <RunSummary runId={run.runId} onArtifactClick={onArtifactClick} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {isDone && run.runId && (
        <div className="shrink-0 flex justify-end px-3 py-1 bg-white border-b border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => onSetShowSummary(true)}
            className="text-[10px] text-[var(--color-node-agent)] hover:underline"
          >
            View Summary
          </button>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <EventStream
          events={run.events}
          nodeFilter={selectedNodeId}
          isRunning={isRunning}
          isDone={isDone}
          startedAt={run.startedAt}
          currentPhase={run.currentPhaseId}
          onNodeClick={onNodeClick}
          onFileClick={onFileClick}
          onViewSummary={() => onSetShowSummary(true)}
        />
      </div>
    </div>
  );
}

