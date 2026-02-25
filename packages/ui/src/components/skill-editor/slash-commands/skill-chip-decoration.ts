import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const subSkillDeco = Decoration.mark({ class: 'cm-chip cm-chip-subskill' });
const fileRefDeco = Decoration.mark({ class: 'cm-chip cm-chip-fileref' });
const interruptDeco = Decoration.mark({ class: 'cm-chip cm-chip-interrupt' });

const PATTERNS = [
  { regex: /\/\/skill:([\w-]+)/g, deco: subSkillDeco },
  { regex: /@([\w./-]+\.\w+)/g, deco: fileRefDeco },
  { regex: /\/interrupt:(approval|qa|selection|review|escalation)\b/g, deco: interruptDeco },
];

/** Exported for the atomic-backspace handler */
export const SKILL_CHIP_PATTERNS = PATTERNS;

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: { from: number; to: number; deco: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);

    for (const { regex, deco } of PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        ranges.push({
          from: from + match.index,
          to: from + match.index + match[0].length,
          deco,
        });
      }
    }
  }

  // RangeSetBuilder requires ranges in sorted order
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const { from, to, deco } of ranges) {
    builder.add(from, to, deco);
  }

  return builder.finish();
}

export const skillChipDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
