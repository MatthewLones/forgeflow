import type {
  ConvertibleSection,
  InputBlock,
  GuardrailBlock,
} from './skill-block-types';

/**
 * Scan plain markdown content for patterns that can be converted to
 * forgeflow structured blocks. Returns suggested conversions.
 *
 * Detection patterns:
 * - Markdown table with "Input" column header → /input block
 * - Blockquote lines with "DO NOT" / "DO" language → /guardrail block
 */
export function detectConvertibleSections(content: string): ConvertibleSection[] {
  const sections: ConvertibleSection[] = [];

  // Skip content that already has forgeflow blocks
  if (content.includes('```forgeflow:')) return sections;

  sections.push(...detectInputTables(content));
  sections.push(...detectGuardrails(content));

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

/**
 * Detect blockquote lines with "DO NOT" / "DO" guardrail language.
 * Matches consecutive blockquote lines that contain guardrail patterns.
 */
function detectGuardrails(content: string): ConvertibleSection[] {
  const results: ConvertibleSection[] = [];
  // Match a block of consecutive > lines containing DO/DO NOT
  const blockquoteRe = /^((?:>[ \t]*(?:\*\*DO(?:\s+NOT)?\*\*|DO(?:\s+NOT)?)[^\n]*\n?(?:>[ \t]*\n?)*)+)/gm;
  let match: RegExpExecArray | null;

  while ((match = blockquoteRe.exec(content)) !== null) {
    const lines = match[0].split('\n').filter((l) => l.trim().startsWith('>'));
    const rules = lines
      .map((line) => {
        const text = line.replace(/^>\s*/, '').trim();
        if (!text) return null;

        const dontMatch = text.match(/^\*?\*?DO\s+NOT\*?\*?\s+(.+)/i);
        if (dontMatch) {
          const { rule, reason } = extractRuleAndReason(dontMatch[1]);
          return { type: 'dont' as const, rule, reason };
        }

        const doMatch = text.match(/^\*?\*?DO\*?\*?\s+(.+)/i);
        if (doMatch) {
          const { rule, reason } = extractRuleAndReason(doMatch[1]);
          return { type: 'do' as const, rule, reason };
        }

        return null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rules.length === 0) continue;

    const block: GuardrailBlock = { rules };
    const replacement = '```forgeflow:guardrail\n' + JSON.stringify(block, null, 2) + '\n```';

    results.push({
      type: 'guardrail',
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

function extractRuleAndReason(text: string): { rule: string; reason: string } {
  // Look for italicized reason at the end: "Rule text. *reason*"
  const reasonMatch = text.match(/^(.+?)\s*\*([^*]+)\*\s*$/);
  if (reasonMatch) {
    return { rule: reasonMatch[1].replace(/\.\s*$/, ''), reason: reasonMatch[2] };
  }
  // Look for parenthetical reason: "Rule text (reason)"
  const parenMatch = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    return { rule: parenMatch[1].replace(/\.\s*$/, ''), reason: parenMatch[2] };
  }
  return { rule: text, reason: '' };
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
