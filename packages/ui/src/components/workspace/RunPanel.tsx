import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { EditorTab } from '../../context/LayoutContext';
import { useLayout } from '../../context/LayoutContext';
import type { ProgressEvent, ReviewInterrupt } from '@forgeflow/types';
import { useRun } from '../../context/RunContext';
import { useParams } from 'react-router-dom';
import { InterruptBanner } from './InterruptBanner';
import { TodoWidget } from '../shared/TodoWidget';
import { derivePhaseTodos } from '../../lib/derive-phase-todos';

/* ── Status config ─────────────────────────────────────── */

const STATUS_CONFIG = {
  idle: { label: 'Idle', color: 'bg-gray-400', text: 'text-gray-600' },
  starting: { label: 'Starting...', color: 'bg-blue-400', text: 'text-blue-600' },
  running: { label: 'Running', color: 'bg-blue-500 animate-pulse', text: 'text-blue-600' },
  awaiting_input: { label: 'Awaiting Input', color: 'bg-amber-500', text: 'text-amber-600' },
  completed: { label: 'Completed', color: 'bg-emerald-500', text: 'text-emerald-600' },
  failed: { label: 'Failed', color: 'bg-red-500', text: 'text-red-600' },
} as const;

/* ── Main panel ────────────────────────────────────────── */

export function RunPanel(_props: IDockviewPanelProps<EditorTab>) {
  const { run, answerInterrupt, pendingCheckpoint } = useRun();
  const { openTab } = useLayout();
  const { id: projectId } = useParams<{ id: string }>();

  const phaseTodos = useMemo(() => derivePhaseTodos(run.events), [run.events]);

  if (run.status === 'idle') {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Click "Run" to start flow execution
      </div>
    );
  }

  const isReviewInterrupt = run.pendingInterrupt?.type === 'review';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <RunHeader />
      {phaseTodos.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]">
          <TodoWidget todos={phaseTodos} isActive={run.status === 'running'} />
        </div>
      )}
      {run.pendingInterrupt && isReviewInterrupt && run.runId && (
        <ReviewNotificationBar
          interrupt={run.pendingInterrupt as ReviewInterrupt}
          runId={run.runId}
          onOpenReview={() => {
            openTab({
              id: `review-${run.pendingInterrupt!.interrupt_id}`,
              type: 'review',
              label: `Review: ${run.pendingInterrupt!.title}`,
              interruptData: {
                interrupt: run.pendingInterrupt as ReviewInterrupt,
                runId: run.runId!,
              },
            });
          }}
        />
      )}
      {run.pendingInterrupt && !isReviewInterrupt && (
        <InterruptBanner interrupt={run.pendingInterrupt} onSubmit={answerInterrupt} runId={run.runId ?? undefined} />
      )}
      {pendingCheckpoint && !run.pendingInterrupt && projectId && run.runId && (
        <a
          href={`/projects/${projectId}/runs/${run.runId}/checkpoint`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer"
        >
          <span className="animate-pulse w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span className="text-[11px] font-semibold text-amber-800 truncate">
            Checkpoint: {pendingCheckpoint.checkpoint.presentation?.title ?? pendingCheckpoint.checkpoint.checkpointNodeId}
          </span>
          <span className="ml-auto text-[10px] text-amber-600 shrink-0">
            Open &rarr;
          </span>
        </a>
      )}
      <EventList events={run.events} runId={run.runId} />
    </div>
  );
}

/* ── Header ────────────────────────────────────────────── */

function RunHeader() {
  const { run, retryRun } = useRun();
  const { id: projectId } = useParams<{ id: string }>();
  const [retrying, setRetrying] = useState(false);
  const config = STATUS_CONFIG[run.status];
  const phaseCount = run.completedPhases.length + (run.currentPhaseId ? 1 : 0);

  const handleRetry = useCallback(async () => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      await retryRun(projectId, 'local');
    } catch (err) {
      console.error('[RunPanel] retry failed:', err);
    } finally {
      setRetrying(false);
    }
  }, [projectId, retrying, retryRun]);

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-white">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${config.color}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${config.text}`}>
          {config.label}
        </span>
      </div>

      {run.status === 'failed' && projectId && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="px-2.5 py-1 text-[10px] font-medium bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {retrying ? 'Retrying...' : 'Retry Failed Phase'}
        </button>
      )}

      {run.reconnecting && (
        <span className="text-[10px] font-medium text-amber-500 animate-pulse">
          Reconnecting...
        </span>
      )}

      {run.runId && (
        <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
          {run.runId.slice(0, 8)}
        </span>
      )}

      <div className="ml-auto flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
        {phaseCount > 0 && (
          <span>
            <span className="font-medium text-[var(--color-text-primary)]">{phaseCount}</span> phase{phaseCount !== 1 ? 's' : ''}
          </span>
        )}
        {run.totalCost.usd > 0 && (
          <span>
            $<span className="font-medium text-[var(--color-text-primary)]">{run.totalCost.usd.toFixed(2)}</span>
          </span>
        )}
        {run.totalCost.turns > 0 && (
          <span>
            <span className="font-medium text-[var(--color-text-primary)]">{run.totalCost.turns}</span> turns
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Event list ────────────────────────────────────────── */

function EventList({ events, runId }: { events: ProgressEvent[]; runId: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selectOutput } = useLayout();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const handleFileClick = useCallback((fileName: string) => {
    if (runId) selectOutput(runId, fileName);
  }, [runId, selectOutput]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {events.length === 0 && (
        <div className="p-4 text-xs text-[var(--color-text-muted)] italic">
          Waiting for events...
        </div>
      )}
      {events.map((event, i) => (
        <EventItem key={i} event={event} onFileClick={handleFileClick} />
      ))}
    </div>
  );
}

/* ── Event item ────────────────────────────────────────── */

interface EventDisplay {
  icon: string;
  color: string;
  message: string;
  detail?: string;
  indent?: boolean;
  clickableFile?: string; // file name that can be clicked to open
}

function getEventDisplay(event: ProgressEvent): EventDisplay {
  switch (event.type) {
    case 'phase_started':
      return {
        icon: '\u25B6',
        color: 'text-blue-500',
        message: `Phase started: ${event.nodeName}`,
        detail: `Phase #${event.phaseNumber}`,
      };
    case 'phase_completed':
      return {
        icon: '\u2713',
        color: 'text-emerald-500',
        message: `Phase completed: ${event.nodeId}`,
        detail: event.outputFiles.length > 0
          ? `Output: ${event.outputFiles.join(', ')}`
          : undefined,
      };
    case 'phase_failed':
      return {
        icon: '\u2717',
        color: 'text-red-500',
        message: `Phase failed: ${event.nodeId}`,
        detail: event.error,
      };
    case 'checkpoint':
      return {
        icon: '\u23F8',
        color: 'text-amber-500',
        message: `Checkpoint: ${event.checkpoint.checkpointNodeId}`,
        detail: 'Awaiting human input',
      };
    case 'interrupt':
      return {
        icon: '\u26A0',
        color: 'text-amber-500',
        message: `Interrupt: ${event.interrupt.title}`,
        detail: event.interrupt.context,
      };
    case 'cost_update':
      return {
        icon: '$',
        color: 'text-gray-400',
        message: `Cost: ${event.turns} turns, $${event.usd.toFixed(2)}`,
      };
    case 'run_completed':
      return {
        icon: event.success ? '\u2713' : '\u2717',
        color: event.success ? 'text-emerald-500' : 'text-red-500',
        message: event.success ? 'Run completed successfully' : 'Run failed',
        detail: `Total: ${event.totalCost.turns} turns, $${event.totalCost.usd.toFixed(2)}`,
      };
    case 'child_started':
      return {
        icon: '\u25B7',
        color: 'text-blue-400',
        message: `Child started: ${event.childName}`,
        indent: true,
      };
    case 'child_completed':
      return {
        icon: '\u2713',
        color: 'text-emerald-400',
        message: `Child completed: ${event.childName}`,
        detail: event.outputFiles.length > 0
          ? `Output: ${event.outputFiles.join(', ')}`
          : undefined,
        indent: true,
      };
    case 'file_written':
      return {
        icon: '\u25A1',
        color: 'text-gray-400',
        message: `${event.fileName}`,
        detail: `${formatFileSize(event.fileSize)}`,
        indent: true,
        clickableFile: event.fileName,
      };
    case 'message':
      return {
        icon: '\u2022',
        color: 'text-gray-400',
        message: event.content,
      };
    case 'resume':
      return {
        icon: '\u25B6',
        color: 'text-blue-500',
        message: `Resumed from checkpoint: ${event.checkpointNodeId}`,
      };
    case 'escalation_timeout':
      return {
        icon: '\u23F1',
        color: 'text-amber-500',
        message: `Escalation timeout on ${event.nodeId}`,
        detail: `Timeout: ${event.timeoutMs}ms`,
      };
    case 'interrupt_answered':
      return {
        icon: '\u2713',
        color: 'text-emerald-500',
        message: `Interrupt answered: ${event.interruptId}`,
        detail: event.escalated ? 'Escalated' : undefined,
      };
    default:
      return { icon: '\u2022', color: 'text-gray-400', message: 'Unknown event' };
  }
}

function EventItem({ event, onFileClick }: { event: ProgressEvent; onFileClick: (fileName: string) => void }) {
  const display = getEventDisplay(event);

  return (
    <div className={`flex items-start gap-2 px-4 py-1 hover:bg-[var(--color-canvas-bg)] transition-colors ${display.indent ? 'pl-8' : ''}`}>
      <span className={`text-[10px] mt-0.5 shrink-0 ${display.color} font-bold`}>
        {display.icon}
      </span>
      <div className="flex-1 min-w-0">
        {display.clickableFile ? (
          <button
            type="button"
            onClick={() => onFileClick(display.clickableFile!)}
            className="text-xs text-[var(--color-node-agent)] hover:underline cursor-pointer"
          >
            {display.message}
          </button>
        ) : (
          <span className="text-xs text-[var(--color-text-primary)]">{display.message}</span>
        )}
        {display.detail && (
          <span className="text-[10px] text-[var(--color-text-muted)] ml-2">
            {display.detail}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Review notification bar ───────────────────────────── */

function ReviewNotificationBar({
  interrupt,
  runId: _runId,
  onOpenReview,
}: {
  interrupt: ReviewInterrupt;
  runId: string;
  onOpenReview: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-amber-300 bg-amber-50">
      <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
      <span className="text-xs font-medium text-amber-800 truncate">
        Review requested: {interrupt.title}
      </span>
      <span className="text-[10px] font-mono text-amber-600 truncate">
        {interrupt.draftFile}
      </span>
      <button
        type="button"
        onClick={onOpenReview}
        className="ml-auto shrink-0 text-xs font-medium px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
      >
        Open Review
      </button>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────── */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
