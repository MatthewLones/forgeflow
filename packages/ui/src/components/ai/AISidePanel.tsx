import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import { useCopilot, type CopilotMessage, type CopilotToolCall, type TodoItem, type PendingQuestion } from '../../context/CopilotContext';
import { useLayout, type WorkspaceSelection } from '../../context/LayoutContext';
import { VerbosityToggle, type VerbosityLevel } from '../run-dashboard/VerbosityToggle';
import { ActivityIndicator } from '../run-dashboard/ActivityIndicator';

/* ── File context chip ────────────────────────────────── */

function selectionChip(selection: WorkspaceSelection): { icon: string; label: string } | null {
  if (!selection) return null;
  switch (selection.type) {
    case 'agent': return { icon: 'a', label: selection.nodeId };
    case 'skill': return { icon: 's', label: selection.skillName };
    case 'reference': return { icon: 'r', label: selection.refPath.split('/').pop() ?? selection.refPath };
    case 'artifact': return { icon: 'f', label: selection.artifactName };
    default: return null;
  }
}

/* ── Markdown renderer ────────────────────────────────── */

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

/* ── Main Component ───────────────────────────────────── */

export function AISidePanel() {
  const { state, sendMessage, answerQuestion, stop, reset } = useCopilot();
  const [input, setInput] = useState('');
  const [verbosity, setVerbosity] = useState<VerbosityLevel>('standard');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { selection } = useLayout();
  const chip = selectionChip(selection);

  const isActive = state.status === 'active';
  const isWaiting = state.status === 'waiting_answer';

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {state.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} verbosity={verbosity} />
        ))}

        {/* Streaming content (not yet flushed into a message) */}
        {(state.pendingText || state.pendingToolCalls.length > 0) && (
          <div className="flex flex-col items-start">
            {state.pendingText && (
              <div className="max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed bg-[var(--color-canvas-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)]">
                <div className="prose-copilot" dangerouslySetInnerHTML={{ __html: renderMarkdown(state.pendingText) }} />
                {isActive && <span className="animate-pulse text-[var(--color-node-agent)]">|</span>}
              </div>
            )}
            {verbosity !== 'compact' && state.pendingToolCalls.length > 0 && (
              <ToolCallList toolCalls={state.pendingToolCalls} verbosity={verbosity} />
            )}
          </div>
        )}

        {/* Todos */}
        {state.todos.length > 0 && (
          <TodoWidget todos={state.todos} />
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
            {state.error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[var(--color-border)] p-2">
        <div className="flex items-end gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas-bg)] px-3 py-2 focus-within:border-[var(--color-node-agent)] transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Forge anything..."
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

function MessageBubble({ message, verbosity }: { message: CopilotMessage; verbosity: VerbosityLevel }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      {message.content && (
        <div
          className={`max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
            isUser
              ? 'bg-[var(--color-node-agent)] text-white whitespace-pre-wrap'
              : 'bg-[var(--color-canvas-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)]'
          }`}
        >
          {isUser ? (
            message.content
          ) : (
            <div className="prose-copilot" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
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

function TodoWidget({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas-bg)] px-3 py-2">
      <div className="text-[10px] font-semibold text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider">
        Tasks
      </div>
      <div className="space-y-1">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[11px]">
            <span className="shrink-0 mt-0.5">
              {todo.status === 'completed' ? (
                <span className="text-green-600">&#10003;</span>
              ) : todo.status === 'in_progress' ? (
                <span className="w-2.5 h-2.5 inline-block border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="w-2.5 h-2.5 inline-block rounded-full border border-gray-300" />
              )}
            </span>
            <span className={`${
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
  const q = question.questions[0]; // handle first question
  if (!q) return null;

  const hasOptions = q.options && q.options.length > 0;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5">
      <div className="text-xs font-medium text-[var(--color-text-primary)] mb-2">
        {q.question}
      </div>

      {hasOptions ? (
        <div className="space-y-1">
          {q.options!.map((opt, i) => (
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
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && textInput.trim()) {
                onAnswer(question.questionId, textInput.trim());
                setTextInput('');
              }
            }}
            placeholder="Type your answer..."
            className="flex-1 text-xs px-2 py-1.5 border border-[var(--color-border)] rounded bg-white outline-none focus:border-[var(--color-node-agent)]"
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
