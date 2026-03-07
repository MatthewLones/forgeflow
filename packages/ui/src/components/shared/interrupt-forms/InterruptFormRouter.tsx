import { useState, useEffect } from 'react';
import type { Interrupt, InterruptAnswer } from '@forgeflow/types';
import { ApprovalForm } from './ApprovalForm';
import { QAForm } from './QAForm';
import { SelectionForm } from './SelectionForm';
import { ReviewForm } from './ReviewForm';
import { EscalationForm } from './EscalationForm';
import { ArtifactViewer } from '../ArtifactViewer';
import { api } from '../../../lib/api-client';

interface InterruptFormRouterProps {
  interrupt: Interrupt;
  onSubmit: (answer: InterruptAnswer) => Promise<void>;
  /** Run ID needed for ReviewForm to fetch draft content */
  runId?: string;
  /** Compact mode for inline workspace banner */
  compact?: boolean;
}

export function InterruptFormRouter({ interrupt, onSubmit, runId }: InterruptFormRouterProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (answer: InterruptAnswer) => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Attachments — files presented alongside any interrupt form */}
      {interrupt.attachments && interrupt.attachments.length > 0 && runId && (
        <InterruptAttachments attachments={interrupt.attachments} runId={runId} />
      )}

      {interrupt.type === 'approval' && (
        <ApprovalForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
      )}
      {interrupt.type === 'qa' && (
        <QAForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
      )}
      {interrupt.type === 'selection' && (
        <SelectionForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
      )}
      {interrupt.type === 'review' && (
        <ReviewForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} runId={runId} />
      )}
      {interrupt.type === 'escalation' && (
        <EscalationForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
      )}

      {error && (
        <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

/* ── Interrupt Attachments ────────────────────────── */

const BINARY_FORMATS = new Set(['pdf', 'image', 'binary']);

function InterruptAttachments({
  attachments,
  runId,
}: {
  attachments: NonNullable<Interrupt['attachments']>;
  runId: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([attachments[0]?.fileName]));
  const [contents, setContents] = useState<Record<string, { text?: string; loading: boolean; error?: string }>>({});

  useEffect(() => {
    for (const att of attachments) {
      if (BINARY_FORMATS.has(att.format ?? '')) continue; // binary uses URL, no text fetch
      if (contents[att.fileName]) continue;

      setContents((prev) => ({ ...prev, [att.fileName]: { loading: true } }));
      api.runs.getOutputResponse(runId, att.fileName)
        .then(({ text }) => {
          setContents((prev) => ({ ...prev, [att.fileName]: { text, loading: false } }));
        })
        .catch((err) => {
          setContents((prev) => ({
            ...prev,
            [att.fileName]: { loading: false, error: err instanceof Error ? err.message : 'Failed to load' },
          }));
        });
    }
  }, [attachments, runId]);

  return (
    <div className="mb-3 border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-[var(--color-canvas-bg)]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Attachments
        </span>
      </div>
      <div className="divide-y divide-[var(--color-border)]/40">
        {attachments.map((att) => {
          const isExpanded = expanded.has(att.fileName);
          const isBinary = BINARY_FORMATS.has(att.format ?? '');
          const fileUrl = api.runs.getOutputFileUrl(runId, att.fileName);
          const state = contents[att.fileName];

          return (
            <div key={att.fileName}>
              <button
                type="button"
                onClick={() => setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(att.fileName)) next.delete(att.fileName);
                  else next.add(att.fileName);
                  return next;
                })}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-canvas-bg)]/50 transition-colors"
              >
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </span>
                <span className="text-[11px] font-mono font-medium text-[var(--color-text-primary)] flex-1 text-left truncate">
                  {att.label ?? att.fileName}
                </span>
                {att.format && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-canvas-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                    {att.format}
                  </span>
                )}
              </button>
              {isExpanded && (
                <div className="px-3 pb-2">
                  {state?.loading && (
                    <div className="py-2 text-[10px] text-[var(--color-text-muted)] italic">Loading...</div>
                  )}
                  {state?.error && (
                    <div className="text-[11px] text-red-500 py-1">{state.error}</div>
                  )}
                  {(!state?.loading || isBinary) && (
                    <ArtifactViewer
                      content={isBinary ? undefined : state?.text}
                      fileUrl={fileUrl}
                      fileName={att.fileName}
                      format={att.format}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
