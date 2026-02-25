import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { BLOCK_TEMPLATES } from '../../shared/block-widgets/block-templates';

interface SkillBlockOption {
  name: string;
  label: string;
  detail: string;
}

const BLOCK_OPTIONS: SkillBlockOption[] = [
  { name: 'input', label: 'input', detail: 'Input file requirements' },
  { name: 'decision', label: 'decision', detail: 'Decision tree / routing logic' },
  { name: 'guardrail', label: 'guardrail', detail: 'Do / Don\'t rules' },
];

const INTERRUPT_TYPES = [
  { name: 'approval', detail: 'yes/no decision gate' },
  { name: 'qa', detail: 'structured questions' },
  { name: 'selection', detail: 'pick from a list' },
  { name: 'review', detail: 'human reviews a draft' },
  { name: 'escalation', detail: 'flag a risk' },
];

export interface SkillSlashOptions {
  skills: string[];
  files: string[];
  currentSkill: string;
  onCreateSkill?: (name: string) => void;
}

/**
 * CodeMirror autocomplete source for skill editor slash commands.
 *
 * Handles three trigger patterns:
 * - `//` → sub-skill reference (inserts `//skill:NAME`)
 * - `@`  → file reference (inserts `@path/to/file.md`)
 * - `/`  → block commands (inserts fenced code block template)
 */
export function createSkillSlashAutocomplete(opts: SkillSlashOptions = { skills: [], files: [], currentSkill: '' }) {
  const { onCreateSkill } = opts;

  return function skillSlashAutocomplete(context: CompletionContext): CompletionResult | null {
    // 1. Check for // first (sub-skill reference) — HIGHEST PRIORITY
    const doubleSlash = context.matchBefore(/\/\/[\w-]*/);
    if (doubleSlash) {
      const query = doubleSlash.text.slice(2).toLowerCase();
      const options: Array<{ label: string; type: string; detail: string; apply: string | ((view: EditorView, _completion: Completion, from: number, to: number) => void) }> = opts.skills
        .filter((s) => s !== opts.currentSkill && s.toLowerCase().includes(query))
        .map((s) => ({
          label: s,
          type: 'variable' as const,
          apply: `//skill:${s}`,
          detail: 'sub-skill',
        }));

      if (options.length === 0) return null;

      return {
        from: doubleSlash.from,
        options,
        filter: false,
      };
    }

    // 2. Check for @ (file reference)
    const atSign = context.matchBefore(/@[\w./-]*/);
    if (atSign) {
      // Only trigger after whitespace or start of line
      const charBefore = atSign.from > 0
        ? context.state.doc.sliceString(atSign.from - 1, atSign.from)
        : '';
      if (charBefore && !/[\s\n]/.test(charBefore)) return null;

      const query = atSign.text.slice(1).toLowerCase();
      const options = opts.files
        .filter((f) => f !== 'SKILL.md' && f.toLowerCase().includes(query))
        .map((f) => {
          const fileName = f.includes('/') ? f.split('/').pop()! : f;
          const dir = f.includes('/') ? f.split('/').slice(0, -1).join('/') : '';
          return {
            label: fileName,
            type: 'property' as const,
            apply: `@${f}`,
            detail: dir || 'file',
          };
        });

      if (options.length === 0) return null;

      return {
        from: atSign.from,
        options,
        filter: false,
      };
    }

    // 3. Existing / block commands — must not be //
    const singleSlash = context.matchBefore(/\/[\w-]*/);
    if (!singleSlash) return null;

    // Don't trigger mid-word — must be start of line or after whitespace
    const charBefore = singleSlash.from > 0
      ? context.state.doc.sliceString(singleSlash.from - 1, singleSlash.from)
      : '';
    if (charBefore && !/[\s\n]/.test(charBefore)) return null;

    const query = singleSlash.text.slice(1).toLowerCase();

    const options: Array<{ label: string; type: string; detail: string; apply: string | ((view: EditorView, _completion: Completion, from: number, to: number) => void) }> = [];

    // Block commands (/output, /decision, /guardrail)
    for (const opt of BLOCK_OPTIONS) {
      if (opt.name.includes(query)) {
        options.push({
          label: opt.label,
          type: 'keyword',
          detail: opt.detail,
          apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
            const insert = '\n' + BLOCK_TEMPLATES[opt.name] + '\n\n';
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length },
            });
          },
        });
      }
    }

    // Interrupt commands (/interrupt:approval, /interrupt:qa, etc.)
    for (const int of INTERRUPT_TYPES) {
      const full = `interrupt:${int.name}`;
      if (full.includes(query) || 'interrupt'.includes(query)) {
        options.push({
          label: `interrupt:${int.name}`,
          type: 'keyword',
          apply: `/interrupt:${int.name}`,
          detail: int.detail,
        });
      }
    }

    // Skill references (/skill:NAME) — existing skills
    for (const skill of opts.skills) {
      if (skill === opts.currentSkill) continue;
      if (skill.toLowerCase().includes(query)) {
        options.push({
          label: skill,
          type: 'variable',
          apply: `/skill:${skill}`,
          detail: 'skill',
        });
      }
    }

    // Offer "Create skill" if query doesn't match a built-in command or existing skill
    if (query && !opts.skills.some((s) => s.toLowerCase() === query)
        && !BLOCK_OPTIONS.some((o) => o.name === query)
        && !query.startsWith('interrupt')) {
      options.push({
        label: `Create "${query}"`,
        type: 'class',
        detail: 'new skill',
        apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
          view.dispatch({
            changes: { from, to, insert: `/skill:${query}` },
            selection: { anchor: from + query.length + 7 },
          });
          onCreateSkill?.(query);
        },
      });
    }

    if (options.length === 0) return null;

    return {
      from: singleSlash.from,
      options,
      filter: false,
    };
  };
}
