import { useCallback } from 'react';
import type { InterruptConfig, InterruptType, InterruptMode } from '@forgeflow/types';

interface InterruptEditorProps {
  interrupts: InterruptConfig[];
  onChange: (interrupts: InterruptConfig[]) => void;
}

const INTERRUPT_TYPES: InterruptType[] = ['approval', 'qa', 'selection', 'review', 'escalation'];

export function InterruptEditor({ interrupts, onChange }: InterruptEditorProps) {
  const addInterrupt = useCallback(() => {
    onChange([...interrupts, { type: 'approval' }]);
  }, [interrupts, onChange]);

  const removeInterrupt = useCallback(
    (index: number) => onChange(interrupts.filter((_, i) => i !== index)),
    [interrupts, onChange],
  );

  const updateInterrupt = useCallback(
    (index: number, updates: Partial<InterruptConfig>) => {
      onChange(interrupts.map((item, i) => (i === index ? { ...item, ...updates } : item)));
    },
    [interrupts, onChange],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Interrupts</label>
        <button
          type="button"
          onClick={addInterrupt}
          className="text-xs text-[var(--color-node-agent)] hover:underline"
        >
          + Add
        </button>
      </div>
      {interrupts.length === 0 && (
        <div className="text-xs text-[var(--color-text-muted)] italic">No interrupts configured</div>
      )}
      <div className="space-y-2">
        {interrupts.map((interrupt, i) => (
          <div key={i} className="flex items-center gap-2 p-2 border border-[var(--color-border)] rounded-md bg-white">
            <select
              value={interrupt.type}
              onChange={(e) => updateInterrupt(i, { type: e.target.value as InterruptType })}
              className="text-xs border border-[var(--color-border)] rounded px-1.5 py-1 bg-white"
            >
              {INTERRUPT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={interrupt.mode ?? 'inline'}
              onChange={(e) => updateInterrupt(i, { mode: e.target.value as InterruptMode })}
              className="text-xs border border-[var(--color-border)] rounded px-1.5 py-1 bg-white"
            >
              <option value="inline">inline</option>
              <option value="checkpoint">checkpoint</option>
            </select>
            <button
              type="button"
              onClick={() => removeInterrupt(i)}
              className="ml-auto text-xs text-[var(--color-text-muted)] hover:text-red-500"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
