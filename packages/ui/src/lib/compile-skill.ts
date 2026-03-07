import type {
  InputBlock,
  SkillBlockType,
} from './skill-block-types';

/**
 * Compile a markdown document by replacing all `forgeflow:*` fenced blocks
 * with their standard markdown equivalents (tables, blockquotes, etc.).
 *
 * This produces the "compiled view" that shows what the runtime agent sees.
 */
export function compileSkillContent(content: string): string {
  const re = /```forgeflow:([\w-]+)\n([\s\S]*?)```/g;

  return content.replace(re, (_match, type: string, jsonStr: string) => {
    const trimmed = jsonStr.trim();
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      // Invalid JSON — leave as-is (raw fenced block)
      return _match;
    }

    switch (type as SkillBlockType) {
      case 'input':
        return compileInputBlock(data as InputBlock);
      default:
        return _match;
    }
  });
}

function compileInputBlock(block: InputBlock): string {
  if (!block.files?.length) return '';

  const rows = block.files
    .map((f) => `| ${f.name} | ${f.format} | ${f.required ? 'Yes' : 'No'} | ${f.description} |`)
    .join('\n');

  return `| Input | Format | Required | Description |\n|-------|--------|----------|-------------|\n${rows}`;
}
