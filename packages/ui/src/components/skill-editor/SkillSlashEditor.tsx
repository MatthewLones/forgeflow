import { useEffect, useRef, useMemo } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  autocompletion,
  acceptCompletion,
} from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { createSkillSlashAutocomplete, type SkillSlashOptions } from './slash-commands/skill-slash-autocomplete';
import { skillBlockDecorationPlugin } from './slash-commands/skill-block-decoration';
import { skillChipDecorationPlugin, SKILL_CHIP_PATTERNS } from './slash-commands/skill-chip-decoration';
import { markdownDecorationPlugin } from '../shared/markdown-decoration';

interface SkillSlashEditorProps {
  content: string;
  onChange: (content: string) => void;
  skills?: string[];
  files?: string[];
  currentSkill?: string;
  onCreateSkill?: (name: string) => void;
  onClickSkill?: (name: string) => void;
  onClickFile?: (path: string) => void;
}

/**
 * Custom backspace handler that deletes an entire chip if the cursor is
 * positioned at the end of one (//skill:NAME or @file).
 */
function chipBackspace(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const pos = range.head;
  const line = state.doc.lineAt(pos);
  const textBefore = state.doc.sliceString(line.from, pos);

  for (const { regex } of SKILL_CHIP_PATTERNS) {
    const r = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = r.exec(textBefore)) !== null) {
      const chipStart = line.from + match.index;
      const chipEnd = line.from + match.index + match[0].length;
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
 * - `/output`, `/input`, `/decision`, `/guardrail` trigger block autocomplete
 * - `//` triggers sub-skill autocomplete (inserts `//skill:NAME`)
 * - `@` triggers file reference autocomplete (inserts `@path/to/file.md`)
 * - Forgeflow fenced blocks render as interactive widgets
 * - Regular markdown editing between blocks
 *
 * Use `key={filePath}` to remount when switching files.
 */
/** Chip click patterns for the skill editor */
const SKILL_CHIP_CLICK_MAP: { className: string; regex: RegExp; type: 'skill' | 'file' }[] = [
  { className: 'cm-chip-subskill', regex: /\/\/?skill:([\w-]+)/g, type: 'skill' },
  { className: 'cm-chip-fileref', regex: /@([\w./-]+\.\w+)/g, type: 'file' },
];

export function SkillSlashEditor({
  content,
  onChange,
  skills = [],
  files = [],
  currentSkill = '',
  onCreateSkill,
  onClickSkill,
  onClickFile,
}: SkillSlashEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCreateSkillRef = useRef(onCreateSkill);
  const onClickSkillRef = useRef(onClickSkill);
  const onClickFileRef = useRef(onClickFile);
  // Capture the frontmatter at mount time so we can reconstruct on changes
  const frontmatterRef = useRef('');

  onChangeRef.current = onChange;
  onCreateSkillRef.current = onCreateSkill;
  onClickSkillRef.current = onClickSkill;
  onClickFileRef.current = onClickFile;

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
      // Chip styles for sub-skills and file references
      '.cm-chip': {
        padding: '1px 6px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: '500',
        cursor: 'pointer',
      },
      '.cm-chip-subskill': {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        color: '#059669',
      },
      '.cm-chip-fileref': {
        backgroundColor: 'rgba(245, 158, 11, 0.12)',
        color: '#d97706',
      },
      '.cm-chip-interrupt': {
        backgroundColor: 'rgba(239, 68, 68, 0.12)',
        color: '#dc2626',
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

    const slashOpts: SkillSlashOptions = {
      skills,
      files,
      currentSkill,
      onCreateSkill: (name: string) => onCreateSkillRef.current?.(name),
    };
    const slashComplete = createSkillSlashAutocomplete(slashOpts);

    const state = EditorState.create({
      doc: body,
      extensions: [
        history(),
        // Tab to accept completion at highest priority so markdown() can't intercept
        Prec.highest(keymap.of([
          { key: 'Tab', run: acceptCompletion },
        ])),
        keymap.of([
          { key: 'Backspace', run: chipBackspace },
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
        markdownDecorationPlugin,
        skillBlockDecorationPlugin,
        skillChipDecorationPlugin,
        EditorView.domEventHandlers({
          click(event: MouseEvent, view: EditorView) {
            const target = event.target as HTMLElement;
            if (!target?.classList?.contains('cm-chip')) return false;

            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;

            const line = view.state.doc.lineAt(pos);
            const lineText = line.text;

            for (const { className, regex, type } of SKILL_CHIP_CLICK_MAP) {
              if (!target.classList.contains(className)) continue;
              const re = new RegExp(regex.source, regex.flags);
              let match: RegExpExecArray | null;
              while ((match = re.exec(lineText)) !== null) {
                const chipFrom = line.from + match.index;
                const chipTo = chipFrom + match[0].length;
                if (pos >= chipFrom && pos <= chipTo) {
                  const name = match[1];
                  if (type === 'skill') onClickSkillRef.current?.(name);
                  else if (type === 'file') onClickFileRef.current?.(name);
                  return true;
                }
              }
            }
            return false;
          },
        }),
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
