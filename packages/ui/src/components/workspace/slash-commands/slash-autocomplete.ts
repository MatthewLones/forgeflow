import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { BLOCK_TEMPLATES } from '../../shared/block-widgets/block-templates';

export interface SlashAutocompleteOptions {
  skills: string[];
  agents: string[];
  artifacts: string[];
  artifactFolders?: string[];
  onCreateAgent?: (name: string) => void;
  onCreateArtifact?: (name: string) => void;
  onCreateSkill?: (name: string) => void;
}

const BLOCK_OPTIONS = [
  { name: 'decision', label: 'decision', detail: 'Decision tree / routing logic' },
];

const INTERRUPT_TYPES = [
  { name: 'approval', detail: 'yes/no decision gate' },
  { name: 'qa', detail: 'structured questions' },
  { name: 'selection', detail: 'pick from a list' },
  { name: 'review', detail: 'human reviews a draft' },
  { name: 'escalation', detail: 'flag a risk' },
];

export function createSlashAutocomplete({ skills, agents, artifacts, artifactFolders = [], onCreateAgent, onCreateArtifact, onCreateSkill }: SlashAutocompleteOptions) {
  return function slashAutocomplete(context: CompletionContext): CompletionResult | null {
    // 1. Check for \ (artifact output declaration)
    const backslash = context.matchBefore(/\\[\w._/-]*/);
    if (backslash) {
      const charBefore = backslash.from > 0
        ? context.state.doc.sliceString(backslash.from - 1, backslash.from)
        : '';
      if (charBefore && !/[\s\n]/.test(charBefore)) return null;

      const query = backslash.text.slice(1).toLowerCase();
      const options: Array<{ label: string; type: string; detail: string; apply: string | ((view: EditorView, _completion: Completion, from: number, to: number) => void) }> = artifacts
        .filter((a) => a.toLowerCase().includes(query))
        .map((a) => ({
          label: a,
          type: 'property' as const,
          apply: `\\${a}`,
          detail: 'output artifact',
        }));

      // Add folder options
      for (const folder of artifactFolders) {
        if (folder.toLowerCase().includes(query)) {
          const count = artifacts.filter((a) => a.startsWith(folder + '/')).length;
          options.push({
            label: folder,
            type: 'property',
            apply: `\\${folder}`,
            detail: `folder (${count} artifact${count !== 1 ? 's' : ''})`,
          });
        }
      }

      // Offer "Create" if query doesn't match an existing artifact or folder
      if (query && !artifacts.some((a) => a.toLowerCase() === query) && !artifactFolders.some((f) => f.toLowerCase() === query)) {
        options.push({
          label: `Create "${query}"`,
          type: 'property',
          detail: 'new artifact',
          apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
            view.dispatch({
              changes: { from, to, insert: `\\${query}` },
              selection: { anchor: from + query.length + 1 },
            });
            onCreateArtifact?.(query);
          },
        });
      }

      if (options.length === 0) return null;
      return { from: backslash.from, options, filter: false };
    }

    // 2. Check for @ (artifact input reference)
    const atSign = context.matchBefore(/@[\w._/-]*/);
    if (atSign) {
      const charBefore = atSign.from > 0
        ? context.state.doc.sliceString(atSign.from - 1, atSign.from)
        : '';
      if (charBefore && !/[\s\n]/.test(charBefore)) return null;

      const query = atSign.text.slice(1).toLowerCase();
      const options: Array<{ label: string; type: string; detail: string; apply: string | ((view: EditorView, _completion: Completion, from: number, to: number) => void) }> = artifacts
        .filter((a) => a.toLowerCase().includes(query))
        .map((a) => ({
          label: a,
          type: 'property' as const,
          apply: `@${a}`,
          detail: 'artifact',
        }));

      // Add folder options
      for (const folder of artifactFolders) {
        if (folder.toLowerCase().includes(query)) {
          const count = artifacts.filter((a) => a.startsWith(folder + '/')).length;
          options.push({
            label: folder,
            type: 'property',
            apply: `@${folder}`,
            detail: `folder (${count} artifact${count !== 1 ? 's' : ''})`,
          });
        }
      }

      // Offer "Create" if query doesn't match an existing artifact or folder
      if (query && !artifacts.some((a) => a.toLowerCase() === query) && !artifactFolders.some((f) => f.toLowerCase() === query)) {
        options.push({
          label: `Create "${query}"`,
          type: 'property',
          detail: 'new artifact',
          apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
            view.dispatch({
              changes: { from, to, insert: `@${query}` },
              selection: { anchor: from + query.length + 1 },
            });
            onCreateArtifact?.(query);
          },
        });
      }

      if (options.length === 0) return null;
      return { from: atSign.from, options, filter: false };
    }

    // 2. Check for // (agent reference)
    const doubleSlash = context.matchBefore(/\/\/[\w-]*/);
    if (doubleSlash) {
      const query = doubleSlash.text.slice(2).toLowerCase();
      const options: Array<{ label: string; type: string; apply: string; detail: string }> = agents
        .filter((a) => a.toLowerCase().includes(query))
        .map((a) => ({
          label: a,
          type: 'variable',
          apply: `//agent:${a}`,
          detail: 'agent',
        }));

      // Offer "Create" if query doesn't match an existing agent
      if (query && !agents.some((a) => a.toLowerCase() === query)) {
        options.push({
          label: `Create "${query}"`,
          type: 'variable',
          apply: `//agent:${query}`,
          detail: 'new agent',
        });
      }

      return {
        from: doubleSlash.from,
        options,
        filter: false,
      };
    }

    // 3. Check for / (block commands, skill, merge, or interrupt) — must not be //
    const singleSlash = context.matchBefore(/\/[\w-:]*/);
    if (singleSlash && !singleSlash.text.startsWith('//')) {
      // Only trigger after whitespace or start of line
      const charBefore = singleSlash.from > 0
        ? context.state.doc.sliceString(singleSlash.from - 1, singleSlash.from)
        : '';
      if (charBefore && !/\s/.test(charBefore)) return null;

      const query = singleSlash.text.slice(1).toLowerCase();
      const options: Array<{ label: string; type: string; detail: string; apply: string | ((view: EditorView, _completion: Completion, from: number, to: number) => void) }> = [];

      // Block commands (/decision)
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

      // /interrupt options
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

      // Skill options
      for (const s of skills) {
        if (s.toLowerCase().includes(query)) {
          options.push({
            label: s,
            type: 'class',
            apply: `/skill:${s}`,
            detail: 'skill',
          });
        }
      }

      // Offer "Create skill" if query doesn't match a built-in command or existing skill
      if (query && !skills.some((s) => s.toLowerCase() === query)
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
    }

    return null;
  };
}
