import { parseSkillBlocks } from './parse-skill-blocks';
import { parseInstructions } from './parse-instructions';
import type { OutputBlock } from './skill-block-types';
import type { NodeConfig, ArtifactSchema, InterruptConfig } from '@forgeflow/types';

const ARTIFACT_REF_PATTERN = /@([\w._-]+)/g;

/**
 * Extract structured config data from agent instructions text.
 *
 * - Outputs from ```forgeflow:output fenced blocks
 * - Inputs from @artifact-name references (inline chips)
 * - Skills from /skill:NAME chips
 * - Interrupts from /interrupt:TYPE chips
 *
 * Returns null if no structured data was found.
 */
export function extractConfigFromInstructions(text: string): Partial<NodeConfig> | null {
  const blocks = parseSkillBlocks(text);
  const parsed = parseInstructions(text);
  const config: Partial<NodeConfig> = {};

  // Outputs from forgeflow:output blocks
  const outputBlocks = blocks.filter((b) => b.type === 'output');
  if (outputBlocks.length > 0) {
    const outputs: ArtifactSchema[] = [];
    for (const ob of outputBlocks) {
      for (const file of (ob.data as OutputBlock).files) {
        if (!file.name) continue;
        outputs.push({
          name: file.name,
          format: file.format || 'json',
          description: file.description || '',
          ...(file.fields?.length ? { fields: file.fields } : {}),
        });
      }
    }
    config.outputs = outputs;
  } else {
    config.outputs = [];
  }

  // Inputs from @artifact-name references
  const artifactRefs = [...new Set([...text.matchAll(ARTIFACT_REF_PATTERN)].map((m) => m[1]))];
  config.inputs = artifactRefs.map((name) => name);

  // Skills from /skill:NAME chips
  config.skills = parsed.skills;

  // Interrupts from /interrupt:TYPE chips
  config.interrupts = parsed.interrupts.map((type) => ({ type } as InterruptConfig));

  return Object.keys(config).length > 0 ? config : null;
}
