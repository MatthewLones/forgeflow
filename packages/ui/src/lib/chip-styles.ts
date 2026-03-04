/** Shared chip styling constants used across ConfigBottomPanel, AISidePanel, and SlashCommandEditor */

export type ChipType = 'skill' | 'agent' | 'interrupt' | 'artifact' | 'artifact-output';

export interface ChipStyle {
  color: string;
  bg: string;
  label: (name: string) => string;
}

export const CHIP_STYLES: Record<ChipType, ChipStyle> = {
  skill:             { color: '#059669', bg: 'rgba(16, 185, 129, 0.12)',  label: (n) => `/skill:${n}` },
  agent:             { color: '#2563eb', bg: 'rgba(59, 130, 246, 0.12)',  label: (n) => `//agent:${n}` },
  interrupt:         { color: '#dc2626', bg: 'rgba(239, 68, 68, 0.12)',   label: (n) => `/interrupt:${n}` },
  artifact:          { color: '#7c3aed', bg: 'rgba(139, 92, 246, 0.12)',  label: (n) => `@${n}` },
  'artifact-output': { color: '#6d28d9', bg: 'rgba(139, 92, 246, 0.20)', label: (n) => `\\${n}` },
};

export const CHIP_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** Inline style string for HTML injection (AISidePanel renderMarkdown) */
export function chipInlineStyle(type: ChipType): string {
  const s = CHIP_STYLES[type];
  return `display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:4px;font-size:12px;font-weight:500;font-family:${CHIP_FONT_FAMILY};cursor:pointer;color:${s.color};background:${s.bg};`;
}

/** Human-readable descriptions for each interrupt type */
export const INTERRUPT_DESCRIPTIONS: Record<string, string> = {
  approval:   'Pauses execution for human approval before proceeding',
  qa:         'Asks the user clarifying questions mid-execution',
  selection:  'Presents options for the user to choose from',
  review:     'Shows a draft for human review and editing',
  escalation: 'Escalates a critical finding to the user',
};

/** Build rich tooltip text for an artifact from its schema */
export function artifactTooltip(schema: { format?: string; description?: string; fields?: { key: string }[] } | null): string {
  if (!schema) return '';
  const parts: string[] = [];
  if (schema.description) parts.push(schema.description);
  if (schema.format) parts.push(`Format: ${schema.format}`);
  if (schema.fields?.length) parts.push(`${schema.fields.length} fields`);
  return parts.join(' \u2022 ');
}

/** Escape a string for safe use in an HTML attribute value */
export function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
