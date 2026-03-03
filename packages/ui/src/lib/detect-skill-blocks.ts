import type {
  ConvertibleSection,
  InputBlock,
} from './skill-block-types';

/**
 * Scan plain markdown content for patterns that can be converted to
 * forgeflow structured blocks. Returns suggested conversions.
 *
 * Detection patterns:
 * - Markdown table with "Input" column header → /input block
 */
export function detectConvertibleSections(content: string): ConvertibleSection[] {
  const sections: ConvertibleSection[] = [];

  // Skip content that already has forgeflow blocks
  if (content.includes('```forgeflow:')) return sections;

  sections.push(...detectInputTables(content));

  // Sort by position and deduplicate overlapping ranges
  sections.sort((a, b) => a.from - b.from);
  return deduplicateOverlapping(sections);
}

/**
 * Detect markdown tables with "Input" column header.
 */
function detectInputTables(content: string): ConvertibleSection[] {
  const results: ConvertibleSection[] = [];
  const tableRe = /^(\|[^\n]*Input[^\n]*\|)\n(\|[-| :]+\|)\n((?:\|[^\n]*\|\n?)+)/gm;
  let match: RegExpExecArray | null;

  while ((match = tableRe.exec(content)) !== null) {
    const headerRow = match[1];
    const dataRows = match[3].trim().split('\n');
    const headers = parseTableRow(headerRow);

    const nameIdx = findColumnIndex(headers, ['input', 'name', 'file']);
    const formatIdx = findColumnIndex(headers, ['format', 'type']);
    const reqIdx = findColumnIndex(headers, ['required', 'req']);
    const descIdx = findColumnIndex(headers, ['description', 'desc', 'contents', 'content']);

    if (nameIdx === -1) continue;

    const files = dataRows
      .map((row) => {
        const cells = parseTableRow(row);
        const reqCell = (cells[reqIdx] ?? '').toLowerCase();
        return {
          name: stripBackticks(cells[nameIdx] ?? ''),
          format: cells[formatIdx] ?? '',
          required: reqCell !== 'no' && reqCell !== 'false' && reqCell !== 'optional',
          description: cells[descIdx] ?? '',
        };
      })
      .filter((f) => f.name);

    if (files.length === 0) continue;

    const block: InputBlock = { files };
    const replacement = '```forgeflow:input\n' + JSON.stringify(block, null, 2) + '\n```';

    results.push({
      type: 'input',
      from: match.index,
      to: match.index + match[0].length,
      original: match[0],
      replacement,
    });
  }

  return results;
}

// --- Helpers ---

function parseTableRow(row: string): string[] {
  return row
    .split('|')
    .slice(1, -1) // Remove leading/trailing empty strings from | split
    .map((cell) => cell.trim());
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) =>
    candidates.some((c) => h.toLowerCase().includes(c)),
  );
}

function stripBackticks(s: string): string {
  return s.replace(/^`|`$/g, '');
}

function deduplicateOverlapping(sections: ConvertibleSection[]): ConvertibleSection[] {
  const result: ConvertibleSection[] = [];
  let lastEnd = -1;

  for (const section of sections) {
    if (section.from >= lastEnd) {
      result.push(section);
      lastEnd = section.to;
    }
  }

  return result;
}
