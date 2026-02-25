import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { SkillBlockType, SkillBlockData } from '../../../lib/skill-block-types';
import { OutputTableWidget } from './OutputTableWidget';
import { InputTableWidget } from './InputTableWidget';
import { DecisionTreeWidget } from './DecisionTreeWidget';
import { GuardrailWidget } from './GuardrailWidget';
import { buildFencedBlock } from '../slash-commands/skill-block-templates';

/**
 * Renders a React widget component inside a CodeMirror WidgetType.
 * Uses createRoot to mount a React tree into the DOM node returned by toDOM().
 * Provides an onChange callback that updates the fenced block in the CM document.
 */
export class SkillBlockWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    readonly blockType: SkillBlockType,
    readonly data: SkillBlockData,
    readonly blockFrom: number,
    readonly blockTo: number,
  ) {
    super();
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
      // Allow Tab to exit the widget
      if (e.key === 'Tab') return;
      e.stopPropagation();
    });

    this.root = createRoot(container);
    this.render(view);
    return container;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    this.render(view);
    return true;
  }

  destroy(dom: HTMLElement): void {
    // Defer unmount to avoid React warnings about synchronous unmount
    if (this.root) {
      const root = this.root;
      this.root = null;
      setTimeout(() => root.unmount(), 0);
    }
  }

  private render(view: EditorView) {
    if (!this.root) return;

    const onChange = (newData: SkillBlockData) => {
      const newBlock = buildFencedBlock(this.blockType, newData);
      view.dispatch({
        changes: { from: this.blockFrom, to: this.blockTo, insert: newBlock },
      });
    };

    const component = WIDGET_MAP[this.blockType];
    if (component) {
      this.root.render(createElement(component, { data: this.data, onChange }));
    }
  }

  ignoreEvent(): boolean {
    // Let the widget handle its own mouse/keyboard events
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
