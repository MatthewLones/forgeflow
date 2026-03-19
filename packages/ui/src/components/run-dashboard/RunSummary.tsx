import { useState, useEffect, useMemo } from 'react';
import type { ProgressEvent } from '@forgeflow/types';
import { api } from '../../lib/api-client';
import { EventStream } from './EventStream';
import { TodoWidget } from '../shared/TodoWidget';
import { ArtifactViewer } from '../shared/ArtifactViewer';
import { derivePhaseTodos } from '../../lib/derive-phase-todos';

/* ── Types ───────────────────────────────────────────── */

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
  artifacts: Array<{ name: string; size: number; format?: string; producedBy: string }>;
  errors: string[];
  interrupts: Array<{ id: string; type: string; nodeId: string; escalated: boolean }>;
  events: ProgressEvent[];
  workspace: Array<{
    phaseId: string;
    files: Array<{ path: string; size: number }>;
  }>;
}

/* ── Helpers ─────────────────────────────────────────── */

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

function formatIcon(format?: string): string {
  switch (format) {
    case 'json': return '{}';
    case 'csv': return '\u2637';
    case 'pdf': return '\u25A3';
    case 'markdown': return '#';
    case 'image': return '\u25A3';
    default: return '\u25A1';
  }
}

/* ── Collapsible Section ─────────────────────────────── */

function SummarySection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className={`text-[10px] text-[var(--color-text-muted)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>
          &#9654;
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          {title}
        </span>
        {count != null && (
          <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
            ({count})
          </span>
        )}
      </button>
      {open && <div className="border-t border-[var(--color-border)]">{children}</div>}
    </div>
  );
}

/* ── Inline Artifact Preview ─────────────────────────── */

const BINARY_FORMATS = new Set(['pdf', 'image', 'binary']);

function InlineArtifactPreview({ runId, artifact }: {
  runId: string;
  artifact: { name: string; format?: string };
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isBinary = BINARY_FORMATS.has(artifact.format ?? '');
  const fileUrl = api.runs.getOutputFileUrl(runId, artifact.name);

  useEffect(() => {
    if (isBinary) {
      setLoading(false);
      return;
    }
    api.runs.getOutputResponse(runId, artifact.name)
      .then(({ text }) => setContent(text))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [runId, artifact.name, isBinary]);

  if (loading) {
    return <div className="p-3 text-[10px] text-[var(--color-text-muted)] italic">Loading...</div>;
  }

  if (error) {
    return <div className="p-3 text-[11px] text-red-500">{error}</div>;
  }

  return (
    <div className="p-3 border-t border-[var(--color-border)] bg-white max-h-[400px] overflow-y-auto">
      <ArtifactViewer
        content={isBinary ? undefined : (content ?? undefined)}
        fileUrl={fileUrl}
        fileName={artifact.name}
        format={artifact.format}
      />
    </div>
  );
}

/* ── RunSummary ──────────────────────────────────────── */

export function RunSummary({
  runId,
  onArtifactClick,
  onFileClick,
}: {
  runId: string;
  onArtifactClick: (fileName: string) => void;
  onFileClick?: (fileName: string, phaseId?: string) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.runs.getSummary(runId)
      .then((s) => setSummary(s as Summary))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load summary'))
      .finally(() => setLoading(false));
  }, [runId]);

  const phaseTodos = useMemo(
    () => (summary?.events ? derivePhaseTodos(summary.events) : []),
    [summary?.events],
  );

  if (loading) {
    return <div className="p-4 text-xs text-[var(--color-text-muted)] italic">Loading summary...</div>;
  }

  if (error || !summary) {
    return <div className="p-4 text-xs text-red-500">{error ?? 'No summary available'}</div>;
  }

  const isSuccess = summary.status === 'completed';
  const duration = formatDuration(summary.duration.startedAt, summary.duration.completedAt);
  const totalWorkspaceFiles = summary.workspace.reduce((sum, p) => sum + p.files.length, 0);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
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

      {/* Tasks — always open */}
      {phaseTodos.length > 0 && (
        <SummarySection title="Tasks" count={phaseTodos.length} defaultOpen>
          <div className="p-3">
            <TodoWidget todos={phaseTodos} isActive={false} />
          </div>
        </SummarySection>
      )}

      {/* Outputs / Artifacts — always open */}
      {summary.artifacts.length > 0 && (
        <SummarySection title="Outputs" count={summary.artifacts.length} defaultOpen>
          <div className="divide-y divide-[var(--color-border)]/40">
            {summary.artifacts.map((artifact) => {
              const isExpanded = expandedArtifact === artifact.name;
              return (
                <div key={artifact.name}>
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => setExpandedArtifact(isExpanded ? null : artifact.name)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-blue-50 rounded px-1 py-0.5 -mx-1 group"
                    >
                      <span className={`text-[10px] text-[var(--color-text-muted)] transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>
                        &#9654;
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">{formatIcon(artifact.format)}</span>
                      <span className="text-xs text-[var(--color-text-primary)] group-hover:text-blue-600 truncate flex-1">
                        {artifact.name}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{formatSize(artifact.size)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onArtifactClick(artifact.name)}
                      className="text-[9px] text-[var(--color-text-muted)] hover:text-blue-600 shrink-0 px-1.5 py-0.5 rounded border border-[var(--color-border)] hover:border-blue-300"
                      title="Open in drawer"
                    >
                      Drawer
                    </button>
                    <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">by {artifact.producedBy}</span>
                  </div>
                  {isExpanded && (
                    <InlineArtifactPreview runId={runId} artifact={artifact} />
                  )}
                </div>
              );
            })}
          </div>
        </SummarySection>
      )}

      {/* Phase Timeline */}
      <SummarySection title="Phases" count={summary.phases.length} defaultOpen>
        <div className="p-3 space-y-1.5">
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
      </SummarySection>

      {/* Event Timeline — collapsed by default */}
      {summary.events.length > 0 && (
        <SummarySection title="Event Timeline" count={summary.events.length}>
          <div className="h-[400px]">
            <EventStream
              events={summary.events}
              nodeFilter={null}
              isDone
              onNodeClick={() => {}}
              onFileClick={(fileName, nodeId) => onFileClick?.(fileName, nodeId)}
            />
          </div>
        </SummarySection>
      )}

      {/* Workspace Files — collapsed by default */}
      {summary.workspace.length > 0 && totalWorkspaceFiles > 0 && (
        <SummarySection title="Workspace Files" count={totalWorkspaceFiles}>
          <div className="p-3 space-y-3">
            {summary.workspace.map((phase) => (
              <WorkspacePhaseTree
                key={phase.phaseId}
                phase={phase}
                runId={runId}
                onFileClick={onFileClick}
              />
            ))}
          </div>
        </SummarySection>
      )}

      {/* Interrupts — collapsed by default */}
      {summary.interrupts.length > 0 && (
        <SummarySection title="Interrupts" count={summary.interrupts.length}>
          <div className="p-3 space-y-1">
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
        </SummarySection>
      )}
    </div>
  );
}

/* ── Workspace Phase Tree ────────────────────────────── */

function WorkspacePhaseTree({
  phase,
  runId,
  onFileClick,
}: {
  phase: { phaseId: string; files: Array<{ path: string; size: number }> };
  runId: string;
  onFileClick?: (fileName: string, phaseId?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (phase.files.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-left w-full hover:bg-gray-50 rounded px-1 py-0.5"
      >
        <span className={`text-[10px] text-[var(--color-text-muted)] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>
          &#9654;
        </span>
        <span className="text-[11px] font-medium text-[var(--color-text-primary)]">{phase.phaseId}</span>
        <span className="text-[10px] text-[var(--color-text-muted)]">{phase.files.length} files</span>
      </button>
      {expanded && (
        <div className="pl-5 mt-0.5 space-y-0.5">
          {phase.files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onFileClick?.(file.path, phase.phaseId)}
              className="flex items-center gap-2 w-full text-left px-1.5 py-0.5 rounded hover:bg-blue-50 group"
            >
              <span className="text-[10px] text-[var(--color-text-muted)]">\u25A1</span>
              <span className="text-[11px] font-mono text-[var(--color-text-primary)] group-hover:text-blue-600 truncate flex-1">
                {file.path}
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{formatSize(file.size)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
