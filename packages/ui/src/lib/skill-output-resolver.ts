/**
 * Extracts output artifact definitions from a SKILL.md content string.
 * Used to auto-inherit skill outputs into agent config.outputs.
 */

import type { ArtifactSchema, ArtifactField } from '@forgeflow/types';
import { parseSkillBlocks } from './parse-skill-blocks';

/** Shape of legacy forgeflow:output blocks still present in SKILL.md files. */
interface LegacyOutputBlock {
  files: Array<{
    name: string;
    format: string;
    description: string;
    fields?: ArtifactField[];
  }>;
}

/**
 * Parse a SKILL.md content string and extract all output artifact schemas.
 * Returns ArtifactSchema[] suitable for merging into a node's config.outputs.
 */
export function extractSkillOutputs(skillContent: string): ArtifactSchema[] {
  const blocks = parseSkillBlocks(skillContent);
  const outputs: ArtifactSchema[] = [];

  for (const block of blocks) {
    if (block.type !== 'output') continue;
    const data = block.data as LegacyOutputBlock;
    for (const file of data.files) {
      if (!file.name) continue;
      outputs.push({
        name: file.name,
        format: (file.format as ArtifactSchema['format']) || 'json',
        description: file.description || '',
        ...(file.fields?.length ? { fields: file.fields } : {}),
      });
    }
  }

  return outputs;
}
