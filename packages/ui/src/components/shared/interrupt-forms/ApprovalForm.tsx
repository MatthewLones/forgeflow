import { useState } from 'react';
import type { ApprovalInterrupt, ApprovalAnswer } from '@forgeflow/types';
import { Md } from './MarkdownInline';
import { inputClass, btnPrimary, btnSecondary } from './styles';

export function ApprovalForm({ interrupt, onSubmit, disabled }: {
  interrupt: ApprovalInterrupt;
  onSubmit: (answer: ApprovalAnswer) => void;
  disabled: boolean;
}) {
  const [modifications, setModifications] = useState('');
  const [showModify, setShowModify] = useState(false);

  const handleDecision = (decision: 'approve' | 'reject' | 'modify') => {
    if (decision === 'modify') {
      setShowModify(true);
      return;
    }
    onSubmit({ decision });
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-[var(--color-text-primary)] bg-white border border-[var(--color-border)] rounded-lg p-3 leading-relaxed">
        <Md text={interrupt.proposal} />
      </div>
      {interrupt.evidence && interrupt.evidence.length > 0 && (
        <div className="space-y-1.5">
          {interrupt.evidence.map((e, i) => (
            <div key={i} className="text-xs text-[var(--color-text-muted)] pl-3 border-l-2 border-amber-300">
              <Md text={e} />
            </div>
          ))}
        </div>
      )}
      {!showModify ? (
        <div className="flex items-center gap-2">
          {interrupt.options.includes('approve') && (
            <button type="button" onClick={() => handleDecision('approve')} disabled={disabled} className={btnPrimary}>
              Approve
            </button>
          )}
          {interrupt.options.includes('reject') && (
            <button type="button" onClick={() => handleDecision('reject')} disabled={disabled} className={btnSecondary}>
              Reject
            </button>
          )}
          {interrupt.options.includes('modify') && (
            <button type="button" onClick={() => handleDecision('modify')} disabled={disabled} className={btnSecondary}>
              Modify
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={modifications}
            onChange={(e) => setModifications(e.target.value)}
            placeholder="Describe modifications..."
            rows={4}
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onSubmit({ decision: 'modify', modifications })} disabled={disabled || !modifications.trim()} className={btnPrimary}>
              Submit Modifications
            </button>
            <button type="button" onClick={() => setShowModify(false)} disabled={disabled} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
