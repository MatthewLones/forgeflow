import { useState } from 'react';
import type {
  Interrupt,
  InterruptAnswer,
  ApprovalInterrupt,
  ApprovalAnswer,
  QAInterrupt,
  QAAnswer,
  SelectionInterrupt,
  SelectionAnswer,
  ReviewInterrupt,
  ReviewAnswer,
  EscalationInterrupt,
  EscalationAnswer,
} from '@forgeflow/types';

interface InterruptBannerProps {
  interrupt: Interrupt;
  onSubmit: (answer: InterruptAnswer) => Promise<void>;
}

export function InterruptBanner({ interrupt, onSubmit }: InterruptBannerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (answer: InterruptAnswer) => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-amber-300 bg-amber-50">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-200">
        <span className="text-amber-600 font-bold text-xs">{'\u26A0'}</span>
        <span className="text-xs font-semibold text-amber-800">{interrupt.title}</span>
        <span className="ml-auto text-[10px] font-mono text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
          {interrupt.mode}
        </span>
      </div>

      {/* Context */}
      <div className="px-4 py-1.5 text-[11px] text-amber-700">
        {interrupt.context}
      </div>

      {/* Source path */}
      {interrupt.source.agentPath.length > 0 && (
        <div className="px-4 pb-1.5 text-[10px] text-amber-500 font-mono">
          {interrupt.source.agentPath.join(' / ')}
        </div>
      )}

      {/* Form */}
      <div className="px-4 py-2">
        {interrupt.type === 'approval' && (
          <ApprovalForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
        )}
        {interrupt.type === 'qa' && (
          <QAForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
        )}
        {interrupt.type === 'selection' && (
          <SelectionForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
        )}
        {interrupt.type === 'review' && (
          <ReviewForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
        )}
        {interrupt.type === 'escalation' && (
          <EscalationForm interrupt={interrupt} onSubmit={handleSubmit} disabled={submitting} />
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 pb-2 text-[11px] text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

/* ── Shared styles ─────────────────────────────────────── */

const inputClass = 'w-full text-xs px-2 py-1.5 border border-[var(--color-border)] rounded bg-white focus:border-amber-500 focus:outline-none transition-colors';
const btnBase = 'text-xs font-medium px-3 py-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimary = `${btnBase} bg-amber-600 text-white hover:bg-amber-700`;
const btnSecondary = `${btnBase} border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]`;

/* ── Approval Form ─────────────────────────────────────── */

function ApprovalForm({ interrupt, onSubmit, disabled }: {
  interrupt: ApprovalInterrupt;
  onSubmit: (answer: ApprovalAnswer) => Promise<void>;
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

  const handleModifySubmit = () => {
    onSubmit({ decision: 'modify', modifications });
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--color-text-primary)] bg-white border border-[var(--color-border)] rounded p-2">
        {interrupt.proposal}
      </div>
      {interrupt.evidence && interrupt.evidence.length > 0 && (
        <div className="space-y-1">
          {interrupt.evidence.map((e, i) => (
            <div key={i} className="text-[10px] text-[var(--color-text-muted)] pl-2 border-l-2 border-amber-300">
              {e}
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
            rows={3}
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleModifySubmit} disabled={disabled || !modifications.trim()} className={btnPrimary}>
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

/* ── Q&A Form ──────────────────────────────────────────── */

function QAForm({ interrupt, onSubmit, disabled }: {
  interrupt: QAInterrupt;
  onSubmit: (answer: QAAnswer) => Promise<void>;
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
    <div className="space-y-3">
      {interrupt.questions.map((q) => (
        <div key={q.id} className="space-y-1">
          <label className="text-xs font-medium text-[var(--color-text-primary)]">
            {q.label}
            {q.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {q.context && (
            <div className="text-[10px] text-[var(--color-text-muted)]">{q.context}</div>
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

/* ── Selection Form ────────────────────────────────────── */

function SelectionForm({ interrupt, onSubmit, disabled }: {
  interrupt: SelectionInterrupt;
  onSubmit: (answer: SelectionAnswer) => Promise<void>;
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
    <div className="space-y-2">
      <div className="text-[10px] text-[var(--color-text-muted)]">
        Select {interrupt.minSelect ?? 0}–{maxLabel} items
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {interrupt.items.map((item) => (
          <label
            key={item.id}
            className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors ${
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
                {item.label}
                {item.recommended && (
                  <span className="text-[9px] px-1 py-px rounded bg-amber-100 text-amber-700 font-medium">
                    recommended
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)]">{item.description}</div>
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

/* ── Review Form ───────────────────────────────────────── */

function ReviewForm({ interrupt, onSubmit, disabled }: {
  interrupt: ReviewInterrupt;
  onSubmit: (answer: ReviewAnswer) => Promise<void>;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-[var(--color-text-muted)]">
        {interrupt.instructions}
      </div>
      <div className="text-xs bg-white border border-[var(--color-border)] rounded p-2 font-mono">
        <span className="text-[10px] text-[var(--color-text-muted)]">Draft file: </span>
        <span className="text-[var(--color-text-primary)]">{interrupt.draftFile}</span>
        <span className="text-[10px] text-[var(--color-text-muted)] ml-2">({interrupt.format})</span>
      </div>
      {!editing ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSubmit({ accepted: true })}
            disabled={disabled}
            className={btnPrimary}
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={disabled}
            className={btnSecondary}
          >
            Edit & Reject
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            placeholder="Paste your edited content..."
            rows={6}
            className={`${inputClass} font-mono`}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSubmit({ accepted: false, editedContent })}
              disabled={disabled || !editedContent.trim()}
              className={btnPrimary}
            >
              Submit Edits
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={disabled} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Escalation Form ───────────────────────────────────── */

const SEVERITY_STYLES = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
} as const;

function EscalationForm({ interrupt, onSubmit, disabled }: {
  interrupt: EscalationInterrupt;
  onSubmit: (answer: EscalationAnswer) => Promise<void>;
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_STYLES[interrupt.severity]}`}>
          {interrupt.severity}
        </span>
      </div>
      <div className="text-xs text-[var(--color-text-primary)] bg-white border border-[var(--color-border)] rounded p-2">
        {interrupt.finding}
      </div>
      {interrupt.evidence.length > 0 && (
        <div className="space-y-1">
          {interrupt.evidence.map((e, i) => (
            <div key={i} className="text-[10px] text-[var(--color-text-muted)] pl-2 border-l-2 border-amber-300">
              {e}
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-[var(--color-text-muted)]">
        Suggested: {interrupt.suggestedAction}
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
            rows={2}
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
