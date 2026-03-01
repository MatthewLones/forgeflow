import { useState, useEffect, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { EditorTab } from '../../context/LayoutContext';
import type { CompilePhase, CompilePreviewResult } from '../../lib/api-client';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';

const NODE_TYPE_GLYPH: Record<string, string> = {
  agent: 'A',
  checkpoint: 'C',
};

export function CompilePreviewPanel(props: IDockviewPanelProps<EditorTab>) {
  const result = props.params.compileResult;

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No compile results
      </div>
    );
  }

  if (!result.valid) {
    return (
      <div className="h-full flex flex-col p-4 gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-red-500">
          Compilation Failed
        </div>
        {result.errors?.map((err, i) => (
          <div key={i} className="text-xs text-[var(--color-text-secondary)] flex items-start gap-2">
            <span className="text-red-500 shrink-0">{'\u25CF'}</span>
            {err.message}
          </div>
        ))}
      </div>
    );
  }

  return <CompilePreviewContent phases={result.phases} />;
}

function CompilePreviewContent({ phases }: { phases: CompilePhase[] }) {
  const [selectedPhaseIdx, setSelectedPhaseIdx] = useState(0);
  const [selectedPromptKey, setSelectedPromptKey] = useState<string | null>(null);

  const phase = phases[selectedPhaseIdx];
  if (!phase) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No phases to display
      </div>
    );
  }

  const childKeys = Object.keys(phase.childPrompts);
  const promptContent = selectedPromptKey
    ? phase.childPrompts[selectedPromptKey]?.markdown ?? ''
    : phase.prompt;

  // Reset child prompt selection when switching phases
  const handlePhaseSelect = (idx: number) => {
    setSelectedPhaseIdx(idx);
    setSelectedPromptKey(null);
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Phase sidebar */}
      <div className="w-48 shrink-0 border-r border-[var(--color-border)] overflow-y-auto bg-[var(--color-canvas-bg)]">
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Phases
        </div>
        {phases.map((p, i) => (
          <button
            key={p.nodeId}
            type="button"
            onClick={() => handlePhaseSelect(i)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
              i === selectedPhaseIdx
                ? 'bg-white text-[var(--color-text-primary)] font-medium'
                : 'text-[var(--color-text-secondary)] hover:bg-white/60'
            }`}
          >
            <span
              className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center shrink-0 ${
                p.nodeType === 'checkpoint'
                  ? 'bg-[var(--color-node-checkpoint)]/15 text-[var(--color-node-checkpoint)]'
                  : 'bg-[var(--color-node-agent)]/15 text-[var(--color-node-agent)]'
              }`}
            >
              {NODE_TYPE_GLYPH[p.nodeType] ?? 'A'}
            </span>
            <span className="truncate">{p.nodeName}</span>
          </button>
        ))}
      </div>

      {/* Prompt viewer */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Child prompt tabs (if any) */}
        {childKeys.length > 0 && (
          <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-[var(--color-border)] bg-white overflow-x-auto">
            <PromptTab
              label="Main Prompt"
              isActive={selectedPromptKey === null}
              onClick={() => setSelectedPromptKey(null)}
            />
            <span className="text-[var(--color-border)] mx-1 shrink-0">|</span>
            {childKeys.map((key) => (
              <PromptTab
                key={key}
                label={key}
                isActive={selectedPromptKey === key}
                onClick={() => setSelectedPromptKey(key)}
              />
            ))}
          </div>
        )}

        {/* Read-only editor */}
        <div className="flex-1 overflow-hidden">
          <ReadOnlyMarkdownEditor key={`${selectedPhaseIdx}-${selectedPromptKey ?? 'main'}`} content={promptContent} />
        </div>
      </div>
    </div>
  );
}

function PromptTab({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] rounded shrink-0 transition-colors ${
        isActive
          ? 'bg-[var(--color-node-agent)]/12 text-[var(--color-node-agent)] font-medium'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
      }`}
    >
      {label}
    </button>
  );
}

function ReadOnlyMarkdownEditor({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const theme = EditorView.theme({
      '&': { height: '100%', fontSize: '13px' },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: '1.6',
      },
      '.cm-content': { padding: '16px 0' },
      '.cm-cursor': { display: 'none !important' },
      '.cm-gutters': {
        borderRight: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-canvas-bg)',
        color: 'var(--color-text-muted)',
      },
      '.cm-line': { padding: '0 16px' },
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        theme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    return () => view.destroy();
  }, [content]);

  return <div ref={containerRef} className="h-full overflow-hidden" />;
}
