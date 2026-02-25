import { useState, useCallback, useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: { name: string; status: 'running' | 'done'; summary: string }[];
}

const WELCOME_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content:
      "Hi! I'm Forge, your workflow copilot. I can help you build and modify agent workflows.\n\nTry asking me to:\n- Add or modify nodes in your flow\n- Explain what a node does\n- Write agent instructions\n- Debug configuration issues",
    timestamp: Date.now(),
  },
];

export function AISidePanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(WELCOME_MESSAGES);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);

    // Mock assistant response — replaced with real API in Phase 7
    setTimeout(() => {
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content:
          "I'll be connected to the ForgeFlow engine in a future update. For now, this is a UI preview of the AI assistant panel.\n\nOnce connected, I'll be able to read your flow, modify nodes, run validations, and help you build workflows conversationally.",
        timestamp: Date.now(),
        toolCalls: [
          { name: 'get_flow', status: 'done', summary: 'Read current flow definition' },
        ],
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsStreaming(false);
    }, 1200);
  }, [input, isStreaming]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 h-10 flex items-center gap-2 px-3 border-b border-[var(--color-border)] bg-[var(--color-canvas-bg)]">
        <div className="w-2 h-2 rounded-full bg-[var(--color-node-agent)]" />
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          Forge
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
          Powered by Claude
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] py-1">
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-node-agent)] animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-node-agent)] animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-node-agent)] animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            Thinking...
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
            className="flex-1 resize-none bg-transparent text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none leading-relaxed max-h-24 overflow-y-auto"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-[var(--color-node-agent)] text-white disabled:opacity-30 transition-opacity text-xs"
          >
            ↑
          </button>
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1 px-1">
          Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-[var(--color-node-agent)] text-white'
            : 'bg-[var(--color-canvas-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)]'
        }`}
      >
        {message.content}
      </div>

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-1.5 space-y-1 max-w-[90%]">
          {message.toolCalls.map((tool, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-canvas-bg)] border border-[var(--color-border)] rounded px-2 py-1"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  tool.status === 'done'
                    ? 'bg-[var(--color-node-merge)]'
                    : 'bg-[var(--color-node-checkpoint)] animate-pulse'
                }`}
              />
              <span className="font-mono font-medium">{tool.name}</span>
              <span className="text-[var(--color-text-muted)]">— {tool.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
