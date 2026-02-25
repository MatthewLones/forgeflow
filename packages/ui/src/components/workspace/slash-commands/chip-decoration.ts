import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const skillDeco = Decoration.mark({ class: 'cm-chip cm-chip-skill' });
const agentDeco = Decoration.mark({ class: 'cm-chip cm-chip-agent' });
const mergeDeco = Decoration.mark({ class: 'cm-chip cm-chip-merge' });
const interruptDeco = Decoration.mark({ class: 'cm-chip cm-chip-interrupt' });
const artifactDeco = Decoration.mark({ class: 'cm-chip cm-chip-artifact' });
const artifactOutputDeco = Decoration.mark({ class: 'cm-chip cm-chip-artifact-output' });

const PATTERNS = [
  { regex: /\/skill:([\w-]+)/g, deco: skillDeco },
  { regex: /\/\/agent:([\w-]+)/g, deco: agentDeco },
  { regex: /\/merge\b/g, deco: mergeDeco },
  { regex: /\/interrupt:(approval|qa|selection|review|escalation)\b/g, deco: interruptDeco },
  { regex: /\\([\w._-]+)/g, deco: artifactOutputDeco },
  { regex: /@([\w._-]+)/g, deco: artifactDeco },
];

/** Exported for the atomic-backspace handler */
export const CHIP_PATTERNS = PATTERNS;

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

export const chipDecorationPlugin = ViewPlugin.fromClass(
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
