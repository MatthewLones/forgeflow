import { parseInstructions } from './parse-instructions';
import type { NodeConfig, InterruptConfig } from '@forgeflow/types';

const ARTIFACT_REF_PATTERN = /@([\w._-]+)/g;
const ARTIFACT_OUTPUT_PATTERN = /\\([\w._-]+)/g;

/**
 * Extract structured config data from agent instructions text.
 *
 * - Outputs from \artifact_name declarations (backslash chips)
 * - Inputs from @artifact-name references (at-sign chips)
 * - Skills from /skill:NAME chips
 * - Interrupts from /interrupt:TYPE chips
 *
 * Returns null if no structured data was found.
 */
export function extractConfigFromInstructions(text: string): Partial<NodeConfig> | null {
  const parsed = parseInstructions(text);
  const config: Partial<NodeConfig> = {};

  // Outputs from \artifact_name declarations
  config.outputs = [...new Set([...text.matchAll(ARTIFACT_OUTPUT_PATTERN)].map((m) => m[1]))];

  // Inputs from @artifact-name references
  config.inputs = [...new Set([...text.matchAll(ARTIFACT_REF_PATTERN)].map((m) => m[1]))];

  // Skills from /skill:NAME chips
  config.skills = parsed.skills;

  // Interrupts from /interrupt:TYPE chips
  config.interrupts = parsed.interrupts.map((type) => ({ type } as InterruptConfig));

  return Object.keys(config).length > 0 ? config : null;
}
