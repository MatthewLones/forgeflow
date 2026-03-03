import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import type { ProgressEvent } from '@forgeflow/types';
import { api } from '../lib/api-client';

/* ── Types ─────────────────────────────────────────────── */

export interface CopilotToolCall {
  toolName: string;
  toolUseId: string;
  status: 'running' | 'done' | 'error';
  inputSummary: string;
  outputSummary?: string;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: CopilotToolCall[];
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export interface PendingQuestion {
  questionId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<string | { label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

interface CopilotState {
  sessionId: string | null;
  status: 'idle' | 'active' | 'waiting_answer' | 'error';
  messages: CopilotMessage[];
  /** Text accumulating during current assistant turn */
  pendingText: string;
  /** Tool calls accumulating during current assistant turn */
  pendingToolCalls: CopilotToolCall[];
  todos: TodoItem[];
  pendingQuestion: PendingQuestion | null;
  totalCostUsd: number;
  error: string | null;
  /** True if history was loaded from a previous session */
  hasHistory: boolean;
}

/* ── Actions ───────────────────────────────────────────── */

type CopilotAction =
  | { type: 'SEND_MESSAGE'; message: string }
  | { type: 'SESSION_STARTED'; sessionId: string }
  | { type: 'SSE_EVENT'; event: ProgressEvent }
  | { type: 'QUERY_COMPLETED' }
  | { type: 'QUESTION_ANSWERED' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' }
  | { type: 'LOAD_HISTORY'; messages: CopilotMessage[]; totalCostUsd: number; todos: TodoItem[] };

/* ── Initial state ─────────────────────────────────────── */

const WELCOME: CopilotMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hi! I'm Forge, your workflow copilot. I can help you build and modify agent workflows.\n\nTry asking me to:\n- Add or modify nodes in your flow\n- Explain what a node does\n- Write agent instructions\n- Debug configuration issues",
  timestamp: Date.now(),
};

const initialState: CopilotState = {
  sessionId: null,
  status: 'idle',
  messages: [WELCOME],
  pendingText: '',
  pendingToolCalls: [],
  todos: [],
  pendingQuestion: null,
  totalCostUsd: 0,
  error: null,
  hasHistory: false,
};

/* ── Reducer ───────────────────────────────────────────── */

function copilotReducer(state: CopilotState, action: CopilotAction): CopilotState {
  switch (action.type) {
    case 'SEND_MESSAGE':
      return {
        ...state,
        status: 'active',
        messages: [
          ...state.messages,
          { id: `user-${Date.now()}`, role: 'user', content: action.message, timestamp: Date.now() },
        ],
        pendingText: '',
        pendingToolCalls: [],
        error: null,
      };

    case 'SESSION_STARTED':
      return { ...state, sessionId: action.sessionId };

    case 'SSE_EVENT': {
      const event = action.event;

      switch (event.type) {
        case 'copilot_text': {
          // Consolidated blocks (from full assistant message) replace pendingText
          // to dedup with earlier streaming deltas that may have already arrived.
          // If SSE wasn't connected during streaming, this is the authoritative text.
          const isConsolidated = 'consolidated' in event && (event as Record<string, unknown>).consolidated === true;

          // If we have pending tool calls, flush them into a message first
          // This creates turn-by-turn conversation flow
          if (state.pendingToolCalls.length > 0) {
            const flushed: CopilotMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: state.pendingText,
              timestamp: Date.now(),
              toolCalls: [...state.pendingToolCalls],
            };
            return {
              ...state,
              messages: [...state.messages, flushed],
              pendingText: event.content,
              pendingToolCalls: [],
            };
          }
          if (isConsolidated) {
            return { ...state, pendingText: event.content };
          }
          return { ...state, pendingText: state.pendingText + event.content };
        }

        case 'copilot_tool_call':
          return {
            ...state,
            pendingToolCalls: [
              ...state.pendingToolCalls,
              { toolName: event.toolName, toolUseId: event.toolUseId, status: 'running', inputSummary: event.inputSummary },
            ],
          };

        case 'copilot_tool_result':
          return {
            ...state,
            pendingToolCalls: state.pendingToolCalls.map((tc) =>
              tc.toolUseId === event.toolUseId
                ? { ...tc, status: event.isError ? 'error' as const : 'done' as const, outputSummary: event.outputSummary }
                : tc,
            ),
          };

        case 'copilot_todo_update':
          return { ...state, todos: event.todos };

        case 'copilot_user_question':
          return {
            ...state,
            status: 'waiting_answer',
            pendingQuestion: { questionId: event.questionId, questions: event.questions },
          };

        case 'copilot_flow_changed':
          // Handled in the provider component via callback
          return state;

        case 'copilot_completed': {
          // Flush pending text + tool calls into a message
          const completedMessages = [...state.messages];

          if (state.pendingText || state.pendingToolCalls.length > 0) {
            completedMessages.push({
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: state.pendingText,
              timestamp: Date.now(),
              toolCalls: state.pendingToolCalls.length > 0 ? [...state.pendingToolCalls] : undefined,
            });
          }

          // Detect if session ended due to budget/turn limit — show a helpful resume hint
          // Budget cap ($3) is the practical limiter; turn limit (10K) is effectively unlimited
          const MAX_BUDGET_USD = 3.0;
          if (event.totalCostUsd >= MAX_BUDGET_USD * 0.95) {
            completedMessages.push({
              id: `system-limit-${Date.now()}`,
              role: 'assistant',
              content: `I hit the budget cap ($${event.totalCostUsd.toFixed(2)}). Send another message and I'll pick up right where I left off — full conversation context is preserved.`,
              timestamp: Date.now(),
            });
          }

          return {
            ...state,
            status: 'idle',
            messages: completedMessages,
            pendingText: '',
            pendingToolCalls: [],
            totalCostUsd: event.totalCostUsd,
          };
        }

        case 'copilot_error':
          return { ...state, status: 'error', error: event.error };

        default:
          return state;
      }
    }

    case 'QUERY_COMPLETED':
      return { ...state, status: 'idle' };

    case 'QUESTION_ANSWERED':
      return { ...state, status: 'active', pendingQuestion: null };

    case 'ERROR':
      return { ...state, status: 'error', error: action.error };

    case 'RESET':
      return { ...initialState, messages: [WELCOME] };

    case 'LOAD_HISTORY':
      return {
        ...state,
        messages: [WELCOME, ...action.messages],
        totalCostUsd: action.totalCostUsd,
        todos: action.todos,
        hasHistory: action.messages.length > 0,
      };

    default:
      return state;
  }
}

/* ── SSE event types to listen for ─────────────────────── */

const COPILOT_SSE_EVENT_TYPES = [
  'copilot_text', 'copilot_tool_call', 'copilot_tool_result',
  'copilot_todo_update', 'copilot_user_question',
  'copilot_completed', 'copilot_error', 'copilot_flow_changed',
] as const;

/* ── Context ───────────────────────────────────────────── */

interface CopilotContextValue {
  state: CopilotState;
  sendMessage: (message: string) => Promise<void>;
  answerQuestion: (questionId: string, answer: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

/* ── Provider ──────────────────────────────────────────── */

export function CopilotProvider({
  projectId,
  onFlowChanged,
  children,
}: {
  projectId: string;
  onFlowChanged?: () => void;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(copilotReducer, initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onFlowChangedRef = useRef(onFlowChanged);
  onFlowChangedRef.current = onFlowChanged;

  // Load chat history from disk on mount
  useEffect(() => {
    api.copilot.loadHistory(projectId).then(({ events }) => {
      if (events.length === 0) return;

      // Replay events into messages
      const messages: CopilotMessage[] = [];
      let pendingText = '';
      let pendingTools: CopilotToolCall[] = [];
      let totalCostUsd = 0;
      let lastTodos: TodoItem[] = [];

      for (const event of events) {
        // Handle user messages (not a ProgressEvent, custom record)
        const evt = event as Record<string, unknown>;
        if (evt.type === 'user_message' && typeof evt.content === 'string') {
          // Flush any pending assistant content first
          if (pendingText || pendingTools.length > 0) {
            messages.push({
              id: `history-${messages.length}`,
              role: 'assistant',
              content: pendingText,
              timestamp: Date.now(),
              toolCalls: pendingTools.length > 0 ? [...pendingTools] : undefined,
            });
            pendingText = '';
            pendingTools = [];
          }
          messages.push({
            id: `history-user-${messages.length}`,
            role: 'user',
            content: evt.content,
            timestamp: (evt.timestamp as number) ?? Date.now(),
          });
          continue;
        }

        switch (event.type) {
          case 'copilot_text':
            // If we have pending tools, flush previous turn
            if (pendingTools.length > 0) {
              messages.push({
                id: `history-${messages.length}`,
                role: 'assistant',
                content: pendingText,
                timestamp: Date.now(),
                toolCalls: [...pendingTools],
              });
              pendingText = '';
              pendingTools = [];
            }
            pendingText += event.content;
            break;
          case 'copilot_tool_call':
            pendingTools.push({
              toolName: event.toolName,
              toolUseId: event.toolUseId,
              status: 'running',
              inputSummary: event.inputSummary,
            });
            break;
          case 'copilot_tool_result':
            pendingTools = pendingTools.map((tc) =>
              tc.toolUseId === event.toolUseId
                ? { ...tc, status: event.isError ? 'error' as const : 'done' as const, outputSummary: event.outputSummary }
                : tc,
            );
            break;
          case 'copilot_todo_update':
            lastTodos = event.todos;
            break;
          case 'copilot_completed':
            // Flush remaining content
            if (pendingText || pendingTools.length > 0) {
              messages.push({
                id: `history-${messages.length}`,
                role: 'assistant',
                content: pendingText,
                timestamp: Date.now(),
                toolCalls: pendingTools.length > 0 ? [...pendingTools] : undefined,
              });
              pendingText = '';
              pendingTools = [];
            }
            totalCostUsd = event.totalCostUsd;
            break;
        }
      }

      // Flush any remaining
      if (pendingText || pendingTools.length > 0) {
        messages.push({
          id: `history-${messages.length}`,
          role: 'assistant',
          content: pendingText,
          timestamp: Date.now(),
          toolCalls: pendingTools.length > 0 ? [...pendingTools] : undefined,
        });
      }

      if (messages.length > 0 || lastTodos.length > 0) {
        dispatch({ type: 'LOAD_HISTORY', messages, totalCostUsd, todos: lastTodos });
      }
    }).catch(() => { /* no history available */ });
  }, [projectId]);

  const cleanupSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const subscribeSSE = useCallback((sessionId: string) => {
    cleanupSSE();
    const source = api.copilot.streamProgress(sessionId);
    eventSourceRef.current = source;

    for (const type of COPILOT_SSE_EVENT_TYPES) {
      source.addEventListener(type, (e) => {
        const event = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        dispatch({ type: 'SSE_EVENT', event });

        // Trigger flow reload on mutation
        if (event.type === 'copilot_flow_changed') {
          onFlowChangedRef.current?.();
        }
      });
    }

    source.addEventListener('error', () => {
      // EventSource auto-reconnects, but if the connection is gone (server restart etc),
      // close it to avoid infinite reconnect loops with stale state.
      if (source.readyState === EventSource.CLOSED) {
        cleanupSSE();
      }
    });
  }, [cleanupSSE]);

  const sendMessage = useCallback(async (message: string) => {
    dispatch({ type: 'SEND_MESSAGE', message });

    try {
      const { sessionId } = await api.copilot.sendMessage(projectId, message);
      dispatch({ type: 'SESSION_STARTED', sessionId });

      // Always (re)subscribe — the previous SSE may have silently died
      subscribeSSE(sessionId);
    } catch (err) {
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : String(err) });
    }
  }, [projectId, subscribeSSE]);

  const answerQuestion = useCallback(async (questionId: string, answer: string) => {
    if (!state.sessionId) return;
    dispatch({ type: 'QUESTION_ANSWERED' });
    try {
      await api.copilot.answerQuestion(state.sessionId, questionId, answer);
    } catch (err) {
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : String(err) });
    }
  }, [state.sessionId]);

  const stop = useCallback(() => {
    if (state.sessionId) {
      api.copilot.stop(state.sessionId).catch(() => {});
    }
  }, [state.sessionId]);

  const reset = useCallback(() => {
    cleanupSSE();
    if (state.sessionId) {
      api.copilot.reset(state.sessionId).catch(() => {});
    }
    dispatch({ type: 'RESET' });
  }, [cleanupSSE, state.sessionId]);

  // Cleanup SSE connection on unmount
  useEffect(() => {
    return () => cleanupSSE();
  }, [cleanupSSE]);

  const value = useMemo<CopilotContextValue>(
    () => ({ state, sendMessage, answerQuestion, stop, reset }),
    [state, sendMessage, answerQuestion, stop, reset],
  );

  return (
    <CopilotContext.Provider value={value}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error('useCopilot must be used within CopilotProvider');
  return ctx;
}
