import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import { useCopilot, type CopilotMessage, type CopilotToolCall, type TodoItem, type PendingQuestion } from '../../context/CopilotContext';
import { useFlow } from '../../context/FlowContext';
import { useProjectStore } from '../../context/ProjectStore';
import { useLayout, type WorkspaceSelection } from '../../context/LayoutContext';
import { VerbosityToggle, type VerbosityLevel } from '../run-dashboard/VerbosityToggle';
import { ActivityIndicator } from '../run-dashboard/ActivityIndicator';

/* ── File context chip ────────────────────────────────── */

function selectionChip(selection: WorkspaceSelection): { icon: string; label: string } | null {
  if (!selection) return null;
  switch (selection.type) {
    case 'agent': return { icon: '//', label: selection.nodeId };
    case 'skill': return { icon: '/', label: selection.skillName };
    case 'reference': return { icon: '@', label: selection.refPath.split('/').pop() ?? selection.refPath };
    case 'artifact': return { icon: '@', label: selection.artifactName };
    default: return null;
  }
}

/* ── Markdown renderer with interactive chips ─────────── */

/** Chip style tokens — matches CodeMirror slash-command chip palette */
const CHIP_STYLES = {
  interrupt: { color: '#dc2626', bg: 'rgba(239, 68, 68, 0.12)' },
  skill:     { color: '#059669', bg: 'rgba(16, 185, 129, 0.12)' },
  artifact:  { color: '#7c3aed', bg: 'rgba(139, 92, 246, 0.12)' },
  agent:     { color: '#2563eb', bg: 'rgba(59, 130, 246, 0.12)' },
} as const;

const CHIP_BASE_STYLE = 'display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:4px;font-size:12px;font-weight:500;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer;';

interface KnownEntities {
  nodeIds: Set<string>;
  skillNames: Set<string>;
  artifactNames: Set<string>;
  interruptTypes: Set<string>;
}

function renderMarkdown(text: string, entities?: KnownEntities): string {
  let html = marked.parse(text, { async: false }) as string;

  const { interrupt, skill, artifact, agent } = CHIP_STYLES;

  // Build a set of all known interrupt type names
  const interruptSet = entities?.interruptTypes ?? new Set(['review', 'approval', 'qa', 'selection']);

  // Convert <code>entity</code> tags into colored chips when they match known entities.
  // This catches backtick-wrapped references like `node_id`, `skill_name`, `artifact_name`.
  html = html.replace(/<code>([^<]+)<\/code>/g, (_match, inner: string) => {
    const trimmed = inner.trim();
    const lower = trimmed.toLowerCase();

    // Check interrupt types
    if (interruptSet.has(lower)) {
      return `<span class="forge-chip" data-chip-type="interrupt" data-chip-value="${lower}" style="${CHIP_BASE_STYLE}color:${interrupt.color};background:${interrupt.bg};">/interrupt:${lower}</span>`;
    }
    // Check node IDs (agents)
    if (entities?.nodeIds.has(trimmed)) {
      return `<span class="forge-chip" data-chip-type="agent" data-chip-value="${trimmed}" style="${CHIP_BASE_STYLE}color:${agent.color};background:${agent.bg};">//agent:${trimmed}</span>`;
    }
    // Check skill names
    if (entities?.skillNames.has(trimmed)) {
      return `<span class="forge-chip" data-chip-type="skill" data-chip-value="${trimmed}" style="${CHIP_BASE_STYLE}color:${skill.color};background:${skill.bg};">/skill:${trimmed}</span>`;
    }
    // Check artifact names
    if (entities?.artifactNames.has(trimmed)) {
      return `<span class="forge-chip" data-chip-type="artifact" data-chip-value="${trimmed}" style="${CHIP_BASE_STYLE}color:${artifact.color};background:${artifact.bg};">@${trimmed}</span>`;
    }

    // Not a known entity — keep as regular code
    return _match;
  });

  return html;
}

/* ── Main Component ───────────────────────────────────── */

export function AISidePanel() {
  const { state, sendMessage, answerQuestion, stop, reset } = useCopilot();
  const { state: flowState } = useFlow();
  const { skills: availableSkills } = useProjectStore();
  const [input, setInput] = useState('');
  const [verbosity, setVerbosity] = useState<VerbosityLevel>('standard');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { selection, selectAgent, selectSkill, selectArtifact } = useLayout();
  const chip = selectionChip(selection);

  const isActive = state.status === 'active';
  const isWaiting = state.status === 'waiting_answer';

  // Build known entities from the flow for chip rendering.
  // Also scan copilot tool calls for entities the copilot just created
  // (they may not be in the flow state yet due to async reload timing).
  const knownEntities = useMemo<KnownEntities>(() => {
    const nodeIds = new Set<string>();
    function collectNodes(nodes: Array<{ id: string; children: Array<{ id: string; children: unknown[] }> }>) {
      for (const n of nodes) {
        nodeIds.add(n.id);
        if (n.children) collectNodes(n.children as typeof nodes);
      }
    }
    collectNodes(flowState.flow.nodes);

    const skillNames = new Set(availableSkills.map((s) => s.name));
    const artifactNames = new Set(Object.keys(flowState.flow.artifacts ?? {}));

    // Also collect node outputs as artifact names
    function collectOutputs(nodes: Array<{ config: { outputs?: Array<string | { name: string }> }; children: unknown[] }>) {
      for (const n of nodes) {
        for (const o of n.config.outputs ?? []) {
          artifactNames.add(typeof o === 'string' ? o : o.name);
        }
        if (Array.isArray(n.children)) collectOutputs(n.children as typeof nodes);
      }
    }
    collectOutputs(flowState.flow.nodes);

    // Scan copilot tool calls for entities the copilot just created/mentioned
    // This ensures chips render immediately even before flow reload completes
    for (const msg of state.messages) {
      if (!msg.toolCalls) continue;
      for (const tc of msg.toolCalls) {
        const name = tc.toolName;
        const summary = tc.inputSummary ?? '';
        if (name === 'mcp__forgeflow__add_node' || name === 'mcp__forgeflow__update_node' || name === 'mcp__forgeflow__add_child') {
          // inputSummary typically starts with the node id or contains it
          const idMatch = summary.match(/^"?(\w+)"?/);
          if (idMatch) nodeIds.add(idMatch[1]);
        } else if (name === 'mcp__forgeflow__create_skill' || name === 'mcp__forgeflow__update_skill') {
          const skillMatch = summary.match(/^"?([a-z][\w-]*)"?/);
          if (skillMatch) skillNames.add(skillMatch[1]);
        }
      }
    }
    // Also scan pending tool calls
    for (const tc of state.pendingToolCalls) {
      const name = tc.toolName;
      const summary = tc.inputSummary ?? '';
      if (name === 'mcp__forgeflow__add_node' || name === 'mcp__forgeflow__update_node' || name === 'mcp__forgeflow__add_child') {
        const idMatch = summary.match(/^"?(\w+)"?/);
        if (idMatch) nodeIds.add(idMatch[1]);
      } else if (name === 'mcp__forgeflow__create_skill' || name === 'mcp__forgeflow__update_skill') {
        const skillMatch = summary.match(/^"?([a-z][\w-]*)"?/);
        if (skillMatch) skillNames.add(skillMatch[1]);
      }
    }

    const interruptTypes = new Set(['review', 'approval', 'qa', 'selection']);

    return { nodeIds, skillNames, artifactNames, interruptTypes };
  }, [flowState.flow.nodes, flowState.flow.artifacts, availableSkills, state.messages, state.pendingToolCalls]);

  // Auto-resize textarea — grows up to 240px then scrolls
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxH = 240;
    if (ta.scrollHeight > maxH) {
      ta.style.height = `${maxH}px`;
      ta.style.overflowY = 'auto';
    } else {
      ta.style.height = `${ta.scrollHeight}px`;
      ta.style.overflowY = 'hidden';
    }
  }, [input]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [state.messages, state.pendingText, state.pendingToolCalls, state.todos, scrollToBottom]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isActive) return;
    setInput('');
    await sendMessage(text);
  }, [input, isActive, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const costLabel = useMemo(() => {
    if (state.totalCostUsd <= 0) return null;
    return `$${state.totalCostUsd.toFixed(4)}`;
  }, [state.totalCostUsd]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 h-10 flex items-center gap-2 px-3 border-b border-[var(--color-border)] bg-[var(--color-canvas-bg)]">
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          isActive ? 'bg-[var(--color-node-agent)] animate-pulse' :
          state.status === 'error' ? 'bg-red-500' :
          isWaiting ? 'bg-amber-500' :
          'bg-[var(--color-node-agent)]'
        }`} />
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          Forge
        </span>
        {costLabel && (
          <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
            {costLabel}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <VerbosityToggle value={verbosity} onChange={setVerbosity} />
          {isActive && (
            <button
              type="button"
              onClick={stop}
              className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-gray-50 transition-colors"
            title="Reset session"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Sticky todo widget — visible above scroll area while agent works */}
      {state.todos.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]">
          <TodoWidget todos={state.todos} isActive={isActive} />
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
        onClick={(e) => {
          // Delegated click handler for interactive chips — opens the corresponding editor tab
          const chipEl = (e.target as HTMLElement).closest('.forge-chip') as HTMLElement | null;
          if (!chipEl) return;
          const chipType = chipEl.dataset.chipType;
          const chipValue = chipEl.dataset.chipValue;
          if (!chipType || !chipValue) return;
          if (chipType === 'agent') {
            selectAgent(chipValue, chipValue);
          } else if (chipType === 'skill') {
            selectSkill(chipValue);
          } else if (chipType === 'artifact') {
            selectArtifact(chipValue);
          } else if (chipType === 'interrupt') {
            // No dedicated tab for interrupt types — no-op
          }
        }}
      >
        {state.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} verbosity={verbosity} entities={knownEntities} />
        ))}

        {/* Streaming content (not yet flushed into a message) */}
        {(state.pendingText || state.pendingToolCalls.length > 0) && (
          <div className="flex flex-col items-start">
            {state.pendingText && (
              <div className="max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed bg-[var(--color-canvas-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)]">
                <div className="prose-copilot" dangerouslySetInnerHTML={{ __html: renderMarkdown(state.pendingText, knownEntities) }} />
                {isActive && state.pendingToolCalls.length === 0 && <span className="animate-pulse text-[var(--color-node-agent)]">|</span>}
              </div>
            )}
            {verbosity !== 'compact' && state.pendingToolCalls.length > 0 && (
              <ToolCallList toolCalls={state.pendingToolCalls} verbosity={verbosity} />
            )}
          </div>
        )}

        {/* Pending question */}
        {state.pendingQuestion && (
          <QuestionWidget
            question={state.pendingQuestion}
            onAnswer={(qId, answer) => answerQuestion(qId, answer)}
          />
        )}

        {/* Activity indicator — always show while active */}
        {isActive && (
          <ActivityIndicator />
        )}

        {/* Error display */}
        {state.status === 'error' && state.error && (
          <div className="rounded-lg px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-700">
            <div className="font-medium mb-1">Something went wrong</div>
            <div className="text-[10px] text-red-600 font-mono break-words">{state.error}</div>
            <button
              type="button"
              onClick={() => sendMessage('Continue from where you left off.')}
              className="mt-2 text-[10px] px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[var(--color-border)] p-2">
        {/* removed starter prompts — professional tool, clean input */}
        <div className="flex items-end gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas-bg)] px-3 py-2 focus-within:border-[var(--color-node-agent)] transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build or change..."
            rows={1}
            className="flex-1 resize-none bg-transparent text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none leading-relaxed overflow-hidden"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || isActive}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-[var(--color-node-agent)] text-white disabled:opacity-30 transition-opacity text-xs mb-px"
          >
            ↑
          </button>
        </div>
        {/* Active file context chip */}
        {chip && (
          <div className="flex items-center gap-1 mt-1 px-1">
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
              <span className="w-3.5 h-3.5 rounded flex items-center justify-center bg-gray-100 text-[8px] font-bold text-gray-400 uppercase leading-none">
                {chip.icon}
              </span>
              <span className="font-mono truncate max-w-[200px]">{chip.label}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Message Bubble ───────────────────────────────────── */

function MessageBubble({ message, verbosity, entities }: { message: CopilotMessage; verbosity: VerbosityLevel; entities?: KnownEntities }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      {message.content && (
        <div
          className={`max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
            isUser
              ? 'bg-blue-100 text-blue-900 whitespace-pre-wrap'
              : 'bg-[var(--color-canvas-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)]'
          }`}
        >
          {isUser ? (
            message.content
          ) : (
            <div className="prose-copilot" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content, entities) }} />
          )}
        </div>
      )}

      {/* Tool calls */}
      {verbosity !== 'compact' && message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallList toolCalls={message.toolCalls} verbosity={verbosity} />
      )}
    </div>
  );
}

/* ── Tool Call List ────────────────────────────────────── */

function ToolCallList({ toolCalls, verbosity }: { toolCalls: CopilotToolCall[]; verbosity: VerbosityLevel }) {
  return (
    <div className="mt-1.5 space-y-1 max-w-[90%]">
      {toolCalls.map((tool) => (
        <div
          key={tool.toolUseId}
          className="flex flex-col gap-0.5 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-canvas-bg)] border border-[var(--color-border)] rounded px-2 py-1"
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                tool.status === 'done'
                  ? 'bg-[var(--color-node-merge)]'
                  : tool.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-[var(--color-node-checkpoint)] animate-pulse'
              }`}
            />
            <span className="font-mono font-medium">{tool.toolName}</span>
            {verbosity === 'standard' && tool.inputSummary && (
              <span className="text-[var(--color-text-muted)] truncate">
                — {tool.inputSummary}
              </span>
            )}
          </div>
          {verbosity === 'verbose' && (
            <>
              {tool.inputSummary && (
                <div className="pl-3 text-[9px] text-[var(--color-text-muted)] font-mono truncate">
                  in: {tool.inputSummary}
                </div>
              )}
              {tool.outputSummary && (
                <div className="pl-3 text-[9px] text-[var(--color-text-muted)] font-mono truncate">
                  out: {tool.outputSummary}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Todo Widget ──────────────────────────────────────── */

function TodoWidget({ todos, isActive }: { todos: TodoItem[]; isActive: boolean }) {
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const allDone = completed === total;
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

  return (
    <div className={`rounded-lg border bg-[var(--color-canvas-bg)] transition-colors duration-300 ${
      allDone ? 'border-green-200' : 'border-[var(--color-border)]'
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
            stroke={allDone ? '#16a34a' : '#2563eb'}
            strokeWidth="2"
            strokeDasharray={`${2 * Math.PI * 6}`}
            strokeDashoffset={`${2 * Math.PI * 6 * (1 - completed / total)}`}
            strokeLinecap="round"
            className="transition-all duration-500"
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
          {allDone && (
            <path d="M5 8l2 2 4-4" fill="none" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        <span className="text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Tasks
        </span>
        <span className={`text-[10px] font-mono ${allDone ? 'text-green-600' : 'text-[var(--color-text-muted)]'}`}>
          {completed}/{total}
        </span>
        <span className={`ml-auto text-[9px] text-[var(--color-text-muted)] transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
          ▾
        </span>
      </button>

      {/* Task list — collapsible */}
      {!collapsed && (
        <div className="px-3 pb-2 space-y-0.5">
          {todos.map((todo, i) => (
            <div
              key={i}
              className={`flex items-start gap-1.5 text-[11px] py-0.5 transition-opacity duration-300 ${
                todo.status === 'completed' ? 'opacity-60' : 'opacity-100'
              }`}
            >
              <span className="shrink-0 mt-0.5 w-3 flex items-center justify-center">
                {todo.status === 'completed' ? (
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <circle cx="6" cy="6" r="5" fill="#dcfce7" stroke="#16a34a" strokeWidth="1" />
                    <path d="M3.5 6l2 2 3-3.5" fill="none" stroke="#16a34a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : todo.status === 'in_progress' ? (
                  <span className="w-3 h-3 inline-block border-[1.5px] border-blue-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span className="w-2.5 h-2.5 inline-block rounded-full border border-gray-300" />
                )}
              </span>
              <span className={`leading-snug ${
                todo.status === 'completed'
                  ? 'text-[var(--color-text-muted)] line-through'
                  : todo.status === 'in_progress'
                    ? 'text-[var(--color-text-primary)] font-medium'
                    : 'text-[var(--color-text-secondary)]'
              }`}>
                {todo.status === 'in_progress' ? todo.activeForm : todo.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Question Widget ──────────────────────────────────── */

function QuestionWidget({
  question,
  onAnswer,
}: {
  question: PendingQuestion;
  onAnswer: (questionId: string, answer: string) => void;
}) {
  const [textInput, setTextInput] = useState('');
  const [showOther, setShowOther] = useState(false);
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const q = question.questions[0]; // handle first question
  if (!q) return null;

  // Normalize options — SDK may send strings or { label, description } objects
  const options = (q.options ?? []).map((opt) =>
    typeof opt === 'string' ? { label: opt, description: undefined } : opt,
  );
  const hasOptions = options.length > 0;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5">
      <div className="text-xs font-medium text-[var(--color-text-primary)] mb-2">
        {q.question}
      </div>

      {hasOptions ? (
        <div className="space-y-1">
          {options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAnswer(question.questionId, opt.label)}
              className="w-full text-left px-2.5 py-1.5 rounded border border-[var(--color-border)] bg-white text-xs hover:border-[var(--color-node-agent)] hover:bg-blue-50/50 transition-colors"
            >
              <div className="font-medium text-[var(--color-text-primary)]">
                {opt.label}
              </div>
              {opt.description && (
                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                  {opt.description}
                </div>
              )}
            </button>
          ))}

          {/* "Other" option — always last */}
          {!showOther ? (
            <button
              type="button"
              onClick={() => {
                setShowOther(true);
                setTimeout(() => otherRef.current?.focus(), 50);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded border border-dashed border-[var(--color-border)] bg-white text-xs hover:border-[var(--color-node-agent)] hover:bg-blue-50/50 transition-colors"
            >
              <div className="font-medium text-[var(--color-text-muted)]">Other...</div>
              <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                Type a custom response
              </div>
            </button>
          ) : (
            <div className="rounded border border-[var(--color-node-agent)] bg-white px-2.5 py-1.5">
              <textarea
                ref={otherRef}
                value={textInput}
                onChange={(e) => {
                  setTextInput(e.target.value);
                  // Auto-expand
                  const ta = e.target;
                  ta.style.height = 'auto';
                  ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && textInput.trim()) {
                    e.preventDefault();
                    onAnswer(question.questionId, textInput.trim());
                    setTextInput('');
                    setShowOther(false);
                  }
                }}
                placeholder="Type your answer..."
                rows={1}
                className="w-full resize-none bg-transparent text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none leading-relaxed overflow-hidden"
              />
              <div className="flex items-center justify-end gap-1.5 mt-1">
                <button
                  type="button"
                  onClick={() => { setShowOther(false); setTextInput(''); }}
                  className="text-[10px] px-2 py-1 rounded text-[var(--color-text-muted)] hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (textInput.trim()) {
                      onAnswer(question.questionId, textInput.trim());
                      setTextInput('');
                      setShowOther(false);
                    }
                  }}
                  disabled={!textInput.trim()}
                  className="text-[10px] px-2 py-1 rounded bg-[var(--color-node-agent)] text-white disabled:opacity-30"
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <textarea
            value={textInput}
            onChange={(e) => {
              setTextInput(e.target.value);
              const ta = e.target;
              ta.style.height = 'auto';
              ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && textInput.trim()) {
                e.preventDefault();
                onAnswer(question.questionId, textInput.trim());
                setTextInput('');
              }
            }}
            placeholder="Type your answer..."
            rows={1}
            className="flex-1 resize-none text-xs px-2 py-1.5 border border-[var(--color-border)] rounded bg-white outline-none focus:border-[var(--color-node-agent)] overflow-hidden leading-relaxed"
          />
          <button
            type="button"
            onClick={() => {
              if (textInput.trim()) {
                onAnswer(question.questionId, textInput.trim());
                setTextInput('');
              }
            }}
            disabled={!textInput.trim()}
            className="text-[10px] px-2 py-1.5 rounded bg-[var(--color-node-agent)] text-white disabled:opacity-30"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

