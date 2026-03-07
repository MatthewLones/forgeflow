import { useState, useEffect, useRef } from 'react';

/* ── Types ────────────────────────────────────────────── */

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  activeForm: string;
  /** Nested subtasks reported by the agent */
  subtasks?: Array<{ id: string; label: string; status: 'pending' | 'in_progress' | 'completed' }>;
}

/* ── Status Icon ─────────────────────────────────────── */

function StatusIcon({ status, size = 12 }: { status: string; size?: number }) {
  if (status === 'completed') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="5" fill="#dcfce7" stroke="#16a34a" strokeWidth="1" />
        <path d="M3.5 6l2 2 3-3.5" fill="none" stroke="#16a34a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="5" fill="#fee2e2" stroke="#dc2626" strokeWidth="1" />
        <path d="M4 4l4 4M8 4l-4 4" fill="none" stroke="#dc2626" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" className="animate-spin">
        <circle cx="6" cy="6" r="4.5" fill="none" stroke="#dbeafe" strokeWidth="1.5" />
        <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return <span className="w-2.5 h-2.5 inline-block rounded-full border border-gray-300" />;
}

/* ── TodoWidget ───────────────────────────────────────── */

export function TodoWidget({ todos, isActive, fillHeight }: { todos: TodoItem[]; isActive: boolean; fillHeight?: boolean }) {
  const completed = todos.filter((t) => t.status === 'completed').length;
  const failed = todos.filter((t) => t.status === 'failed').length;
  const done = completed + failed;
  const total = todos.length;
  const allDone = done === total;
  const hasFailed = failed > 0;
  const [collapsed, setCollapsed] = useState(false);

  // Auto-collapse when all tasks complete and agent is idle
  useEffect(() => {
    if (allDone && !isActive) {
      const timer = setTimeout(() => setCollapsed(true), 1200);
      return () => clearTimeout(timer);
    }
    // Re-expand if new tasks arrive
    if (!allDone) setCollapsed(false);
  }, [allDone, isActive]);

  const ringColor = allDone
    ? (hasFailed ? '#dc2626' : '#16a34a')
    : '#2563eb';

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to keep the active (in_progress) task visible
  useEffect(() => {
    if (!scrollRef.current) return;
    const active = scrollRef.current.querySelector('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [todos]);

  return (
    <div className={`rounded-lg border bg-[var(--color-canvas-bg)] transition-colors duration-300 ${
      fillHeight ? 'h-full flex flex-col' : ''
    } ${
      allDone
        ? (hasFailed ? 'border-red-200' : 'border-green-200')
        : 'border-[var(--color-border)]'
    }`}>
      {/* Header — always visible, clickable to toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50/50 transition-colors rounded-lg"
      >
        {/* Progress ring */}
        <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
          <circle
            cx="8" cy="8" r="6" fill="none"
            stroke="var(--color-border)" strokeWidth="2"
          />
          <circle
            cx="8" cy="8" r="6" fill="none"
            stroke={ringColor}
            strokeWidth="2"
            strokeDasharray={`${2 * Math.PI * 6}`}
            strokeDashoffset={`${2 * Math.PI * 6 * (1 - done / total)}`}
            strokeLinecap="round"
            className="transition-all duration-500"
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
          {allDone && !hasFailed && (
            <path d="M5 8l2 2 4-4" fill="none" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {allDone && hasFailed && (
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" />
          )}
        </svg>
        <span className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Tasks
        </span>
        <span className={`text-[10px] font-mono ${
          allDone
            ? (hasFailed ? 'text-red-600' : 'text-green-600')
            : 'text-[var(--color-text-muted)]'
        }`}>
          {done}/{total}
        </span>
        <span className={`ml-auto text-[9px] text-[var(--color-text-muted)] transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
          ▾
        </span>
      </button>

      {/* Task list — collapsible, scrollable */}
      {!collapsed && (
        <div ref={scrollRef} className={`px-3 pb-2 space-y-0.5 overflow-y-auto ${fillHeight ? 'flex-1 min-h-0' : 'max-h-[40vh]'}`}>
          {todos.map((todo, i) => {
            const showSubtasks = todo.subtasks && todo.subtasks.length > 0 && (
              todo.status === 'in_progress' || todo.status === 'completed'
            );

            return (
              <div key={i} data-active={todo.status === 'in_progress' ? 'true' : undefined}>
                {/* Phase row */}
                <div
                  className={`flex items-start gap-1.5 text-[11px] py-0.5 transition-opacity duration-300 ${
                    todo.status === 'completed' || todo.status === 'failed' ? 'opacity-60' : 'opacity-100'
                  }`}
                >
                  <span className="shrink-0 mt-0.5 w-3 flex items-center justify-center">
                    <StatusIcon status={todo.status} />
                  </span>
                  <span className={`leading-snug ${
                    todo.status === 'completed'
                      ? 'text-[var(--color-text-muted)] line-through'
                      : todo.status === 'failed'
                        ? 'text-red-500 line-through'
                        : todo.status === 'in_progress'
                          ? 'text-[var(--color-text-primary)] font-medium'
                          : 'text-[var(--color-text-secondary)]'
                  }`}>
                    {todo.status === 'in_progress' ? todo.activeForm : todo.content}
                  </span>
                </div>

                {/* Subtask rows — indented */}
                {showSubtasks && (
                  <div className="pl-6 space-y-0.5 mt-0.5">
                    {todo.subtasks!.map((sub) => (
                      <div
                        key={sub.id}
                        className={`flex items-start gap-1.5 text-[10px] py-0.5 transition-opacity duration-300 ${
                          sub.status === 'completed' ? 'opacity-50' : 'opacity-100'
                        }`}
                      >
                        <span className="shrink-0 mt-0.5 w-2.5 flex items-center justify-center">
                          <StatusIcon status={sub.status} size={10} />
                        </span>
                        <span className={`leading-snug ${
                          sub.status === 'completed'
                            ? 'text-[var(--color-text-muted)] line-through'
                            : sub.status === 'in_progress'
                              ? 'text-[var(--color-text-primary)]'
                              : 'text-[var(--color-text-secondary)]'
                        }`}>
                          {sub.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
