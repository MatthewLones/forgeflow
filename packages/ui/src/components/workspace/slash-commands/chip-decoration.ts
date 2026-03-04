import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, Facet } from '@codemirror/state';
import { INTERRUPT_DESCRIPTIONS } from '../../../lib/chip-styles';

/* ── Tooltip data facet ─────────────────────────────────── */

export interface ChipTooltipData {
  skills: Map<string, string>;
  artifacts: Map<string, string>;
  agents: Map<string, string>;
}

const emptyTooltipData: ChipTooltipData = {
  skills: new Map(),
  artifacts: new Map(),
  agents: new Map(),
};

export const chipTooltipFacet = Facet.define<ChipTooltipData, ChipTooltipData>({
  combine: (values) => values[0] ?? emptyTooltipData,
});

/* ── Static fallback decorations (no tooltips) ──────────── */

const skillDeco = Decoration.mark({ class: 'cm-chip cm-chip-skill' });
const agentDeco = Decoration.mark({ class: 'cm-chip cm-chip-agent' });
const mergeDeco = Decoration.mark({ class: 'cm-chip cm-chip-merge' });
const interruptDeco = Decoration.mark({ class: 'cm-chip cm-chip-interrupt' });
const artifactDeco = Decoration.mark({ class: 'cm-chip cm-chip-artifact' });
const artifactOutputDeco = Decoration.mark({ class: 'cm-chip cm-chip-artifact-output' });

type ChipKind = 'skill' | 'agent' | 'merge' | 'interrupt' | 'artifact' | 'artifact-output';

interface PatternEntry {
  regex: RegExp;
  deco: Decoration;
  kind: ChipKind;
}

const PATTERNS: PatternEntry[] = [
  { regex: /\/skill:([\w-]+)/g, deco: skillDeco, kind: 'skill' },
  { regex: /\/\/agent:([\w-]+)/g, deco: agentDeco, kind: 'agent' },
  { regex: /\/merge\b/g, deco: mergeDeco, kind: 'merge' },
  { regex: /\/interrupt:(approval|qa|selection|review|escalation)\b/g, deco: interruptDeco, kind: 'interrupt' },
  { regex: /\\([\w._/-]+)/g, deco: artifactOutputDeco, kind: 'artifact-output' },
  { regex: /@([\w._/-]+)/g, deco: artifactDeco, kind: 'artifact' },
];

/** Exported for the atomic-backspace handler */
export const CHIP_PATTERNS = PATTERNS;

/* ── Decoration builder ─────────────────────────────────── */

const KIND_TO_CLASS: Record<ChipKind, string> = {
  skill: 'cm-chip cm-chip-skill',
  agent: 'cm-chip cm-chip-agent',
  merge: 'cm-chip cm-chip-merge',
  interrupt: 'cm-chip cm-chip-interrupt',
  artifact: 'cm-chip cm-chip-artifact',
  'artifact-output': 'cm-chip cm-chip-artifact-output',
};

function getTooltip(kind: ChipKind, name: string, tooltipData: ChipTooltipData): string | undefined {
  switch (kind) {
    case 'skill': return tooltipData.skills.get(name);
    case 'agent': return tooltipData.agents.get(name);
    case 'artifact':
    case 'artifact-output': return tooltipData.artifacts.get(name);
    case 'interrupt': return INTERRUPT_DESCRIPTIONS[name];
    default: return undefined;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tooltipData = view.state.facet(chipTooltipFacet);
  const hasTooltips = tooltipData.skills.size > 0 || tooltipData.artifacts.size > 0 || tooltipData.agents.size > 0;
  const ranges: { from: number; to: number; deco: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);

    for (const { regex, deco, kind } of PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const entityName = match[1] ?? '';
        const tooltip = hasTooltips ? getTooltip(kind, entityName, tooltipData) : undefined;

        const finalDeco = tooltip
          ? Decoration.mark({
              class: KIND_TO_CLASS[kind],
              attributes: { 'data-tooltip': tooltip },
            })
          : deco;

        ranges.push({
          from: from + match.index,
          to: from + match.index + match[0].length,
          deco: finalDeco,
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
