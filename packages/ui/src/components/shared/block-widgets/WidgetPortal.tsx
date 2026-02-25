import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { SkillBlockType, SkillBlockData } from '../../../lib/skill-block-types';
import { OutputTableWidget } from './OutputTableWidget';
import { InputTableWidget } from './InputTableWidget';
import { DecisionTreeWidget } from './DecisionTreeWidget';
import { GuardrailWidget } from './GuardrailWidget';
import { buildFencedBlock } from './block-templates';

const FENCED_BLOCK_RE = /```forgeflow:([\w-]+)\n([\s\S]*?)```/g;

/**
 * Find the current position of a forgeflow block in the document.
 * Searches for the block matching the given type closest to hintFrom.
 * Returns [from, to] or null if not found.
 */
function findBlockRange(
  doc: string,
  blockType: SkillBlockType,
  hintFrom: number,
): [number, number] | null {
  const re = new RegExp(FENCED_BLOCK_RE.source, FENCED_BLOCK_RE.flags);
  let match: RegExpExecArray | null;
  let bestMatch: [number, number] | null = null;
  let bestDist = Infinity;

  while ((match = re.exec(doc)) !== null) {
    if (match[1] !== blockType) continue;
    const from = match.index;
    const to = from + match[0].length;
    const dist = Math.abs(from - hintFrom);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = [from, to];
    }
  }

  return bestMatch;
}

/**
 * Renders a React widget component inside a CodeMirror WidgetType.
 * Uses createRoot to mount a React tree into the DOM node returned by toDOM().
 *
 * Widget onChange is debounced (300ms) to prevent the CM transaction
 * from rebuilding decorations and destroying the React root mid-keystroke.
 */
export class SkillBlockWidget extends WidgetType {
  private root: Root | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private latestData: SkillBlockData;

  constructor(
    readonly blockType: SkillBlockType,
    readonly data: SkillBlockData,
    readonly blockFrom: number,
    readonly blockTo: number,
  ) {
    super();
    this.latestData = data;
  }

  eq(other: SkillBlockWidget): boolean {
    return (
      this.blockType === other.blockType &&
      this.blockFrom === other.blockFrom &&
      this.blockTo === other.blockTo &&
      JSON.stringify(this.data) === JSON.stringify(other.data)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = `cm-skill-block cm-skill-block-${this.blockType}`;
    container.setAttribute('data-block-type', this.blockType);

    // Prevent CodeMirror from handling keyboard events inside the widget
    container.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') return;
      e.stopPropagation();
    });

    // Prevent mousedown from moving CM cursor into/out of the widget
    container.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    this.root = createRoot(container);
    this.latestData = this.data;
    this.renderWidget(view);
    return container;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    this.latestData = this.data;
    this.renderWidget(view);
    return true;
  }

  destroy(dom: HTMLElement): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.root) {
      const root = this.root;
      this.root = null;
      setTimeout(() => root.unmount(), 0);
    }
  }

  private renderWidget(view: EditorView) {
    if (!this.root) return;

    const hintFrom = this.blockFrom;
    const blockType = this.blockType;
    const widget = this;

    const onChange = (newData: SkillBlockData) => {
      widget.latestData = newData;
      widget.renderWidget(view);

      if (widget.flushTimer) clearTimeout(widget.flushTimer);
      widget.flushTimer = setTimeout(() => {
        widget.flushTimer = null;
        const doc = view.state.doc.toString();
        const range = findBlockRange(doc, blockType, hintFrom);
        if (!range) return;

        const newBlock = buildFencedBlock(blockType, newData);
        view.dispatch({
          changes: { from: range[0], to: range[1], insert: newBlock },
        });
      }, 300);
    };

    const component = WIDGET_MAP[this.blockType];
    if (component) {
      this.root.render(createElement(component, { data: this.latestData, onChange }));
    }
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Map block types to their React widget components. */
const WIDGET_MAP: Record<SkillBlockType, React.FC<{ data: any; onChange: (data: any) => void }>> = {
  output: OutputTableWidget,
  input: InputTableWidget,
  decision: DecisionTreeWidget,
  guardrail: GuardrailWidget,
};
