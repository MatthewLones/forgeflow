import { useState, useEffect, useRef, useCallback } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { EditorTab } from '../../context/LayoutContext';
import { useLayout } from '../../context/LayoutContext';
import { useRun } from '../../context/RunContext';
import { api } from '../../lib/api-client';
import { ArtifactViewer } from '../shared/ArtifactViewer';
import { marked } from 'marked';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';

/* ── Main component ──────────────────────────────────────── */

export function ReviewPanel(props: IDockviewPanelProps<EditorTab>) {
  const { interruptData } = props.params;
  const { answerInterrupt, run } = useRun();
  const { closeTab } = useLayout();

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answered, setAnswered] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const panelId = props.params.id;

  const interrupt = interruptData?.interrupt;
  const runId = interruptData?.runId;

  // Fetch draft file content
  useEffect(() => {
    if (!runId || !interrupt?.draftFile) return;

    setLoading(true);
    setError(null);
    api.runs.getOutputText(runId, interrupt.draftFile)
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load draft file');
        setLoading(false);
      });
  }, [runId, interrupt?.draftFile]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeTab(panelId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeTab, panelId]);

  // Set up CodeMirror editor when entering edit mode
  useEffect(() => {
    if (!editing || !editorRef.current || content === null) return;

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [editing, content]);

  // Detect when interrupt is no longer pending (run moved on)
  useEffect(() => {
    if (answered) return;
    if (!run.pendingInterrupt && run.status !== 'awaiting_input' && run.status !== 'idle') {
      // Run has moved past this interrupt
      setAnswered(true);
    }
  }, [run.pendingInterrupt, run.status, answered]);

  const handleAccept = useCallback(async () => {
    setSubmitting(true);
    try {
      await answerInterrupt({ accepted: true });
      setAnswered(true);
      closeTab(panelId);
    } catch (err) {
      console.error('[ReviewPanel] accept failed:', err);
    } finally {
      setSubmitting(false);
    }
  }, [answerInterrupt, closeTab, panelId]);

  const handleSubmitEdits = useCallback(async () => {
    const editedContent = viewRef.current?.state.doc.toString() ?? '';
    if (!editedContent.trim()) return;
    setSubmitting(true);
    try {
      await answerInterrupt({ accepted: false, editedContent });
      setAnswered(true);
      closeTab(panelId);
    } catch (err) {
      console.error('[ReviewPanel] submit edits failed:', err);
    } finally {
      setSubmitting(false);
    }
  }, [answerInterrupt, closeTab, panelId]);

  if (!interrupt || !runId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No review data available
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Loading draft: {interrupt.draftFile}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div className="text-sm text-red-500">Failed to load draft file</div>
        <div className="text-xs text-[var(--color-text-muted)]">{error}</div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setError(null);
            api.runs.getOutputText(runId, interrupt.draftFile)
              .then((text) => { setContent(text); setLoading(false); })
              .catch((err) => { setError(err instanceof Error ? err.message : 'Failed'); setLoading(false); });
          }}
          className="text-xs font-medium px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (answered) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <span className="text-emerald-500 text-2xl">{'\u2713'}</span>
        <div className="text-sm text-[var(--color-text-secondary)]">Review completed</div>
        <button
          type="button"
          onClick={() => closeTab(panelId)}
          className="text-xs font-medium px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  const instructionsHtml = marked.parse(interrupt.instructions, { async: false }) as string;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-white">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
            {interrupt.title}
          </span>
        </div>
        <span className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-canvas-bg)] px-1.5 py-0.5 rounded">
          {interrupt.draftFile}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {interrupt.format}
        </span>
        <span className="ml-auto text-[10px] font-mono text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
          {interrupt.mode}
        </span>
      </div>

      {/* Instructions */}
      <div className="shrink-0 px-4 py-2 border-b border-[var(--color-border)] bg-amber-50/50">
        <div
          className="prose-skill text-[12px] text-[var(--color-text-secondary)] [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0"
          dangerouslySetInnerHTML={{ __html: instructionsHtml }}
        />
      </div>

      {/* Source path */}
      {interrupt.source.agentPath.length > 0 && (
        <div className="shrink-0 px-4 py-1 text-[10px] text-[var(--color-text-muted)] font-mono border-b border-[var(--color-border)]">
          {interrupt.source.agentPath.join(' / ')}
        </div>
      )}

      {/* View/Edit toggle */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-1.5 border-b border-[var(--color-border)] bg-white">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            !editing
              ? 'bg-[var(--color-node-agent)]/12 text-[var(--color-node-agent)] font-medium'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
          }`}
        >
          View
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            editing
              ? 'bg-[var(--color-node-agent)]/12 text-[var(--color-node-agent)] font-medium'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
          }`}
        >
          Edit
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {!editing ? (
          <div className="h-full overflow-y-auto p-4">
            <ArtifactViewer content={content ?? ''} fileName={interrupt.draftFile} />
          </div>
        ) : (
          <div ref={editorRef} className="h-full overflow-hidden" />
        )}
      </div>

      {/* Action bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-t border-[var(--color-border)] bg-white">
        <button
          type="button"
          onClick={handleAccept}
          disabled={submitting}
          className="text-xs font-medium px-4 py-1.5 rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting...' : 'Accept'}
        </button>
        {editing && (
          <button
            type="button"
            onClick={handleSubmitEdits}
            disabled={submitting}
            className="text-xs font-medium px-4 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Submit Edits
          </button>
        )}
        <button
          type="button"
          onClick={() => closeTab(panelId)}
          className="text-xs font-medium px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
        >
          Close
        </button>
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
          Press Esc to close
        </span>
      </div>
    </div>
  );
}
