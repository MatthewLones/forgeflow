import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../../context/FlowContext';
import { useDag } from '../../context/DagContext';
import { useLayout } from '../../context/LayoutContext';
import { useRun } from '../../context/RunContext';
import { api } from '../../lib/api-client';
import type { SaveStatus } from '../../hooks/useSyncFlow';

interface WorkspaceToolbarProps {
  projectId: string;
  onToggleAI?: () => void;
  aiPanelOpen?: boolean;
  saveStatus?: SaveStatus;
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving...',
  saved: 'Saved',
  error: 'Save failed',
};

export function WorkspaceToolbar({ projectId, onToggleAI, aiPanelOpen, saveStatus = 'idle' }: WorkspaceToolbarProps) {
  const { state } = useFlow();
  const { flow } = state;
  const { dagCollapsed, toggleDag } = useDag();
  const { openTab, selectRunHistory } = useLayout();
  const { run, startRun, resetRun } = useRun();
  const navigate = useNavigate();
  const [validating, setValidating] = useState(false);
  const [compiling, setCompiling] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const result = await api.flows.validate(flow);
      openTab({
        id: 'validation',
        type: 'validation',
        label: result.valid ? 'Valid' : 'Invalid',
        validationResult: result,
      });
    } finally {
      setValidating(false);
    }
  };

  const handleCompile = async () => {
    setCompiling(true);
    try {
      const result = await api.flows.compilePreview(flow);
      openTab({
        id: 'compile-preview',
        type: 'compile',
        label: 'Compile Preview',
        compileResult: result,
      });
    } finally {
      setCompiling(false);
    }
  };

  const isRunning = run.status === 'running' || run.status === 'starting';

  const handleRun = async () => {
    if (isRunning) return;
    if (run.status !== 'idle') resetRun();
    openTab({ id: 'run', type: 'run', label: 'Run' });
    await startRun(projectId, 'mock');
  };

  return (
    <div className="h-10 px-4 flex items-center gap-4 border-b border-[var(--color-border)] bg-white shrink-0">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-sm font-bold text-[var(--color-node-agent)] hover:opacity-80 transition-opacity"
      >
        ForgeFlow
      </button>
      <span className="text-sm text-[var(--color-text-muted)]">/</span>
      <span className="text-sm font-medium">{flow.name}</span>

      {/* Save status indicator */}
      {saveStatus !== 'idle' && (
        <span
          className={`text-[10px] font-medium transition-opacity ${
            saveStatus === 'error'
              ? 'text-red-500'
              : saveStatus === 'saving'
                ? 'text-[var(--color-text-muted)]'
                : 'text-[var(--color-node-merge)]'
          }`}
        >
          {SAVE_LABELS[saveStatus]}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggleDag}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
        >
          {dagCollapsed ? 'Show DAG' : 'Hide DAG'}
        </button>
        <ToolbarButton label={validating ? 'Validating...' : 'Validate'} onClick={handleValidate} disabled={validating} />
        <ToolbarButton label={compiling ? 'Compiling...' : 'Compile'} onClick={handleCompile} disabled={compiling} />
        <RunButton status={run.status} onClick={handleRun} disabled={isRunning} />
        <ToolbarButton label="History" onClick={() => selectRunHistory(projectId)} />

        {onToggleAI && (
          <button
            type="button"
            onClick={onToggleAI}
            className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
              aiPanelOpen
                ? 'border-[var(--color-node-agent)] bg-[var(--color-node-agent)] text-white'
                : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
            }`}
          >
            Forge
          </button>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({ label, onClick, disabled, title }: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {label}
    </button>
  );
}

const RUN_LABELS: Record<string, string> = {
  idle: 'Run',
  starting: 'Starting...',
  running: 'Running...',
  awaiting_input: 'Waiting...',
  completed: 'Run',
  failed: 'Run',
};

function RunButton({ status, onClick, disabled }: {
  status: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const isActive = status === 'running' || status === 'starting';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        isActive
          ? 'border-blue-500 bg-blue-500 text-white'
          : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
      }`}
    >
      {RUN_LABELS[status] ?? 'Run'}
    </button>
  );
}
