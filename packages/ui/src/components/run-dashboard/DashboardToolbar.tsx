import { useNavigate } from 'react-router-dom';
import type { NodeRunStatus } from '../../context/RunContext';

const STATUS_CONFIG = {
  idle: { label: 'Idle', color: 'bg-gray-400', text: 'text-gray-600' },
  starting: { label: 'Starting...', color: 'bg-blue-400', text: 'text-blue-600' },
  running: { label: 'Running', color: 'bg-blue-500 animate-pulse', text: 'text-blue-600' },
  awaiting_input: { label: 'Awaiting Input', color: 'bg-amber-500', text: 'text-amber-600' },
  completed: { label: 'Completed', color: 'bg-emerald-500', text: 'text-emerald-600' },
  failed: { label: 'Failed', color: 'bg-red-500', text: 'text-red-600' },
} as const;

export function DashboardToolbar({
  projectId,
  status,
  runId,
  totalCost,
  reconnecting,
  onStop,
  onRerun,
  interruptCount = 0,
  onInterrupts,
  checkpointCount = 0,
  onCheckpoints,
}: {
  projectId: string;
  status: 'idle' | 'starting' | 'running' | 'awaiting_input' | 'completed' | 'failed';
  runId: string | null;
  totalCost: { turns: number; usd: number };
  reconnecting: boolean;
  onStop: () => void;
  onRerun: () => void;
  interruptCount?: number;
  onInterrupts?: () => void;
  checkpointCount?: number;
  onCheckpoints?: () => void;
}) {
  const navigate = useNavigate();
  const config = STATUS_CONFIG[status];
  const isRunning = status === 'running' || status === 'starting';
  const canStop = isRunning || status === 'awaiting_input';
  const isDone = status === 'completed' || status === 'failed';

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => navigate(`/workspace/${projectId}`)}
        className="text-xs font-medium text-[var(--color-node-agent)] hover:text-blue-700 flex items-center gap-1"
      >
        <span>&larr;</span>
        <span>IDE</span>
      </button>

      <div className="w-px h-4 bg-[var(--color-border)]" />

      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${config.color}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${config.text}`}>
          {config.label}
        </span>
      </div>

      {reconnecting && (
        <span className="text-[10px] font-medium text-amber-500 animate-pulse">
          Reconnecting...
        </span>
      )}

      {runId && (
        <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
          {runId.slice(0, 8)}
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        {totalCost.usd > 0 && (
          <span className="text-xs text-[var(--color-text-secondary)]">
            $<span className="font-medium text-[var(--color-text-primary)]">{totalCost.usd.toFixed(2)}</span>
          </span>
        )}
        {totalCost.turns > 0 && (
          <span className="text-xs text-[var(--color-text-secondary)]">
            <span className="font-medium text-[var(--color-text-primary)]">{totalCost.turns}</span> turns
          </span>
        )}

        {onCheckpoints && checkpointCount > 0 && (
          <button
            type="button"
            onClick={onCheckpoints}
            className="text-[10px] px-3 py-1 rounded border border-amber-200 text-amber-700 hover:bg-amber-50 font-medium flex items-center gap-1.5"
          >
            Checkpoints
            <span className="text-[9px] px-1 rounded-full bg-amber-100 text-amber-600 font-mono">
              {checkpointCount}
            </span>
          </button>
        )}

        {onInterrupts && interruptCount > 0 && (
          <button
            type="button"
            onClick={onInterrupts}
            className="text-[10px] px-3 py-1 rounded border border-amber-200 text-amber-700 hover:bg-amber-50 font-medium flex items-center gap-1.5"
          >
            Interrupts
            <span className="text-[9px] px-1 rounded-full bg-amber-100 text-amber-600 font-mono">
              {interruptCount}
            </span>
          </button>
        )}

        {canStop && (
          <button
            type="button"
            onClick={onStop}
            className="text-[10px] px-3 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 font-medium"
          >
            Stop
          </button>
        )}
        {isDone && (
          <button
            type="button"
            onClick={onRerun}
            className="text-[10px] px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-gray-50 font-medium"
          >
            Re-run
          </button>
        )}
      </div>
    </div>
  );
}
