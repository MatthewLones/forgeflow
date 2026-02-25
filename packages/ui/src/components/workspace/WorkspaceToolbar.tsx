import { useNavigate } from 'react-router-dom';
import { useFlow } from '../../context/FlowContext';
import { useWorkspace } from '../../context/WorkspaceContext';

export function WorkspaceToolbar() {
  const { state } = useFlow();
  const { flow } = state;
  const { dagCollapsed, toggleDag } = useWorkspace();
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

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggleDag}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
        >
          {dagCollapsed ? 'Show DAG' : 'Hide DAG'}
        </button>
        <ToolbarButton label="Validate" disabled title="Coming in 5.5" />
        <ToolbarButton label="Export" disabled title="Coming in 5.5" />
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
