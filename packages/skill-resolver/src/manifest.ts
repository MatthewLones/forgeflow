import { parse as parseYaml } from 'yaml';
import type { SkillManifest } from '@forgeflow/types';

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Frontmatter is delimited by --- lines at the start of the file.
 *
 * Returns the parsed manifest and the remaining body content.
 */
export function parseSkillManifest(content: string): {
  manifest: SkillManifest;
  body: string;
} {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    throw new Error('SKILL.md missing YAML frontmatter (must start with ---)');
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    throw new Error('SKILL.md has unterminated frontmatter (missing closing ---)');
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  const raw = parseYaml(yamlBlock) as Record<string, unknown>;

  if (!raw || typeof raw !== 'object') {
    throw new Error('SKILL.md frontmatter is not a valid YAML object');
  }

  if (typeof raw.name !== 'string' || !raw.name) {
    throw new Error('SKILL.md frontmatter missing required "name" field');
  }

  if (typeof raw.description !== 'string' || !raw.description) {
    throw new Error('SKILL.md frontmatter missing required "description" field');
  }

  const manifest: SkillManifest = {
    name: raw.name,
    description: raw.description,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    source: typeof raw.source === 'string' ? raw.source : undefined,
    authority: typeof raw.authority === 'string' ? raw.authority : undefined,
    lawAsOf: typeof raw.law_as_of === 'string' ? raw.law_as_of : undefined,
  };

  return { manifest, body };
}
