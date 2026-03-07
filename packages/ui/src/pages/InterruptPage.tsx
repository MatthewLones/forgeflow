import { useParams, useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import { useRun, type InterruptHistoryEntry } from '../context/RunContext';
import { InterruptFormRouter } from '../components/shared/interrupt-forms';
import type { InterruptAnswer } from '@forgeflow/types';

/* ── Type badge colors ────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  approval: 'bg-blue-100 text-blue-700',
  qa: 'bg-violet-100 text-violet-700',
  selection: 'bg-teal-100 text-teal-700',
  review: 'bg-amber-100 text-amber-700',
  escalation: 'bg-red-100 text-red-700',
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  );
}

/* ── Answer summary (collapsed history) ───────────────── */

function AnswerSummary({ entry }: { entry: InterruptHistoryEntry }) {
  const { answer, interrupt } = entry;
  if (!answer) return <span className="text-[10px] text-[var(--color-text-muted)] italic">No answer recorded</span>;

  if (interrupt.type === 'approval' && 'decision' in answer) {
    return <span className="text-[11px]">Decision: <strong>{answer.decision}</strong></span>;
  }
  if (interrupt.type === 'qa' && 'answers' in answer) {
    const entries = Object.entries(answer.answers);
    return (
      <span className="text-[11px]">
        {entries.map(([k, v], i) => (
          <span key={k}>{k}: <strong>{String(v)}</strong>{i < entries.length - 1 ? ', ' : ''}</span>
        ))}
      </span>
    );
  }
  if (interrupt.type === 'selection' && 'selected' in answer) {
    return <span className="text-[11px]">Selected: <strong>{(answer.selected as string[]).join(', ')}</strong></span>;
  }
  if (interrupt.type === 'review' && 'accepted' in answer) {
    return <span className="text-[11px]">{answer.accepted ? 'Accepted' : 'Edited & resubmitted'}</span>;
  }
  if (interrupt.type === 'escalation' && 'action' in answer) {
    return <span className="text-[11px]">Action: <strong>{answer.action}</strong></span>;
  }
  return <span className="text-[10px] text-[var(--color-text-muted)]">Answered</span>;
}

/* ── InterruptPage ────────────────────────────────────── */

export function InterruptPage() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const navigate = useNavigate();
  const { run, interruptHistory, answerInterrupt } = useRun();

  const isLive = run.status === 'running' || run.status === 'starting' || run.status === 'awaiting_input';
  const pending = run.pendingInterrupt;
  const answeredHistory = interruptHistory;

  const handleSubmit = async (answer: InterruptAnswer) => {
    await answerInterrupt(answer);
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--color-canvas-bg)]">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-white border-b border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => navigate(`/projects/${projectId}/runs/${runId}`)}
          className="text-xs font-medium text-[var(--color-node-agent)] hover:text-blue-700 flex items-center gap-1"
        >
          <span>&larr;</span>
          <span>Back to Run</span>
        </button>
        <div className="w-px h-4 bg-[var(--color-border)]" />
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          Interrupts ({interruptHistory.length})
        </span>
        {isLive && (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
          {/* Current pending interrupt */}
          {pending ? (
            <div className="rounded-lg border-2 border-amber-300 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-200 bg-amber-50">
                <span className="animate-pulse w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                <span className="text-sm font-semibold text-amber-800">{pending.title}</span>
                <TypeBadge type={pending.type} />
                {pending.source.agentPath.length > 0 && (
                  <span className="ml-auto text-[10px] font-mono text-[var(--color-text-muted)]">
                    {pending.source.agentPath.join(' / ')}
                  </span>
                )}
              </div>
              <div
                className="px-5 py-2 text-xs text-[var(--color-text-secondary)] border-b border-amber-100 bg-amber-50/30 prose-skill"
                dangerouslySetInnerHTML={{ __html: marked.parse(pending.context ?? '', { async: false }) as string }}
              />
              <div className="p-5">
                <InterruptFormRouter
                  interrupt={pending}
                  onSubmit={handleSubmit}
                  runId={run.runId ?? undefined}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center">
              <div className="text-sm text-[var(--color-text-muted)]">
                {interruptHistory.length === 0
                  ? 'No interrupts yet'
                  : 'No active interrupt'}
              </div>
              {isLive && interruptHistory.length === 0 && (
                <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
                  Interrupts will appear here when the agent needs your input.
                </div>
              )}
            </div>
          )}

          {/* History */}
          {answeredHistory.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                History
              </h3>
              {[...answeredHistory].reverse().map((entry, i) => (
                <div
                  key={entry.interrupt.id}
                  className="rounded-lg border border-[var(--color-border)] bg-white overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-[var(--color-border)]">
                    <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                      #{answeredHistory.length - i}
                    </span>
                    {entry.status === 'answered' ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                        <circle cx="6" cy="6" r="5" fill="#dcfce7" stroke="#16a34a" strokeWidth="1" />
                        <path d="M3.5 6l2 2 3-3.5" fill="none" stroke="#16a34a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                        <circle cx="6" cy="6" r="5" fill="#fef3c7" stroke="#d97706" strokeWidth="1" />
                        <path d="M6 3.5v3M6 8v.5" fill="none" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    )}
                    <TypeBadge type={entry.interrupt.type} />
                    <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                      {entry.interrupt.title}
                    </span>
                  </div>
                  <div className="px-4 py-2 text-[var(--color-text-secondary)]">
                    <AnswerSummary entry={entry} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
