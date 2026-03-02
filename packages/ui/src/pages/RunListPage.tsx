import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api-client';
import type { RunState } from '@forgeflow/types';

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  starting: 'bg-blue-100 text-blue-800',
  awaiting_input: 'bg-amber-100 text-amber-800',
  idle: 'bg-gray-100 text-gray-600',
};

export function RunListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    api.runs
      .listByProject(projectId)
      .then(setRuns)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  if (!projectId) return null;

  return (
    <div className="h-screen flex flex-col bg-[var(--color-canvas-bg)]">
      {/* Toolbar */}
      <div className="h-10 px-4 flex items-center gap-4 border-b border-[var(--color-border)] bg-white shrink-0">
        <button
          type="button"
          onClick={() => navigate(`/workspace/${projectId}`)}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Back to IDE
        </button>
        <span className="text-sm text-[var(--color-text-muted)]">/</span>
        <span className="text-sm font-medium">Run History</span>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/runs/new`)}
            className="text-xs font-medium px-3 py-1.5 rounded-md border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            New Run
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-sm text-[var(--color-text-muted)] text-center py-12">
            Loading runs...
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--color-text-muted)] mb-4">No runs yet</p>
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/runs/new`)}
              className="text-xs font-medium px-4 py-2 rounded-md border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              Start a Run
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-2">
            {runs.map((run) => (
              <button
                key={run.runId}
                type="button"
                onClick={() => navigate(`/projects/${projectId}/runs/${run.runId}`)}
                className="w-full text-left p-4 rounded-lg border border-[var(--color-border)] bg-white hover:border-[var(--color-node-agent)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      STATUS_COLORS[run.status] ?? STATUS_COLORS.idle
                    }`}
                  >
                    {run.status}
                  </span>
                  <span className="text-xs font-mono text-[var(--color-text-muted)]">
                    {run.runId.slice(0, 8)}
                  </span>
                  {run.startedAt && (
                    <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                {run.currentNodeId && (
                  <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Phase: {run.currentNodeId}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
