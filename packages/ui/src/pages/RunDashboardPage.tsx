import { useState, useCallback, useEffect, Component, type ErrorInfo, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { RunProvider, useRun } from '../context/RunContext';
import { useProjectStore } from '../context/ProjectStore';
import { DashboardToolbar } from '../components/run-dashboard/DashboardToolbar';
import { DashboardDAG } from '../components/run-dashboard/DashboardDAG';
import { EventStream } from '../components/run-dashboard/EventStream';
import { WorkspaceExplorer } from '../components/run-dashboard/WorkspaceExplorer';
import { PreviewDrawer, type PreviewTarget } from '../components/run-dashboard/PreviewDrawer';
import { RunSummary } from '../components/run-dashboard/RunSummary';
import { InputWizard } from '../components/run-dashboard/InputWizard';
import { InterruptBanner } from '../components/workspace/InterruptBanner';
import { CheckpointBanner } from '../components/workspace/CheckpointBanner';
import type { FlowDefinition, ProgressEvent } from '@forgeflow/types';
import { api } from '../lib/api-client';

/* ── Error boundary ────────────────────────────────────── */

class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RunDashboard] CRASH:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex flex-col items-center justify-center bg-red-50 p-8">
          <h2 className="text-lg font-bold text-red-700 mb-2">Dashboard Error</h2>
          <pre className="text-xs text-red-600 bg-white border border-red-200 rounded p-4 max-w-2xl overflow-auto whitespace-pre-wrap">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Page wrapper ─────────────────────────────────────── */

export function RunDashboardPage() {
  return (
    <DashboardErrorBoundary>
      <RunProvider>
        <ReactFlowProvider>
          <RunDashboardContent />
        </ReactFlowProvider>
      </RunProvider>
    </DashboardErrorBoundary>
  );
}

/* ── Main content ─────────────────────────────────────── */

function RunDashboardContent() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const navigate = useNavigate();
  const { run, startRun, stopRun, resetRun, answerInterrupt, connectToRun } = useRun();
  const { projects } = useProjectStore();

  // Flow data for the DAG
  const [flow, setFlow] = useState<FlowDefinition | null>(null);
  const [loadingFlow, setLoadingFlow] = useState(true);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Dashboard state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
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

  // Handle wizard start
  const handleWizardStart = useCallback(async (runner: 'mock' | 'local' | 'docker', files: File[], model?: string) => {
    if (!projectId) return;
    console.log('[RunDashboard] handleWizardStart:', { runner, fileCount: files.length, model });
    try {
      await startRun(projectId, runner, files, model);
      console.log('[RunDashboard] startRun resolved, run state:', run.status, run.runId);
    } catch (err) {
      console.error('[RunDashboard] startRun FAILED:', err);
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

  // Find checkpoint for banner
  const lastCheckpoint = run.status === 'awaiting_input'
    ? [...run.events].reverse().find((e): e is ProgressEvent & { type: 'checkpoint' } => e.type === 'checkpoint')
    : null;

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
      />

      {/* Interrupt / checkpoint overlay */}
      {run.pendingInterrupt && (
        <div className="shrink-0 border-b border-amber-200">
          <InterruptBanner interrupt={run.pendingInterrupt} onSubmit={answerInterrupt} />
        </div>
      )}
      {lastCheckpoint && !run.pendingInterrupt && (
        <div className="shrink-0 border-b border-amber-200">
          <CheckpointBanner projectId={projectId} checkpoint={lastCheckpoint.checkpoint} />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* DAG (top ~40%) */}
        {flow ? (
          <div className="h-[40%] min-h-[160px] border-b border-[var(--color-border)]">
            <DashboardDAG
              nodes={flow.nodes}
              edges={flow.edges}
              nodeStatuses={run.nodeStatuses}
              selectedNodeId={selectedNodeId}
              onNodeClick={setSelectedNodeId}
            />
          </div>
        ) : !loadingFlow && flowError ? (
          <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] bg-amber-50">
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

        {/* Bottom split: Event Stream + Workspace Explorer / Summary */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Event Stream or Summary */}
          <div className="flex-1 min-w-0 border-r border-[var(--color-border)]">
            {showSummary && isDone && run.runId ? (
              <div className="h-full flex flex-col">
                <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-white">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Summary</span>
                  <button
                    type="button"
                    onClick={() => setShowSummary(false)}
                    className="ml-auto text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  >
                    Show Events
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <RunSummary runId={run.runId} onArtifactClick={handleArtifactClick} />
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col">
                {isDone && run.runId && (
                  <div className="shrink-0 flex justify-end px-3 py-1 bg-white border-b border-[var(--color-border)]">
                    <button
                      type="button"
                      onClick={() => setShowSummary(true)}
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
                    onNodeClick={setSelectedNodeId}
                    onFileClick={handleEventFileClick}
                    onViewSummary={() => setShowSummary(true)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right: Workspace Explorer */}
          {run.runId && (
            <div className="w-[300px] min-w-[200px]">
              <WorkspaceExplorer
                runId={run.runId}
                isRunning={isRunning}
                onFileClick={handleWorkspaceFileClick}
              />
            </div>
          )}
        </div>
      </div>

      {/* Preview drawer */}
      <PreviewDrawer
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
      />
    </div>
  );
}
