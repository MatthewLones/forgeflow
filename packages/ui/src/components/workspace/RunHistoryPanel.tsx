import { useState, useEffect } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { EditorTab } from '../../context/LayoutContext';
import type { RunState } from '@forgeflow/types';
import { api } from '../../lib/api-client';

/* ── Status config ─────────────────────────────────────── */

const STATUS_DOT: Record<string, string> = {
  ready: 'bg-gray-400',
  running: 'bg-blue-500 animate-pulse',
  awaiting_input: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
};

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  running: 'Running',
  awaiting_input: 'Waiting',
  completed: 'Completed',
  failed: 'Failed',
};

/* ── Helpers ───────────────────────────────────────────── */

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDuration(start: string, end?: string): string {
  try {
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    const ms = e - s;
    if (ms < 1000) return '<1s';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60_000)}m`;
  } catch {
    return '-';
  }
}

/* ── Main component ────────────────────────────────────── */

export function RunHistoryPanel(props: IDockviewPanelProps<EditorTab>) {
  const projectId = props.params.projectId;
  const [runs, setRuns] = useState<RunState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.runs.listByProject(projectId)
      .then((data) => {
        setRuns(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load run history');
        setLoading(false);
      });
  }, [projectId]);

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No project selected
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Loading run history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div className="text-sm text-red-500">Failed to load history</div>
        <div className="text-xs text-[var(--color-text-muted)]">{error}</div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No runs yet. Click "Run" to start your first execution.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-white">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Run History
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {runs.length} run{runs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Runs list */}
      <div className="flex-1 overflow-y-auto">
        {runs.map((run) => (
          <RunRow key={run.runId} run={run} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: RunState }) {
  const dotColor = STATUS_DOT[run.status] ?? STATUS_DOT.ready;
  const label = STATUS_LABEL[run.status] ?? run.status;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-canvas-bg)] transition-colors">
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />

      {/* Run ID */}
      <span className="text-xs font-mono text-[var(--color-text-primary)] w-16 shrink-0">
        {run.runId.slice(0, 8)}
      </span>

      {/* Status label */}
      <span className="text-[10px] font-medium text-[var(--color-text-secondary)] w-16 shrink-0">
        {label}
      </span>

      {/* Date */}
      <span className="text-[10px] text-[var(--color-text-muted)] w-28 shrink-0">
        {formatDate(run.startedAt)}
      </span>

      {/* Duration */}
      <span className="text-[10px] text-[var(--color-text-muted)] w-10 shrink-0">
        {formatDuration(run.startedAt, run.updatedAt)}
      </span>

      {/* Phases */}
      <span className="text-[10px] text-[var(--color-text-muted)]">
        {run.completedPhases.length} phase{run.completedPhases.length !== 1 ? 's' : ''}
      </span>

      {/* Cost */}
      {run.totalCost.usd > 0 && (
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
          ${run.totalCost.usd.toFixed(2)}
        </span>
      )}
    </div>
  );
}
