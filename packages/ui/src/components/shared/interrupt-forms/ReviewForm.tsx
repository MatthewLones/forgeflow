import { useState, useEffect } from 'react';
import type { ReviewInterrupt, ReviewAnswer, ArtifactSchema } from '@forgeflow/types';
import { api } from '../../../lib/api-client';
import { ArtifactViewer } from '../ArtifactViewer';
import { Md } from './MarkdownInline';
import { inputClass, btnPrimary, btnSecondary } from './styles';

export function ReviewForm({ interrupt, onSubmit, disabled, runId }: {
  interrupt: ReviewInterrupt;
  onSubmit: (answer: ReviewAnswer) => void;
  disabled: boolean;
  /** Run ID needed to fetch the draft file content */
  runId?: string;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [editedContent, setEditedContent] = useState('');
  const [draftContent, setDraftContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch draft file content if runId is provided
  useEffect(() => {
    if (!runId || !interrupt.draftFile) return;
    let cancelled = false;
    setLoading(true);
    api.runs.getOutputText(runId, interrupt.draftFile)
      .then((text) => {
        if (!cancelled) {
          setDraftContent(text);
          setEditedContent(text);
        }
      })
      .catch(() => {
        if (!cancelled) setDraftContent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [runId, interrupt.draftFile]);

  return (
    <div className="space-y-4">
      {/* Instructions */}
      <div className="text-sm text-[var(--color-text-primary)] leading-relaxed">
        <Md text={interrupt.instructions} />
      </div>

      {/* Draft file info */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-[var(--color-text-primary)] bg-white border border-[var(--color-border)] rounded px-2 py-1">
          {interrupt.draftFile}
        </span>
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
          {interrupt.format}
        </span>
      </div>

      {/* View/Edit toggle */}
      <div className="flex items-center gap-1 bg-[var(--color-canvas-bg)] rounded-lg p-0.5 w-fit">
        <button
          type="button"
          onClick={() => setMode('view')}
          className={`text-xs px-3 py-1 rounded-md transition-colors ${
            mode === 'view'
              ? 'bg-white text-[var(--color-text-primary)] shadow-sm font-medium'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          View
        </button>
        <button
          type="button"
          onClick={() => setMode('edit')}
          className={`text-xs px-3 py-1 rounded-md transition-colors ${
            mode === 'edit'
              ? 'bg-white text-[var(--color-text-primary)] shadow-sm font-medium'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          Edit
        </button>
      </div>

      {/* Content area */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--color-text-muted)]">
            Loading draft...
          </div>
        ) : mode === 'view' ? (
          <div className="max-h-[50vh] overflow-y-auto">
            {draftContent != null ? (
              <ArtifactViewer content={draftContent} fileName={interrupt.draftFile} schema={{ format: interrupt.format } as ArtifactSchema} />
            ) : (
              <div className="p-4 text-sm text-[var(--color-text-muted)]">
                Draft file not available for preview
              </div>
            )}
          </div>
        ) : (
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className={`${inputClass} font-mono min-h-[30vh] rounded-none border-0`}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSubmit({ accepted: true })}
          disabled={disabled}
          className={btnPrimary}
        >
          Accept
        </button>
        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => onSubmit({ accepted: false, editedContent })}
            disabled={disabled || !editedContent.trim()}
            className={btnSecondary}
          >
            Submit Edits
          </button>
        )}
      </div>
    </div>
  );
}
