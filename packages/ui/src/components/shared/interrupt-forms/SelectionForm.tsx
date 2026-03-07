import { useState } from 'react';
import type { SelectionInterrupt, SelectionAnswer } from '@forgeflow/types';
import { Md } from './MarkdownInline';
import { btnPrimary } from './styles';

export function SelectionForm({ interrupt, onSubmit, disabled }: {
  interrupt: SelectionInterrupt;
  onSubmit: (answer: SelectionAnswer) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    const defaults = new Set<string>();
    for (const item of interrupt.items) {
      if (item.recommended) defaults.add(item.id);
    }
    return defaults;
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (interrupt.maxSelect != null && next.size >= interrupt.maxSelect) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const minMet = (interrupt.minSelect ?? 0) <= selected.size;
  const maxLabel = interrupt.maxSelect == null ? 'unlimited' : String(interrupt.maxSelect);

  return (
    <div className="space-y-3">
      <div className="text-xs text-[var(--color-text-muted)]">
        Select {interrupt.minSelect ?? 0}–{maxLabel} items
      </div>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {interrupt.items.map((item) => (
          <label
            key={item.id}
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              selected.has(item.id)
                ? 'border-amber-400 bg-amber-50'
                : 'border-[var(--color-border)] bg-white hover:bg-[var(--color-canvas-bg)]'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggle(item.id)}
              className="mt-0.5 rounded border-[var(--color-border)]"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[var(--color-text-primary)] flex items-center gap-1.5">
                <Md text={item.label} inline />
                {item.recommended && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                    recommended
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5"><Md text={item.description} /></div>
            </div>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onSubmit({ selected: Array.from(selected) })}
        disabled={disabled || !minMet}
        className={btnPrimary}
      >
        Confirm Selection ({selected.size})
      </button>
    </div>
  );
}
