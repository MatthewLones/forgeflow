import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { BLOCK_TEMPLATES } from './skill-block-templates';

interface SkillBlockOption {
  name: string;
  label: string;
  detail: string;
}

const BLOCK_OPTIONS: SkillBlockOption[] = [
  { name: 'output', label: 'output', detail: 'Structured output file table' },
  { name: 'input', label: 'input', detail: 'Input file specification' },
  { name: 'decision', label: 'decision', detail: 'Decision tree / routing logic' },
  { name: 'guardrail', label: 'guardrail', detail: 'Do / Don\'t rules' },
];

/**
 * CodeMirror autocomplete source for skill editor slash commands.
 * Triggered on `/` at the start of a line or after whitespace.
 * Inserts a forgeflow fenced code block template via a transaction.
 */
export function createSkillSlashAutocomplete() {
  return function skillSlashAutocomplete(context: CompletionContext): CompletionResult | null {
    const singleSlash = context.matchBefore(/\/[\w-]*/);
    if (!singleSlash) return null;

    // Don't trigger mid-word — must be start of line or after whitespace
    const charBefore = singleSlash.from > 0
      ? context.state.doc.sliceString(singleSlash.from - 1, singleSlash.from)
      : '';
    if (charBefore && !/[\s\n]/.test(charBefore)) return null;

    const query = singleSlash.text.slice(1).toLowerCase();

    const options = BLOCK_OPTIONS
      .filter((opt) => opt.name.includes(query))
      .map((opt) => ({
        label: opt.label,
        type: 'keyword' as const,
        detail: opt.detail,
        apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
          const insert = '\n' + BLOCK_TEMPLATES[opt.name] + '\n\n';
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          });
        },
      }));

    if (options.length === 0) return null;

    return {
      from: singleSlash.from,
      options,
      filter: false,
    };
  };
}
