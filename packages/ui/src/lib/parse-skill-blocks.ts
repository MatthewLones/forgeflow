import type { ParsedSkillBlock, SkillBlockType, SkillBlockData } from './skill-block-types';

const BLOCK_TYPES: Set<string> = new Set(['output', 'input', 'decision']);

/**
 * Regex matching a forgeflow fenced code block:
 *   ```forgeflow:TYPE
 *   { ... JSON ... }
 *   ```
 *
 * Captures: [1] = block type, [2] = JSON body
 */
const FENCED_BLOCK_RE = /```forgeflow:([\w-]+)\n([\s\S]*?)```/g;

/**
 * Extract all `forgeflow:*` fenced blocks from markdown content.
 * Returns an array of parsed blocks with their positions for widget decoration.
 */
export function parseSkillBlocks(content: string): ParsedSkillBlock[] {
  const blocks: ParsedSkillBlock[] = [];
  const re = new RegExp(FENCED_BLOCK_RE.source, FENCED_BLOCK_RE.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const type = match[1];
    if (!BLOCK_TYPES.has(type)) continue;

    const jsonStr = match[2].trim();
    let data: SkillBlockData;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      // Invalid JSON — skip this block (will show as raw in the editor)
      continue;
    }

    blocks.push({
      type: type as SkillBlockType,
      data,
      raw: match[0],
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return blocks;
}

/**
 * Check whether a string position falls inside any forgeflow block.
 * Useful for cursor management and decoration filtering.
 */
export function isInsideBlock(content: string, pos: number): boolean {
  const blocks = parseSkillBlocks(content);
  return blocks.some((b) => pos >= b.from && pos <= b.to);
}
