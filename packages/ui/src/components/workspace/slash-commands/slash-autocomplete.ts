import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';

interface SlashAutocompleteOptions {
  skills: string[];
  agents: string[];
  onCreateAgent?: (name: string) => void;
}

const INTERRUPT_TYPES = [
  { name: 'approval', detail: 'yes/no decision gate' },
  { name: 'qa', detail: 'structured questions' },
  { name: 'selection', detail: 'pick from a list' },
  { name: 'review', detail: 'human reviews a draft' },
  { name: 'escalation', detail: 'flag a risk' },
];

export function createSlashAutocomplete({ skills, agents, onCreateAgent }: SlashAutocompleteOptions) {
  return function slashAutocomplete(context: CompletionContext): CompletionResult | null {
    // Check for // first (agent reference)
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

    // Check for / (skill, merge, or interrupt reference) — must not be //
    const singleSlash = context.matchBefore(/\/[\w-:]*/);
    if (singleSlash && !singleSlash.text.startsWith('//')) {
      // Only trigger after whitespace or start of line
      const charBefore = singleSlash.from > 0
        ? context.state.doc.sliceString(singleSlash.from - 1, singleSlash.from)
        : '';
      if (charBefore && !/\s/.test(charBefore)) return null;

      const query = singleSlash.text.slice(1).toLowerCase();
      const options: Array<{ label: string; type: string; apply: string; detail: string }> = [];

      // /merge option
      if ('merge'.includes(query)) {
        options.push({
          label: 'merge',
          type: 'keyword',
          apply: '/merge',
          detail: 'merge point',
        });
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

      return {
        from: singleSlash.from,
        options,
        filter: false,
      };
    }

    return null;
  };
}
