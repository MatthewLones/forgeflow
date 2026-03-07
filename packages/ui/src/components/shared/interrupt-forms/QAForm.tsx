import { useState } from 'react';
import type { QAInterrupt, QAAnswer } from '@forgeflow/types';
import { Md } from './MarkdownInline';
import { inputClass, btnPrimary } from './styles';

export function QAForm({ interrupt, onSubmit, disabled }: {
  interrupt: QAInterrupt;
  onSubmit: (answer: QAAnswer) => void;
  disabled: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>(() => {
    const defaults: Record<string, string | number | boolean> = {};
    for (const q of interrupt.questions) {
      if (q.defaultValue !== undefined) {
        defaults[q.id] = q.defaultValue;
      } else if (q.inputType === 'boolean') {
        defaults[q.id] = false;
      } else if (q.inputType === 'number') {
        defaults[q.id] = 0;
      } else {
        defaults[q.id] = '';
      }
    }
    return defaults;
  });

  const updateAnswer = (id: string, value: string | number | boolean) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const allRequiredFilled = interrupt.questions.every((q) => {
    if (!q.required) return true;
    const val = answers[q.id];
    if (typeof val === 'string') return val.trim().length > 0;
    return val !== undefined;
  });

  return (
    <div className="space-y-4">
      {interrupt.questions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-primary)]">
            <Md text={q.label} inline />
            {q.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {q.context && (
            <div className="text-[11px] text-[var(--color-text-muted)]"><Md text={q.context} /></div>
          )}
          {q.inputType === 'text' && (
            <input
              type="text"
              value={(answers[q.id] as string) ?? ''}
              onChange={(e) => updateAnswer(q.id, e.target.value)}
              className={inputClass}
            />
          )}
          {q.inputType === 'number' && (
            <input
              type="number"
              value={(answers[q.id] as number) ?? 0}
              onChange={(e) => updateAnswer(q.id, parseFloat(e.target.value) || 0)}
              className={inputClass}
            />
          )}
          {q.inputType === 'choice' && q.options && (
            <select
              value={(answers[q.id] as string) ?? ''}
              onChange={(e) => updateAnswer(q.id, e.target.value)}
              className={inputClass}
            >
              <option value="">Select...</option>
              {q.options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
          {q.inputType === 'boolean' && (
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={!!answers[q.id]}
                onChange={(e) => updateAnswer(q.id, e.target.checked)}
                className="rounded border-[var(--color-border)]"
              />
              Yes
            </label>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onSubmit({ answers })}
        disabled={disabled || !allRequiredFilled}
        className={btnPrimary}
      >
        Submit Answers
      </button>
    </div>
  );
}
