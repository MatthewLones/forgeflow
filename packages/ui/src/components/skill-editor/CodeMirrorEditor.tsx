import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';

interface CodeMirrorEditorProps {
  content: string;
  onChange: (content: string) => void;
}

/**
 * CodeMirror 6 editor wrapper.
 *
 * Use `key={filePath}` on this component to force remount when switching files.
 * This avoids complex content-swap logic and gives each file a clean editor state.
 */
export function CodeMirrorEditor({ content, onChange }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  // Keep onChange ref current without recreating the editor
  onChangeRef.current = onChange;

  // Create editor on mount, destroy on unmount
  useEffect(() => {
    if (!containerRef.current) return;

    const theme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: '1.6',
      },
      '.cm-content': {
        padding: '16px 0',
        caretColor: 'var(--color-node-agent)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--color-node-agent)',
      },
      '.cm-gutters': {
        borderRight: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-canvas-bg)',
        color: 'var(--color-text-muted)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--color-text-secondary)',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--color-node-agent-bg)',
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'rgba(59, 130, 246, 0.15) !important',
      },
      '.cm-line': {
        padding: '0 16px',
      },
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- content is intentionally initial-only

  return <div ref={containerRef} className="h-full overflow-hidden" />;
}
