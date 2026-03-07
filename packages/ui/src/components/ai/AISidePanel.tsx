import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import { useCopilot, type CopilotMessage, type CopilotToolCall, type PendingQuestion, type ChatMeta } from '../../context/CopilotContext';
import { TodoWidget, type TodoItem } from '../shared/TodoWidget';
import { useFlow } from '../../context/FlowContext';
import { useProjectStore } from '../../context/ProjectStore';
import { useLayout, type WorkspaceSelection } from '../../context/LayoutContext';
import { VerbosityToggle, type VerbosityLevel } from '../run-dashboard/VerbosityToggle';
import { ActivityIndicator } from '../run-dashboard/ActivityIndicator';
import { chipInlineStyle, INTERRUPT_DESCRIPTIONS, artifactTooltip as buildArtifactTooltip, escapeAttr } from '../../lib/chip-styles';

/* ── File context chip ────────────────────────────────── */

function selectionChip(selection: WorkspaceSelection): { icon: string; label: string } | null {
  if (!selection) return null;
  switch (selection.type) {
    case 'agent': return { icon: 'a', label: selection.nodeId };
    case 'skill': return { icon: 's', label: selection.skillName };
    case 'reference': return { icon: 'f', label: selection.refPath.split('/').pop() ?? selection.refPath };
    case 'artifact': return { icon: 'f', label: selection.artifactName };
    default: return null;
  }
}

/* ── Markdown renderer with interactive chips ─────────── */

interface KnownEntities {
  nodeIds: Set<string>;
  nodeDescriptions: Map<string, string>;
  skillNames: Set<string>;
  skillDescriptions: Map<string, string>;
  artifactNames: Set<string>;
  artifactTooltips: Map<string, string>;
  interruptTypes: Set<string>;
}

function ttAttr(text: string | undefined): string {
  if (!text) return '';
  return ` data-tooltip="${escapeAttr(text)}"`;
}

function chipSpan(type: string, value: string, label: string, chipType: 'interrupt' | 'skill' | 'artifact' | 'agent', tooltip?: string): string {
  return `<span class="forge-chip" data-chip-type="${type}" data-chip-value="${value}"${ttAttr(tooltip)} style="${chipInlineStyle(chipType)}">${label}</span>`;
}

function renderMarkdown(text: string, entities?: KnownEntities): string {
  let html = marked.parse(text, { async: false }) as string;

  // Build a set of all known interrupt type names
  const interruptSet = entities?.interruptTypes ?? new Set(['review', 'approval', 'qa', 'selection']);

  // 1. Convert raw /interrupt:type patterns into chips (before code tag matching)
  html = html.replace(/\/interrupt:(review|approval|qa|selection|escalation)/g, (_match, type: string) => {
    const lower = type.toLowerCase();
    return chipSpan('interrupt', lower, `/interrupt:${lower}`, 'interrupt', INTERRUPT_DESCRIPTIONS[lower]);
  });

  // 2. Convert <code>entity</code> tags into colored chips when they match known entities.
  html = html.replace(/<code>([^<]+)<\/code>/g, (_match, inner: string) => {
    const trimmed = inner.trim();
    const lower = trimmed.toLowerCase();

    if (interruptSet.has(lower)) {
      return chipSpan('interrupt', lower, `/interrupt:${lower}`, 'interrupt', INTERRUPT_DESCRIPTIONS[lower]);
    }
    if (entities?.nodeIds.has(trimmed)) {
      return chipSpan('agent', trimmed, `//agent:${trimmed}`, 'agent', entities.nodeDescriptions.get(trimmed));
    }
    if (entities?.skillNames.has(trimmed)) {
      return chipSpan('skill', trimmed, `/skill:${trimmed}`, 'skill', entities.skillDescriptions.get(trimmed));
    }
    if (entities?.artifactNames.has(trimmed)) {
      return chipSpan('artifact', trimmed, `@${trimmed}`, 'artifact', entities.artifactTooltips.get(trimmed));
    }

    return _match;
  });

  // 3. Convert bold entity references into chips
  if (entities) {
    html = html.replace(/<strong>([^<]+)<\/strong>/g, (_match, inner: string) => {
      const trimmed = inner.trim();
      if (entities.skillNames.has(trimmed)) {
        return chipSpan('skill', trimmed, `/skill:${trimmed}`, 'skill', entities.skillDescriptions.get(trimmed));
      }
      if (entities.nodeIds.has(trimmed)) {
        return chipSpan('agent', trimmed, `//agent:${trimmed}`, 'agent', entities.nodeDescriptions.get(trimmed));
      }
      if (entities.artifactNames.has(trimmed)) {
        return chipSpan('artifact', trimmed, `@${trimmed}`, 'artifact', entities.artifactTooltips.get(trimmed));
      }
      return _match;
    });
  }

  return html;
}

/* ── Main Component ───────────────────────────────────── */

export function AISidePanel() {
  const { state, sendMessage, answerQuestion, stop, newChat, switchChat, deleteChat } = useCopilot();
  const { state: flowState } = useFlow();
  const { skills: availableSkills } = useProjectStore();
  const [input, setInput] = useState('');
  const [verbosity, setVerbosity] = useState<VerbosityLevel>('standard');
  const [showHistory, setShowHistory] = useState(false);
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
    const nodeDescriptions = new Map<string, string>();
    function collectNodes(nodes: Array<{ id: string; name: string; children: Array<{ id: string; name: string; children: unknown[] }> }>) {
      for (const n of nodes) {
        nodeIds.add(n.id);
        nodeDescriptions.set(n.id, n.name);
        if (n.children) collectNodes(n.children as typeof nodes);
      }
    }
    collectNodes(flowState.flow.nodes as Parameters<typeof collectNodes>[0]);

    const skillNames = new Set(availableSkills.map((s) => s.name));
    const skillDescriptions = new Map<string, string>();
    for (const s of availableSkills) {
      const parts: string[] = [];
      if (s.description) parts.push(s.description);
      if (s.referenceCount) parts.push(`${s.referenceCount} references`);
      if (s.subSkills?.length) parts.push(`Sub-skills: ${s.subSkills.join(', ')}`);
      if (parts.length) skillDescriptions.set(s.name, parts.join(' \u2022 '));
    }

    const artifactNames = new Set(Object.keys(flowState.flow.artifacts ?? {}));
    const artifactTooltips = new Map<string, string>();
    for (const [name, schema] of Object.entries(flowState.flow.artifacts ?? {})) {
      const tt = buildArtifactTooltip(schema as { format?: string; description?: string; fields?: { key: string }[] });
      if (tt) artifactTooltips.set(name, tt);
    }

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

    return { nodeIds, nodeDescriptions, skillNames, skillDescriptions, artifactNames, artifactTooltips, interruptTypes };
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
        {showHistory ? (
          <>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              title="Back to chat"
            >
              ←
            </button>
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">
              Chat History
            </span>
            <div className="ml-auto">
              <button
                type="button"
                onClick={async () => { await newChat(); setShowHistory(false); }}
                disabled={isActive}
                className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-gray-50 disabled:opacity-30 transition-colors"
              >
                + New
              </button>
            </div>
          </>
        ) : (
          <>
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
                onClick={() => setShowHistory(true)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-gray-50 transition-colors"
                title="Chat history"
              >
                History
              </button>
              <button
                type="button"
                onClick={newChat}
                disabled={isActive}
                className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-gray-50 disabled:opacity-30 transition-colors"
                title="New chat"
              >
                +
              </button>
            </div>
          </>
        )}
      </div>

      {/* Chat history view */}
      {showHistory ? (
        <ChatHistoryList
          chatList={state.chatList}
          activeChatId={state.chatId}
          isActive={isActive}
          onSwitch={async (chatId) => { await switchChat(chatId); setShowHistory(false); }}
          onDelete={deleteChat}
        />
      ) : (
        <>
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
                    {state.streamingText && <span className="animate-pulse text-[var(--color-node-agent)]">|</span>}
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
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas-bg)] px-3 py-1.5 focus-within:border-[var(--color-node-agent)] transition-colors">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you want to build or change..."
                rows={1}
                className="flex-1 resize-none bg-transparent text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none leading-normal overflow-hidden"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!input.trim() || isActive}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-[var(--color-node-agent)] text-white disabled:opacity-30 transition-opacity text-xs self-end"
              >
                ↑
              </button>
            </div>
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
        </>
      )}
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

/* ── Chat History List ────────────────────────────────── */

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dayGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const chatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (chatDay.getTime() === today.getTime()) return 'Today';
  if (chatDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return 'Older';
}

function ChatHistoryList({
  chatList,
  activeChatId,
  isActive,
  onSwitch,
  onDelete,
}: {
  chatList: ChatMeta[];
  activeChatId: string | null;
  isActive: boolean;
  onSwitch: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (chatList.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-[var(--color-text-muted)] text-center">
          No chat history yet. Start a conversation!
        </p>
      </div>
    );
  }

  // Group chats by day
  const groups: { label: string; chats: ChatMeta[] }[] = [];
  const seen = new Set<string>();
  for (const chat of chatList) {
    const g = dayGroup(chat.updatedAt);
    if (!seen.has(g)) {
      seen.add(g);
      groups.push({ label: g, chats: [] });
    }
    groups.find((gr) => gr.label === g)!.chats.push(chat);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-3 pt-3 pb-1">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              {group.label}
            </span>
          </div>
          {group.chats.map((chat) => {
            const isCurrent = chat.chatId === activeChatId;
            const disabled = isActive && !isCurrent;
            return (
              <div
                key={chat.chatId}
                className={`group relative px-3 py-2 cursor-pointer transition-colors ${
                  isCurrent
                    ? 'bg-blue-50 border-l-2 border-l-[var(--color-node-agent)]'
                    : disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                }`}
                onClick={() => !disabled && onSwitch(chat.chatId)}
                onMouseEnter={() => setHoveredId(chat.chatId)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                      {chat.title || 'Untitled chat'}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        {formatRelativeTime(chat.updatedAt)}
                      </span>
                      {chat.messageCount > 0 && (
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {chat.messageCount} msgs
                        </span>
                      )}
                      {chat.totalCostUsd > 0 && (
                        <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                          ${chat.totalCostUsd.toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Delete button — visible on hover, hidden for active chat while query running */}
                  {hoveredId === chat.chatId && !isCurrent && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(chat.chatId);
                      }}
                      className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors text-xs"
                      title="Delete chat"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
