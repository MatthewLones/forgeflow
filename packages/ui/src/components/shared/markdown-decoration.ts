import { syntaxTree } from '@codemirror/language';
import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

/* ── Decoration constants ────────────────────────────────── */

const headingDeco: Record<number, Decoration> = {
  1: Decoration.mark({ class: 'cm-md-h1' }),
  2: Decoration.mark({ class: 'cm-md-h2' }),
  3: Decoration.mark({ class: 'cm-md-h3' }),
  4: Decoration.mark({ class: 'cm-md-h4' }),
  5: Decoration.mark({ class: 'cm-md-h5' }),
  6: Decoration.mark({ class: 'cm-md-h6' }),
};

const boldDeco = Decoration.mark({ class: 'cm-md-bold' });
const italicDeco = Decoration.mark({ class: 'cm-md-italic' });
const blockquoteLineDeco = Decoration.line({ class: 'cm-md-blockquote' });
const inlineCodeDeco = Decoration.mark({ class: 'cm-md-inline-code' });
const listMarkerDeco = Decoration.mark({ class: 'cm-md-list-marker' });

/** Replaces text with nothing — used to hide markdown syntax marks */
const hideDeco = Decoration.replace({});

/* ── Build decorations from the markdown syntax tree ─────── */

function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);

  // Collect all ranges, then sort (RangeSetBuilder requires sorted order)
  const markRanges: { from: number; to: number; deco: Decoration }[] = [];
  const lineDecos: Map<number, Decoration> = new Map();

  // Determine which lines the cursor is on (handle multiple selections)
  const cursorLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number;
    const endLine = view.state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) {
      cursorLines.add(l);
    }
  }

  // Visible range bounds
  const visFrom = view.visibleRanges[0]?.from ?? 0;
  const visTo = view.visibleRanges[view.visibleRanges.length - 1]?.to ?? view.state.doc.length;

  tree.iterate({
    from: visFrom,
    to: visTo,
    enter(node) {
      // --- ATX Headings (# through ######) ---
      if (node.name.startsWith('ATXHeading')) {
        const level = parseInt(node.name.replace('ATXHeading', ''), 10);
        if (level >= 1 && level <= 6 && headingDeco[level]) {
          markRanges.push({ from: node.from, to: node.to, deco: headingDeco[level] });
        }
      }

      // --- Bold ---
      if (node.name === 'StrongEmphasis') {
        markRanges.push({ from: node.from, to: node.to, deco: boldDeco });
      }

      // --- Italic ---
      if (node.name === 'Emphasis') {
        markRanges.push({ from: node.from, to: node.to, deco: italicDeco });
      }

      // --- Blockquote (line decoration) ---
      if (node.name === 'Blockquote') {
        // Apply line decoration to each line within the blockquote
        const startLine = view.state.doc.lineAt(node.from).number;
        const endLine = view.state.doc.lineAt(node.to).number;
        for (let l = startLine; l <= endLine; l++) {
          lineDecos.set(l, blockquoteLineDeco);
        }
      }

      // --- Inline code ---
      if (node.name === 'InlineCode') {
        markRanges.push({ from: node.from, to: node.to, deco: inlineCodeDeco });
      }

      // --- List markers (keep visible but style muted) ---
      if (node.name === 'ListMark') {
        markRanges.push({ from: node.from, to: node.to, deco: listMarkerDeco });
      }

      // --- HIDE MARKS when cursor is NOT on the same line ---
      const nodeLine = view.state.doc.lineAt(node.from).number;
      const onCursorLine = cursorLines.has(nodeLine);

      if (!onCursorLine) {
        // HeaderMark: hide `# ` / `## ` etc (include trailing space)
        if (node.name === 'HeaderMark') {
          const lineEnd = view.state.doc.lineAt(node.from).to;
          const markEnd = Math.min(node.to + 1, lineEnd); // +1 for the space after #
          markRanges.push({ from: node.from, to: markEnd, deco: hideDeco });
        }

        // EmphasisMark: hide `**` or `*`
        if (node.name === 'EmphasisMark') {
          markRanges.push({ from: node.from, to: node.to, deco: hideDeco });
        }

        // QuoteMark: hide `> ` (include trailing space)
        if (node.name === 'QuoteMark') {
          const lineEnd = view.state.doc.lineAt(node.from).to;
          const markEnd = Math.min(node.to + 1, lineEnd);
          markRanges.push({ from: node.from, to: markEnd, deco: hideDeco });
        }

        // CodeMark: hide backticks for inline code only (not fenced code blocks)
        if (node.name === 'CodeMark') {
          const parent = node.node.parent;
          if (parent?.name === 'InlineCode') {
            markRanges.push({ from: node.from, to: node.to, deco: hideDeco });
          }
        }
      }
    },
  });

  // Add line decorations first (they must come before mark decorations at the same position)
  const sortedLineNumbers = [...lineDecos.keys()].sort((a, b) => a - b);
  for (const lineNum of sortedLineNumbers) {
    const line = view.state.doc.line(lineNum);
    builder.add(line.from, line.from, lineDecos.get(lineNum)!);
  }

  // Sort mark ranges by position
  markRanges.sort((a, b) => a.from - b.from || a.to - b.to);

  // Filter out overlapping replace decorations that conflict with each other
  // (e.g., if both a HeaderMark hide and a heading style overlap)
  for (const { from, to, deco } of markRanges) {
    builder.add(from, to, deco);
  }

  return builder.finish();
}

/* ── ViewPlugin ──────────────────────────────────────────── */

export const markdownDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view);
    }

    update(update: ViewUpdate) {
      // Rebuild on doc changes, viewport changes, OR cursor movement
      // (cursor movement reveals/hides marks on the active line)
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildMarkdownDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
