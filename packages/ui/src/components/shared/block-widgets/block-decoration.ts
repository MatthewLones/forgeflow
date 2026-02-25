import {
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view';
import { StateField, type Transaction, RangeSetBuilder } from '@codemirror/state';
import type { SkillBlockType, SkillBlockData } from '../../../lib/skill-block-types';
import { SkillBlockWidget } from './WidgetPortal';

const BLOCK_TYPES = new Set<string>(['output', 'input', 'decision', 'guardrail']);

/**
 * Regex matching a forgeflow fenced code block across multiple lines.
 * Captures: [1] = block type, [2] = JSON body
 */
const FENCED_BLOCK_RE = /```forgeflow:([\w-]+)\n([\s\S]*?)```/g;

function buildDecorations(doc: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: { from: number; to: number; deco: Decoration }[] = [];

  const re = new RegExp(FENCED_BLOCK_RE.source, FENCED_BLOCK_RE.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(doc)) !== null) {
    const type = match[1];
    if (!BLOCK_TYPES.has(type)) continue;

    const jsonStr = match[2].trim();
    let data: SkillBlockData;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      // Invalid JSON — show an error decoration instead of a widget
      ranges.push({
        from: match.index,
        to: match.index + match[0].length,
        deco: Decoration.mark({ class: 'cm-skill-block-error' }),
      });
      continue;
    }

    const blockFrom = match.index;
    const blockTo = match.index + match[0].length;

    const widget = new SkillBlockWidget(
      type as SkillBlockType,
      data,
      blockFrom,
      blockTo,
    );

    ranges.push({
      from: blockFrom,
      to: blockTo,
      deco: Decoration.replace({
        widget,
        block: true,
      }),
    });
  }

  // RangeSetBuilder requires sorted ranges
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const { from, to, deco } of ranges) {
    builder.add(from, to, deco);
  }

  return builder.finish();
}

/**
 * CodeMirror StateField that replaces forgeflow fenced code blocks
 * with interactive React widget decorations.
 *
 * Uses a StateField (not ViewPlugin) because block-level decorations
 * (Decoration.replace with block: true) are only allowed from StateFields.
 */
export const blockDecorationPlugin = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state.doc.toString());
  },
  update(decos: DecorationSet, tr: Transaction) {
    if (tr.docChanged) {
      return buildDecorations(tr.newDoc.toString());
    }
    return decos;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});
