import type { InputBlock, DecisionBlock, GuardrailBlock } from '../../../lib/skill-block-types';

/** Default JSON data for each block type, inserted when the user selects a slash command. */

export const DEFAULT_INPUT: InputBlock = {
  files: [
    { name: '', format: 'json', required: true, description: '' },
  ],
};

export const DEFAULT_DECISION: DecisionBlock = {
  title: '',
  rows: [
    { condition: '', action: '', references: [] },
  ],
};

export const DEFAULT_GUARDRAIL: GuardrailBlock = {
  rules: [
    { type: 'dont', rule: '', reason: '' },
  ],
};

/**
 * Generate the fenced code block string for a given block type and data.
 */
export function buildFencedBlock(type: string, data: unknown): string {
  return '```forgeflow:' + type + '\n' + JSON.stringify(data, null, 2) + '\n```';
}

/** Templates map: slash command name → fenced block string. */
export const BLOCK_TEMPLATES: Record<string, string> = {
  input: buildFencedBlock('input', DEFAULT_INPUT),
  decision: buildFencedBlock('decision', DEFAULT_DECISION),
  guardrail: buildFencedBlock('guardrail', DEFAULT_GUARDRAIL),
};
