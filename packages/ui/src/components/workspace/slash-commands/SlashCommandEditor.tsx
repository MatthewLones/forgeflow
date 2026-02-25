import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  autocompletion,
  acceptCompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import { chipDecorationPlugin, CHIP_PATTERNS } from './chip-decoration';
import { createSlashAutocomplete } from './slash-autocomplete';

/**
 * Custom backspace handler that deletes an entire chip if the cursor is
 * positioned at the end of one.  Falls through to the default backspace
 * when the cursor isn't touching a chip.
 */
function chipBackspace(view: EditorView): boolean {
  const { state } = view;
  // Only handle single-cursor, empty selections
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const pos = range.head;
  // Grab the text of the current line up to the cursor
  const line = state.doc.lineAt(pos);
  const textBefore = state.doc.sliceString(line.from, pos);

  for (const { regex } of CHIP_PATTERNS) {
    // Clone the regex so lastIndex is fresh
    const r = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = r.exec(textBefore)) !== null) {
      const chipStart = line.from + match.index;
      const chipEnd = line.from + match.index + match[0].length;
      // If the cursor is anywhere inside or at the end of this chip, delete the whole chip
      if (chipEnd === pos || (chipStart < pos && pos <= chipEnd)) {
        view.dispatch({
          changes: { from: chipStart, to: chipEnd },
          selection: { anchor: chipStart },
        });
        return true;
      }
    }
  }

  return false;
}

interface SlashCommandEditorProps {
  content: string;
  onChange: (content: string) => void;
  skills: string[];
  agents: string[];
  onCreateAgent?: (name: string) => void;
}

/**
 * Instructions editor with slash command support.
 *
 * - `/skill-name` triggers skill autocomplete, inserts `/skill:name` chip
 * - `//agent-name` triggers agent autocomplete, inserts `//agent:name` chip
 * - `/merge` inserts a merge marker
 *
 * Use `key={nodeId}` to remount when switching nodes.
 */
export function SlashCommandEditor({
  content,
  onChange,
  skills,
  agents,
  onCreateAgent,
}: SlashCommandEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCreateAgentRef = useRef(onCreateAgent);

  onChangeRef.current = onChange;
  onCreateAgentRef.current = onCreateAgent;

  useEffect(() => {
    if (!containerRef.current) return;

    const theme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
      },
      '&.cm-focused': {
        outline: 'none',
        borderColor: 'var(--color-border-selected)',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
        lineHeight: '1.7',
      },
      '.cm-content': {
        padding: '12px 0',
        caretColor: 'var(--color-node-agent)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--color-node-agent)',
      },
      '.cm-gutters': {
        display: 'none',
      },
      '.cm-activeLine': {
        backgroundColor: 'transparent',
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'rgba(59, 130, 246, 0.15) !important',
      },
      '.cm-line': {
        padding: '0 16px',
      },
      // Chip styles
      '.cm-chip': {
        padding: '1px 6px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: '500',
      },
      '.cm-chip-skill': {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        color: '#059669',
      },
      '.cm-chip-agent': {
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        color: '#2563eb',
      },
      '.cm-chip-merge': {
        backgroundColor: 'rgba(245, 158, 11, 0.12)',
        color: '#d97706',
      },
      '.cm-chip-interrupt': {
        backgroundColor: 'rgba(239, 68, 68, 0.12)',
        color: '#dc2626',
      },
      // Autocomplete dropdown
      '.cm-tooltip-autocomplete': {
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete > ul': {
        fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
        fontSize: '12px',
      },
      '.cm-tooltip-autocomplete > ul > li': {
        padding: '4px 10px',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--color-node-agent)',
        color: 'white',
      },
      '.cm-completionLabel': {
        fontWeight: '500',
      },
      '.cm-completionDetail': {
        fontStyle: 'normal',
        opacity: '0.6',
        marginLeft: '8px',
      },
    });

    const slashComplete = createSlashAutocomplete({
      skills,
      agents,
      onCreateAgent: (name) => onCreateAgentRef.current?.(name),
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        history(),
        keymap.of([
          { key: 'Enter', run: acceptCompletion },
          { key: 'Tab', run: acceptCompletion },
          { key: 'Backspace', run: chipBackspace },
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ]),
        autocompletion({
          override: [slashComplete],
          activateOnTyping: true,
          defaultKeymap: false,
        }),
        chipDecorationPlugin,
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const doc = update.state.doc.toString();
            onChangeRef.current(doc);

            // Check if a new //agent: was just created via autocomplete
            // by looking for //agent:name patterns where name is new
            const agentPattern = /\/\/agent:([\w-]+)/g;
            let match: RegExpExecArray | null;
            while ((match = agentPattern.exec(doc)) !== null) {
              const name = match[1];
              if (!agents.includes(name)) {
                onCreateAgentRef.current?.(name);
              }
            }
          }
        }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': 'Agent instructions editor',
        }),
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="h-full overflow-hidden" />;
}
