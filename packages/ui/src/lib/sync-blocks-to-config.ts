import { parseInstructions } from './parse-instructions';
import type { NodeConfig, InterruptConfig } from '@forgeflow/types';

const ARTIFACT_REF_PATTERN = /@([\w._/-]+)/g;
const ARTIFACT_OUTPUT_PATTERN = /\\([\w._/-]+)/g;

/**
 * Expand folder references to individual artifacts.
 * If a ref matches a folder prefix in the registry, expands to all artifacts inside.
 */
function expandFolderRefs(refs: string[], registry?: Record<string, unknown>): string[] {
  if (!registry) return refs;
  const allArtifacts = Object.keys(registry);
  const result = new Set<string>();

  for (const ref of refs) {
    const folderContents = allArtifacts.filter((a) => a.startsWith(ref + '/'));
    if (folderContents.length > 0) {
      // It's a folder — expand to all artifacts inside
      for (const a of folderContents) result.add(a);
    } else {
      result.add(ref);
    }
  }
  return [...result];
}

/**
 * Extract structured config data from agent instructions text.
 *
 * - Outputs from \artifact_name declarations (backslash chips)
 * - Inputs from @artifact-name references (at-sign chips)
 * - Skills from /skill:NAME chips
 * - Interrupts from /interrupt:TYPE chips
 *
 * When artifactRegistry is provided, folder references (e.g., \reports) are
 * expanded to all individual artifacts within that folder.
 *
 * Returns null if no structured data was found.
 */
export function extractConfigFromInstructions(
  text: string,
  artifactRegistry?: Record<string, unknown>,
): Partial<NodeConfig> | null {
  const parsed = parseInstructions(text);
  const config: Partial<NodeConfig> = {};

  // Outputs from \artifact_name declarations
  const rawOutputs = [...new Set([...text.matchAll(ARTIFACT_OUTPUT_PATTERN)].map((m) => m[1]))];
  config.outputs = expandFolderRefs(rawOutputs, artifactRegistry);

  // Inputs from @artifact-name references
  const rawInputs = [...new Set([...text.matchAll(ARTIFACT_REF_PATTERN)].map((m) => m[1]))];
  config.inputs = expandFolderRefs(rawInputs, artifactRegistry);

  // Skills from /skill:NAME chips
  config.skills = parsed.skills;

  // Interrupts from /interrupt:TYPE chips
  config.interrupts = parsed.interrupts.map((type) => ({ type } as InterruptConfig));

  return Object.keys(config).length > 0 ? config : null;
}
