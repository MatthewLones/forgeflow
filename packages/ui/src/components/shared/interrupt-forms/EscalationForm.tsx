import { useState } from 'react';
import type { EscalationInterrupt, EscalationAnswer } from '@forgeflow/types';
import { Md } from './MarkdownInline';
import { inputClass, btnPrimary, btnSecondary } from './styles';

const SEVERITY_STYLES = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
} as const;

export function EscalationForm({ interrupt, onSubmit, disabled }: {
  interrupt: EscalationInterrupt;
  onSubmit: (answer: EscalationAnswer) => void;
  disabled: boolean;
}) {
  const [action, setAction] = useState<'acknowledge' | 'override' | 'route' | null>(null);
  const [notes, setNotes] = useState('');
  const [routedTo, setRoutedTo] = useState(interrupt.routeTo ?? '');

  const handleSubmit = () => {
    if (!action) return;
    const answer: EscalationAnswer = { action };
    if (notes.trim()) answer.notes = notes;
    if (action === 'route' && routedTo.trim()) answer.routedTo = routedTo;
    onSubmit(answer);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_STYLES[interrupt.severity]}`}>
          {interrupt.severity}
        </span>
      </div>
      <div className="text-sm text-[var(--color-text-primary)] bg-white border border-[var(--color-border)] rounded-lg p-3 leading-relaxed">
        <Md text={interrupt.finding} />
      </div>
      {interrupt.evidence.length > 0 && (
        <div className="space-y-1.5">
          {interrupt.evidence.map((e, i) => (
            <div key={i} className="text-xs text-[var(--color-text-muted)] pl-3 border-l-2 border-amber-300">
              <Md text={e} />
            </div>
          ))}
        </div>
      )}
      <div className="text-xs text-[var(--color-text-muted)]">
        Suggested: <Md text={interrupt.suggestedAction} inline />
      </div>

      <div className="flex items-center gap-2">
        {(['acknowledge', 'override', 'route'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAction(a)}
            disabled={disabled}
            className={action === a ? btnPrimary : btnSecondary}
          >
            {a.charAt(0).toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>

      {action === 'route' && (
        <input
          type="text"
          value={routedTo}
          onChange={(e) => setRoutedTo(e.target.value)}
          placeholder="Route to..."
          className={inputClass}
        />
      )}

      {action && (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)..."
            rows={3}
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled || (action === 'route' && !routedTo.trim())}
            className={btnPrimary}
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
