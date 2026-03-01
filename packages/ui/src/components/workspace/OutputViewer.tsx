import { useState, useEffect, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { EditorTab } from '../../context/LayoutContext';
import { api } from '../../lib/api-client';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';

/* ── Main component ──────────────────────────────────────── */

export function OutputViewer(props: IDockviewPanelProps<EditorTab>) {
  const { runId, outputFileName } = props.params;
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!runId || !outputFileName) return;

    setLoading(true);
    setError(null);
    api.runs.getOutputText(runId, outputFileName)
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load file');
        setLoading(false);
      });
  }, [runId, outputFileName]);

  useEffect(() => {
    if (!editorRef.current || content === null || !outputFileName) return;

    // Clean up previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
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
  }, [content, outputFileName]);

  if (!runId || !outputFileName) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No output file selected
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Loading {outputFileName}...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div className="text-sm text-red-500">Failed to load file</div>
        <div className="text-xs text-[var(--color-text-muted)]">{error}</div>
      </div>
    );
  }

  const downloadUrl = api.runs.getOutputFileUrl(runId, outputFileName);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-white">
        <span className="text-xs font-mono text-[var(--color-text-primary)] truncate">
          {outputFileName}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Run: {runId.slice(0, 8)}
        </span>
        <a
          href={downloadUrl}
          download={outputFileName}
          className="ml-auto text-[10px] font-medium px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
        >
          Download
        </a>
      </div>

      {/* Editor */}
      <div ref={editorRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
