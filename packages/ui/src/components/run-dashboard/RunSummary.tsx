import { useState, useEffect } from 'react';
import { api } from '../../lib/api-client';

interface Summary {
  runId: string;
  status: string;
  duration: { startedAt: string; completedAt: string };
  cost: { turns: number; usd: number };
  phases: Array<{
    nodeId: string;
    nodeName: string;
    cost: number;
    outputFiles: string[];
    missingOutputs: string[];
    toolCallCount: number;
    textBlockCount: number;
  }>;
  artifacts: Array<{ name: string; size: number; producedBy: string }>;
  errors: string[];
  interrupts: Array<{ id: string; type: string; nodeId: string; escalated: boolean }>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function RunSummary({
  runId,
  onArtifactClick,
}: {
  runId: string;
  onArtifactClick: (fileName: string) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.runs.getSummary(runId)
      .then((s) => setSummary(s as Summary))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load summary'))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return <div className="p-4 text-xs text-[var(--color-text-muted)] italic">Loading summary...</div>;
  }

  if (error || !summary) {
    return <div className="p-4 text-xs text-red-500">{error ?? 'No summary available'}</div>;
  }

  const isSuccess = summary.status === 'completed';
  const duration = formatDuration(summary.duration.startedAt, summary.duration.completedAt);

  return (
    <div className="overflow-y-auto p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${isSuccess ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
          {isSuccess ? 'Run Completed' : 'Run Failed'}
        </h2>
        <span className="text-xs text-[var(--color-text-muted)]">{duration}</span>
        <div className="ml-auto flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
          <span>${summary.cost.usd.toFixed(2)}</span>
          <span>{summary.cost.turns} turns</span>
        </div>
      </div>

      {/* Errors */}
      {summary.errors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-red-600 mb-1.5">Errors</h3>
          {summary.errors.map((err, i) => (
            <p key={i} className="text-xs text-red-700">{err}</p>
          ))}
        </div>
      )}

      {/* Phase Timeline */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Phases</h3>
        <div className="space-y-1.5">
          {summary.phases.map((phase) => {
            const hasMissing = phase.missingOutputs.length > 0;
            return (
              <div key={phase.nodeId} className="flex items-center gap-2 p-2 rounded bg-gray-50 border border-gray-100">
                <div className={`w-1.5 h-8 rounded-full ${hasMissing ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[var(--color-text-primary)]">{phase.nodeName}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {phase.outputFiles.length} outputs
                    {phase.toolCallCount > 0 && <> &middot; {phase.toolCallCount} tool calls</>}
                    {phase.textBlockCount > 0 && <> &middot; {phase.textBlockCount} text blocks</>}
                  </div>
                </div>
                <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                  ${phase.cost.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Artifacts */}
      {summary.artifacts.length > 0 && (
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Artifacts</h3>
          <div className="space-y-0.5">
            {summary.artifacts.map((artifact) => (
              <button
                key={artifact.name}
                type="button"
                onClick={() => onArtifactClick(artifact.name)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-blue-50 text-left group"
              >
                <span className="text-[10px] text-[var(--color-text-muted)]">{'\u25A1'}</span>
                <span className="text-xs text-[var(--color-text-primary)] group-hover:text-blue-600 truncate flex-1">
                  {artifact.name}
                </span>
                <span className="text-[10px] text-[var(--color-text-muted)]">{formatSize(artifact.size)}</span>
                <span className="text-[9px] text-[var(--color-text-muted)]">by {artifact.producedBy}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Interrupts */}
      {summary.interrupts.length > 0 && (
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Interrupts</h3>
          <div className="space-y-1">
            {summary.interrupts.map((int) => (
              <div key={int.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                <span className={`text-[10px] ${int.escalated ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {int.escalated ? '\u26A0' : '\u2713'}
                </span>
                <span className="text-[var(--color-text-primary)]">{int.type}</span>
                <span className="text-[var(--color-text-muted)]">on {int.nodeId}</span>
                {int.escalated && <span className="text-amber-500 text-[10px]">escalated</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
