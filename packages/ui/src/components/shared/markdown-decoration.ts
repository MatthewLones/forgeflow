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

/* ── Regex patterns for markdown ─────────────────────────── */

/** Match ATX headings: `# `, `## `, etc. at start of line */
const HEADING_RE = /^(#{1,6})\s/;
/** Match **bold** or __bold__ (non-greedy, same line) */
const BOLD_RE = /\*\*(.+?)\*\*|__(.+?)__/g;
/** Match *italic* or _italic_ — single marker, not inside bold markers */
const ITALIC_RE = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g;
/** Match `inline code` */
const INLINE_CODE_RE = /`([^`]+)`/g;
/** Match > blockquote lines */
const BLOCKQUOTE_RE = /^>\s?/;
/** Match list markers: - or * or + or 1. at start of line */
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+\.)\s/;

/* ── Build decorations via regex (no syntax tree dependency) ── */

function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  const lineDecos: { lineFrom: number; deco: Decoration }[] = [];

  // Determine which lines the cursor is on
  const cursorLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number;
    const endLine = view.state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) {
      cursorLines.add(l);
    }
  }

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const lines = text.split('\n');
    let offset = from;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineFrom = offset;
      const lineNum = view.state.doc.lineAt(lineFrom).number;
      const onCursorLine = cursorLines.has(lineNum);

      // --- Headings ---
      const headingMatch = HEADING_RE.exec(line);
      if (headingMatch) {
        const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
        if (headingDeco[level]) {
          ranges.push({ from: lineFrom, to: lineFrom + line.length, deco: headingDeco[level] });
          // Hide the `# ` prefix when cursor is not on this line
          if (!onCursorLine) {
            ranges.push({ from: lineFrom, to: lineFrom + headingMatch[0].length, deco: hideDeco });
          }
        }
      }

      // --- Blockquote ---
      if (BLOCKQUOTE_RE.test(line)) {
        lineDecos.push({ lineFrom, deco: blockquoteLineDeco });
        if (!onCursorLine) {
          const qMatch = BLOCKQUOTE_RE.exec(line);
          if (qMatch) {
            ranges.push({ from: lineFrom, to: lineFrom + qMatch[0].length, deco: hideDeco });
          }
        }
      }

      // --- List markers ---
      const listMatch = LIST_MARKER_RE.exec(line);
      if (listMatch) {
        const markerStart = lineFrom + listMatch[1].length;
        const markerEnd = markerStart + listMatch[2].length;
        ranges.push({ from: markerStart, to: markerEnd, deco: listMarkerDeco });
      }

      // --- Bold ---
      BOLD_RE.lastIndex = 0;
      let boldMatch: RegExpExecArray | null;
      while ((boldMatch = BOLD_RE.exec(line)) !== null) {
        const matchFrom = lineFrom + boldMatch.index;
        const matchTo = matchFrom + boldMatch[0].length;
        ranges.push({ from: matchFrom, to: matchTo, deco: boldDeco });
        if (!onCursorLine) {
          // Hide opening **
          ranges.push({ from: matchFrom, to: matchFrom + 2, deco: hideDeco });
          // Hide closing **
          ranges.push({ from: matchTo - 2, to: matchTo, deco: hideDeco });
        }
      }

      // --- Italic ---
      ITALIC_RE.lastIndex = 0;
      let italicMatch: RegExpExecArray | null;
      while ((italicMatch = ITALIC_RE.exec(line)) !== null) {
        const matchFrom = lineFrom + italicMatch.index;
        const matchTo = matchFrom + italicMatch[0].length;
        ranges.push({ from: matchFrom, to: matchTo, deco: italicDeco });
        if (!onCursorLine) {
          ranges.push({ from: matchFrom, to: matchFrom + 1, deco: hideDeco });
          ranges.push({ from: matchTo - 1, to: matchTo, deco: hideDeco });
        }
      }

      // --- Inline code ---
      INLINE_CODE_RE.lastIndex = 0;
      let codeMatch: RegExpExecArray | null;
      while ((codeMatch = INLINE_CODE_RE.exec(line)) !== null) {
        const matchFrom = lineFrom + codeMatch.index;
        const matchTo = matchFrom + codeMatch[0].length;
        ranges.push({ from: matchFrom, to: matchTo, deco: inlineCodeDeco });
        if (!onCursorLine) {
          ranges.push({ from: matchFrom, to: matchFrom + 1, deco: hideDeco });
          ranges.push({ from: matchTo - 1, to: matchTo, deco: hideDeco });
        }
      }

      offset += line.length + 1; // +1 for the \n
    }
  }

  // Merge line decorations into ranges so everything is in a single sorted pass
  for (const { lineFrom, deco } of lineDecos) {
    ranges.push({ from: lineFrom, to: lineFrom, deco });
  }

  // Sort all decorations by position (line decos are point ranges at line start)
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const { from, to, deco } of ranges) {
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
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildMarkdownDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
