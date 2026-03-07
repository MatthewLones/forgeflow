import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { ProgressEvent } from '@forgeflow/types';
import { VerbosityToggle, type VerbosityLevel } from './VerbosityToggle';
import { ActivityIndicator } from './ActivityIndicator';

/* ── Verbosity filtering ──────────────────────────────── */

const COMPACT_TYPES = new Set([
  'phase_started', 'phase_completed', 'phase_failed',
  'run_completed', 'interrupt', 'checkpoint', 'resume',
]);

const STANDARD_TYPES = new Set([
  ...COMPACT_TYPES,
  'file_written', 'child_started', 'child_completed',
  'message', 'cost_update', 'escalation_timeout', 'interrupt_answered',
]);

// Verbose = all events

function isVisible(event: ProgressEvent, level: VerbosityLevel, nodeFilter: string | null): boolean {
  if (nodeFilter) {
    const nodeId = 'nodeId' in event ? (event as { nodeId?: string }).nodeId : null;
    if (nodeId && nodeId !== nodeFilter) return false;
  }
  // Rate limit events are always visible — they're critical operational info
  if (event.type === 'rate_limited') return true;
  // In verbose mode, hide 'message' events since 'text_block' covers the same content with more detail
  if (level === 'verbose') return event.type !== 'message';
  if (level === 'standard') return STANDARD_TYPES.has(event.type);
  return COMPACT_TYPES.has(event.type);
}

/* ── Event display ────────────────────────────────────── */

interface EventDisplay {
  icon: string;
  color: string;
  message: string;
  detail?: string;
  indent?: boolean;
  chipFile?: string;
  chipNode?: string;
  chipTool?: string;
  expandable?: string;
}

function getEventDisplay(event: ProgressEvent): EventDisplay {
  switch (event.type) {
    case 'phase_started':
      return { icon: '\u25B6', color: 'text-blue-500', message: `Phase started: ${event.nodeName}`, detail: `Phase #${event.phaseNumber}`, chipNode: event.nodeId };
    case 'phase_completed':
      return { icon: '\u2713', color: 'text-emerald-500', message: `Phase completed: ${event.nodeId}`, detail: event.outputFiles.length > 0 ? `Output: ${event.outputFiles.join(', ')}` : undefined, chipNode: event.nodeId };
    case 'phase_failed':
      return { icon: '\u2717', color: 'text-red-500', message: `Phase failed: ${event.nodeId}`, detail: event.error, chipNode: event.nodeId };
    case 'checkpoint':
      return { icon: '\u23F8', color: 'text-amber-500', message: `Checkpoint: ${event.checkpoint.checkpointNodeId}`, detail: 'Awaiting human input' };
    case 'interrupt':
      return { icon: '\u26A0', color: 'text-amber-500', message: `Interrupt: ${event.interrupt.title}`, detail: event.interrupt.context };
    case 'cost_update':
      return { icon: '$', color: 'text-gray-400', message: `Cost: ${event.turns} turns, $${event.usd.toFixed(2)}` };
    case 'run_completed':
      return { icon: event.success ? '\u2713' : '\u2717', color: event.success ? 'text-emerald-500' : 'text-red-500', message: event.success ? 'Run completed successfully' : 'Run failed', detail: `Total: ${event.totalCost.turns} turns, $${event.totalCost.usd.toFixed(2)}` };
    case 'child_started':
      return { icon: '\u25B7', color: 'text-blue-400', message: `Child started: ${event.childName}`, indent: true };
    case 'child_completed':
      return { icon: '\u2713', color: 'text-emerald-400', message: `Child completed: ${event.childName}`, detail: event.outputFiles.length > 0 ? `Output: ${event.outputFiles.join(', ')}` : undefined, indent: true };
    case 'file_written':
      return { icon: '\u25A1', color: 'text-gray-400', message: event.fileName, detail: formatFileSize(event.fileSize), indent: true, chipFile: event.fileName, chipNode: event.nodeId };
    case 'message':
      return { icon: '\u2022', color: 'text-gray-400', message: event.content.length > 200 ? event.content.slice(0, 200) + '...' : event.content };
    case 'resume':
      return { icon: '\u25B6', color: 'text-blue-500', message: `Resumed from checkpoint: ${event.checkpointNodeId}` };
    case 'escalation_timeout':
      return { icon: '\u23F1', color: 'text-amber-500', message: `Escalation timeout on ${event.nodeId}`, detail: `Timeout: ${event.timeoutMs}ms` };
    case 'interrupt_answered':
      return { icon: '\u2713', color: 'text-emerald-500', message: `Interrupt answered: ${event.interruptId}`, detail: event.escalated ? 'Escalated' : undefined };
    // Verbose events
    case 'tool_call':
      return { icon: '\u2692', color: 'text-indigo-500', message: `Tool call: ${event.toolName}`, detail: event.inputSummary.length > 100 ? event.inputSummary.slice(0, 100) + '...' : event.inputSummary, indent: true, chipTool: event.toolName, expandable: event.inputSummary };
    case 'tool_result':
      return { icon: event.isError ? '\u2717' : '\u2190', color: event.isError ? 'text-red-400' : 'text-indigo-400', message: `Tool result: ${event.toolName}`, detail: event.outputSummary.length > 100 ? event.outputSummary.slice(0, 100) + '...' : event.outputSummary, indent: true, chipTool: event.toolName, expandable: event.outputSummary };
    case 'text_block':
      return { icon: '\u2022', color: 'text-gray-500', message: event.content.length > 200 ? event.content.slice(0, 200) + '...' : event.content, detail: event.truncated ? `(${event.charCount} chars total)` : undefined, expandable: event.content.length > 200 ? event.content : undefined };
    case 'prompt_compiled':
      return { icon: '\u2699', color: 'text-purple-500', message: `Prompt compiled: ${event.promptChars} chars`, detail: event.childPromptCount > 0 ? `${event.childPromptCount} child prompts (${event.childPromptTotalChars} chars)` : undefined, chipNode: event.nodeId };
    case 'workspace_prepared':
      return { icon: '\u{1F4C2}', color: 'text-purple-400', message: `Workspace prepared`, detail: `${event.inputFileCount} inputs, ${event.skillCount} skills`, chipNode: event.nodeId };
    case 'skill_loaded':
      return { icon: '\u{1F4D6}', color: 'text-purple-400', message: `Skill loaded: ${event.skillName}`, detail: `${event.fileCount} files`, chipNode: event.nodeId };
    case 'output_validated':
      return { icon: event.valid ? '\u2713' : '\u26A0', color: event.valid ? 'text-emerald-400' : 'text-amber-400', message: `Output validation: ${event.foundCount}/${event.expectedCount} found`, detail: event.missingFiles.length > 0 ? `Missing: ${event.missingFiles.join(', ')}` : undefined, chipNode: event.nodeId };
    case 'rate_limited':
      return { icon: '\u23F3', color: 'text-amber-500', message: `Rate limited — retrying in ${(event.waitMs / 1000).toFixed(0)}s`, detail: `Attempt ${event.retryAttempt}/${event.maxRetries}`, chipNode: event.nodeId };
    default:
      return { icon: '\u2022', color: 'text-gray-400', message: 'Unknown event' };
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Component ────────────────────────────────────────── */

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function EventStream({
  events,
  nodeFilter,
  isRunning = false,
  isDone = false,
  startedAt,
  currentPhase,
  onNodeClick,
  onFileClick,
  onViewSummary,
}: {
  events: ProgressEvent[];
  nodeFilter: string | null;
  isRunning?: boolean;
  isDone?: boolean;
  startedAt?: number | null;
  currentPhase?: string | null;
  onNodeClick: (nodeId: string | null) => void;
  onFileClick: (fileName: string, nodeId?: string) => void;
  onViewSummary?: () => void;
}) {
  const [verbosity, setVerbosity] = useState<VerbosityLevel>('standard');
  const [pinToBottom, setPinToBottom] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Elapsed timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    // Compute initial elapsed right away
    setElapsed(Date.now() - startedAt);
    if (isDone) return; // Freeze when done
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [startedAt, isDone]);

  useEffect(() => {
    if (pinToBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, pinToBottom]);

  // Re-pin to bottom when container is resized (e.g. dragging panel handle)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinToBottom) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pinToBottom]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (atBottom !== pinToBottom) setPinToBottom(atBottom);
  }, [pinToBottom]);

  const toggleExpand = useCallback((idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const filtered = events.map((e, i) => ({ event: e, index: i })).filter(({ event }) => isVisible(event, verbosity, nodeFilter));

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-b border-[var(--color-border)] bg-white">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Events</span>
        <VerbosityToggle value={verbosity} onChange={setVerbosity} />
        {nodeFilter && (
          <button
            type="button"
            onClick={() => onNodeClick(null)}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
          >
            Filtered: {nodeFilter} &times;
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {startedAt != null && elapsed > 0 && (
            <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{formatElapsed(elapsed)}</span>
          )}
          <span className="text-[10px] text-[var(--color-text-muted)]">{filtered.length} events</span>
          <button
            type="button"
            onClick={() => setPinToBottom(!pinToBottom)}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${pinToBottom ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-400'}`}
          >
            Auto-scroll
          </button>
        </div>
      </div>

      {/* Event list */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-4 text-xs text-[var(--color-text-muted)] italic">
            {events.length === 0 ? 'Waiting for events...' : 'No events match current filters'}
          </div>
        )}
        {filtered.map(({ event, index }) => {
          const display = getEventDisplay(event);
          const isExpanded = expanded.has(index);

          return (
            <div
              key={index}
              className={`flex items-start gap-2 px-3 py-1 hover:bg-[var(--color-canvas-bg)] transition-colors ${display.indent ? 'pl-7' : ''}`}
            >
              <span className={`text-[10px] mt-0.5 shrink-0 ${display.color} font-bold`}>
                {display.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  {display.chipNode && (
                    <button
                      type="button"
                      onClick={() => onNodeClick(display.chipNode!)}
                      className="text-[9px] px-1.5 py-0 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium"
                    >
                      {display.chipNode}
                    </button>
                  )}
                  {display.chipFile && (
                    <button
                      type="button"
                      onClick={() => onFileClick(display.chipFile!, display.chipNode ?? undefined)}
                      className="text-[9px] px-1.5 py-0 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium"
                    >
                      {display.chipFile}
                    </button>
                  )}
                  {display.chipTool && (
                    <span className="text-[9px] px-1.5 py-0 rounded-full bg-indigo-50 text-indigo-600 font-medium">
                      {display.chipTool}
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-text-primary)]">{display.message}</span>
                  {display.detail && !isExpanded && (
                    <span className="text-[10px] text-[var(--color-text-muted)]">{display.detail}</span>
                  )}
                  {display.expandable && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(index)}
                      className="text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    >
                      {isExpanded ? '\u25BC' : '\u25B6'}
                    </button>
                  )}
                </div>
                {isExpanded && display.expandable && (
                  <pre className="mt-1 p-2 text-[10px] bg-gray-50 rounded border border-gray-100 overflow-x-auto max-h-48 text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">
                    {display.expandable}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
        {isRunning && (
          <div className="px-3 py-2">
            <ActivityIndicator phase={currentPhase ?? undefined} />
          </div>
        )}
        {isDone && !isRunning && events.length > 0 && (() => {
          const lastRunComplete = [...events].reverse().find((e) => e.type === 'run_completed') as (ProgressEvent & { type: 'run_completed' }) | undefined;
          const success = lastRunComplete?.success ?? false;
          return (
            <div className={`mx-3 my-2 p-3 rounded border ${success ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${success ? 'text-emerald-600' : 'text-red-600'}`}>
                  {success ? '\u2713 Run Completed' : '\u2717 Run Failed'}
                </span>
                {lastRunComplete && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {lastRunComplete.totalCost.turns} turns &middot; ${lastRunComplete.totalCost.usd.toFixed(2)}
                  </span>
                )}
                {onViewSummary && (
                  <button
                    type="button"
                    onClick={onViewSummary}
                    className={`ml-auto text-xs font-medium px-2.5 py-1 rounded ${success ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-red-600 text-white hover:bg-red-700'}`}
                  >
                    View Summary
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
