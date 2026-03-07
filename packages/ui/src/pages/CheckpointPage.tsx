import { useParams, useNavigate } from 'react-router-dom';
import { useRun, type CheckpointHistoryEntry } from '../context/RunContext';
import { CheckpointPanel } from '../components/shared/CheckpointPanel';

/* ── CheckpointPage ──────────────────────────────────── */

export function CheckpointPage() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const navigate = useNavigate();
  const { run, pendingCheckpoint, checkpointHistory } = useRun();

  const isLive = run.status === 'running' || run.status === 'starting' || run.status === 'awaiting_input';

  return (
    <div className="h-screen flex flex-col bg-[var(--color-canvas-bg)]">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-white border-b border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => navigate(`/projects/${projectId}/runs/${runId}`)}
          className="text-xs font-medium text-[var(--color-node-agent)] hover:text-blue-700 flex items-center gap-1"
        >
          <span>&larr;</span>
          <span>Back to Run</span>
        </button>
        <div className="w-px h-4 bg-[var(--color-border)]" />
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          Checkpoints ({checkpointHistory.length + (pendingCheckpoint ? 1 : 0)})
        </span>
        {isLive && (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
          {/* Current pending checkpoint */}
          {pendingCheckpoint && projectId && run.runId ? (
            <div className="rounded-lg border-2 border-amber-300 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-200 bg-amber-50">
                <span className="animate-pulse w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                <span className="text-sm font-semibold text-amber-800">
                  {pendingCheckpoint.checkpoint.presentation?.title ?? pendingCheckpoint.checkpoint.checkpointNodeId}
                </span>
                <span className="text-[10px] font-mono text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
                  checkpoint
                </span>
                {pendingCheckpoint.checkpoint.costSoFar && (
                  <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
                    {pendingCheckpoint.checkpoint.costSoFar.turns} turns &middot; ${pendingCheckpoint.checkpoint.costSoFar.usd.toFixed(2)}
                  </span>
                )}
              </div>
              <CheckpointPanel
                projectId={projectId}
                checkpoint={pendingCheckpoint.checkpoint}
                runId={run.runId}
                className="overflow-y-auto"
                hideHeader
              />
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center">
              <div className="text-sm text-[var(--color-text-muted)]">
                {checkpointHistory.length === 0
                  ? 'No checkpoints yet'
                  : 'No active checkpoint'}
              </div>
              {isLive && checkpointHistory.length === 0 && (
                <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
                  Checkpoints will appear here when the flow pauses for your input.
                </div>
              )}
            </div>
          )}

          {/* History */}
          {checkpointHistory.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                History
              </h3>
              {[...checkpointHistory].reverse().map((entry, i) => (
                <CheckpointHistoryCard
                  key={entry.checkpoint.checkpointNodeId}
                  entry={entry}
                  index={checkpointHistory.length - i}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── History card ─────────────────────────────────────── */

function CheckpointHistoryCard({ entry, index }: { entry: CheckpointHistoryEntry; index: number }) {
  const title = entry.checkpoint.presentation?.title ?? entry.checkpoint.checkpointNodeId;
  const fileNames = entry.answeredFiles?.map((f) => f.fileName) ?? [];

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-[var(--color-border)]">
        <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
          #{index}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
          <circle cx="6" cy="6" r="5" fill="#dcfce7" stroke="#16a34a" strokeWidth="1" />
          <path d="M3.5 6l2 2 3-3.5" fill="none" stroke="#16a34a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">
          checkpoint
        </span>
        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
          {title}
        </span>
      </div>
      <div className="px-4 py-2 text-[var(--color-text-secondary)]">
        {fileNames.length > 0 ? (
          <span className="text-[11px]">
            Provided: <strong>{fileNames.join(', ')}</strong>
          </span>
        ) : (
          <span className="text-[10px] text-[var(--color-text-muted)] italic">Resumed</span>
        )}
      </div>
    </div>
  );
}
