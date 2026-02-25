import { useNavigate } from 'react-router-dom';
import { useFlow } from '../../context/FlowContext';
import { useDag } from '../../context/DagContext';
import type { SaveStatus } from '../../hooks/useSyncFlow';

interface WorkspaceToolbarProps {
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

export function WorkspaceToolbar({ onToggleAI, aiPanelOpen, saveStatus = 'idle' }: WorkspaceToolbarProps) {
  const { state } = useFlow();
  const { flow } = state;
  const { dagCollapsed, toggleDag } = useDag();
  const navigate = useNavigate();

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
        <ToolbarButton label="Validate" disabled title="Coming in 5.5c" />
        <ToolbarButton label="Export" disabled title="Coming in 5.5c" />

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
