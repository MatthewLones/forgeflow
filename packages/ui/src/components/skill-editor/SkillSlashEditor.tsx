import { useEffect, useRef, useMemo } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  autocompletion,
  acceptCompletion,
} from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { createSkillSlashAutocomplete } from './slash-commands/skill-slash-autocomplete';
import { skillBlockDecorationPlugin } from './slash-commands/skill-block-decoration';

interface SkillSlashEditorProps {
  content: string;
  onChange: (content: string) => void;
}

/** Split YAML frontmatter from body. Returns { frontmatter, body, reconstruct }. */
function splitFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: '', body: content };
  }
  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: '', body: content };
  }
  const fmEnd = endIndex + 4; // past the closing ---
  const frontmatter = trimmed.slice(0, fmEnd);
  const body = trimmed.slice(fmEnd).replace(/^\n/, ''); // strip one leading newline
  return { frontmatter, body };
}

/**
 * Structured skill editor with slash command support and widget decorations.
 *
 * - Strips YAML frontmatter and only shows the body for editing
 * - `/output`, `/input`, `/decision`, `/guardrail` trigger autocomplete
 * - Forgeflow fenced blocks render as interactive widgets
 * - Regular markdown editing between blocks
 *
 * Use `key={filePath}` to remount when switching files.
 */
export function SkillSlashEditor({ content, onChange }: SkillSlashEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  // Capture the frontmatter at mount time so we can reconstruct on changes
  const frontmatterRef = useRef('');

  onChangeRef.current = onChange;

  const { frontmatter, body } = useMemo(() => splitFrontmatter(content), [content]);
  frontmatterRef.current = frontmatter;

  useEffect(() => {
    if (!containerRef.current) return;

    const theme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
        lineHeight: '1.7',
      },
      '.cm-content': {
        padding: '16px 0',
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
      // Autocomplete dropdown styling
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
      // Error indicator for invalid JSON blocks
      '.cm-skill-block-error': {
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
        borderLeft: '3px solid #ef4444',
      },
    });

    const slashComplete = createSkillSlashAutocomplete();

    const state = EditorState.create({
      doc: body,
      extensions: [
        history(),
        // Tab to accept completion at highest priority so markdown() can't intercept
        Prec.highest(keymap.of([
          { key: 'Tab', run: acceptCompletion },
        ])),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        autocompletion({
          override: [slashComplete],
          activateOnTyping: true,
          selectOnOpen: true,
          // defaultKeymap: true registers Enter→acceptCompletion at Prec.highest
          defaultKeymap: true,
        }),
        markdown(),
        skillBlockDecorationPlugin,
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newBody = update.state.doc.toString();
            // Reconstruct full content with frontmatter
            const fm = frontmatterRef.current;
            const full = fm ? fm + '\n' + newBody : newBody;
            onChangeRef.current(full);
          }
        }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': 'Skill editor with slash commands',
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- content is initial-only

  return <div ref={containerRef} className="h-full overflow-hidden" />;
}
