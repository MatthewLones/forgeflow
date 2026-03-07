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
import { api, type ChatMeta } from '../lib/api-client';

/* ── Types ─────────────────────────────────────────────── */

export type { ChatMeta } from '../lib/api-client';

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

export type { TodoItem } from '../components/shared/TodoWidget';

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
  /** True only while copilot_text events are actively arriving */
  streamingText: boolean;
  /** Current active chat ID */
  chatId: string | null;
  /** All chats for this project */
  chatList: ChatMeta[];
  /** Whether chat list has been loaded */
  chatListLoaded: boolean;
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
  | { type: 'RECONNECT'; sessionId: string }
  | { type: 'LOAD_HISTORY'; messages: CopilotMessage[]; totalCostUsd: number; todos: TodoItem[] }
  | { type: 'LOAD_CHAT_LIST'; chats: ChatMeta[]; activeChatId: string | null }
  | { type: 'SET_ACTIVE_CHAT'; chatId: string; messages: CopilotMessage[]; totalCostUsd: number; todos: TodoItem[] }
  | { type: 'NEW_CHAT'; chatMeta: ChatMeta }
  | { type: 'CHAT_DELETED'; chatId: string };

/* ── Replay helper ─────────────────────────────────────── */

/** Replay NDJSON events into CopilotMessages. Extracted for reuse in mount + switchChat. */
function replayEvents(events: ProgressEvent[]): { messages: CopilotMessage[]; totalCostUsd: number; todos: TodoItem[] } {
  const messages: CopilotMessage[] = [];
  let pendingText = '';
  let pendingTools: CopilotToolCall[] = [];
  let totalCostUsd = 0;
  let lastTodos: TodoItem[] = [];

  for (const event of events) {
    const evt = event as Record<string, unknown>;
    if (evt.type === 'user_message' && typeof evt.content === 'string') {
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

  // Flush remaining
  if (pendingText || pendingTools.length > 0) {
    messages.push({
      id: `history-${messages.length}`,
      role: 'assistant',
      content: pendingText,
      timestamp: Date.now(),
      toolCalls: pendingTools.length > 0 ? [...pendingTools] : undefined,
    });
  }

  return { messages, totalCostUsd, todos: lastTodos };
}

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
  streamingText: false,
  chatId: null,
  chatList: [],
  chatListLoaded: false,
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
          const isConsolidated = 'consolidated' in event && (event as Record<string, unknown>).consolidated === true;

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
              streamingText: !isConsolidated,
            };
          }
          if (isConsolidated) {
            return { ...state, pendingText: event.content, streamingText: false };
          }
          return { ...state, pendingText: state.pendingText + event.content, streamingText: true };
        }

        case 'copilot_tool_call':
          return {
            ...state,
            streamingText: false,
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
          return state;

        case 'copilot_completed': {
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
      return { ...initialState, messages: [WELCOME], chatList: state.chatList, chatListLoaded: state.chatListLoaded };

    case 'LOAD_HISTORY':
      return {
        ...state,
        messages: [WELCOME, ...action.messages],
        totalCostUsd: action.totalCostUsd,
        todos: action.todos,
        hasHistory: action.messages.length > 0,
      };

    case 'RECONNECT':
      return { ...state, sessionId: action.sessionId, status: 'active' };

    case 'LOAD_CHAT_LIST':
      return {
        ...state,
        chatList: action.chats,
        chatListLoaded: true,
        chatId: action.activeChatId,
      };

    case 'SET_ACTIVE_CHAT':
      return {
        ...state,
        chatId: action.chatId,
        sessionId: null,
        status: 'idle',
        messages: [WELCOME, ...action.messages],
        pendingText: '',
        pendingToolCalls: [],
        totalCostUsd: action.totalCostUsd,
        todos: action.todos,
        pendingQuestion: null,
        error: null,
        hasHistory: action.messages.length > 0,
        streamingText: false,
      };

    case 'NEW_CHAT':
      return {
        ...state,
        chatId: action.chatMeta.chatId,
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
        streamingText: false,
        chatList: [action.chatMeta, ...state.chatList.filter((c) => c.chatId !== action.chatMeta.chatId)],
      };

    case 'CHAT_DELETED':
      return {
        ...state,
        chatList: state.chatList.filter((c) => c.chatId !== action.chatId),
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
  newChat: () => Promise<void>;
  switchChat: (chatId: string) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
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

  // Load chat list + active chat history on mount
  useEffect(() => {
    const loadEventsIntoState = (events: ProgressEvent[]) => {
      if (events.length === 0) return;
      try {
        const { messages, totalCostUsd, todos } = replayEvents(events);
        if (messages.length > 0 || todos.length > 0) {
          dispatch({ type: 'LOAD_HISTORY', messages, totalCostUsd, todos });
        }
      } catch (err) {
        console.error('[Copilot] Failed to replay events:', err);
      }
    };

    const loadLegacy = () => {
      api.copilot.loadHistory(projectId)
        .then(({ events }) => loadEventsIntoState(events))
        .catch(() => { /* no history available */ });
    };

    api.copilot.listChats(projectId).then(({ chats, activeChatId }) => {
      dispatch({ type: 'LOAD_CHAT_LIST', chats, activeChatId });

      if (activeChatId) {
        api.copilot.loadChatHistory(projectId, activeChatId)
          .then(({ events }) => loadEventsIntoState(events))
          .catch(() => loadLegacy());
      } else {
        loadLegacy();
      }
    }).catch(() => {
      // Server unavailable or old server without /chats endpoint — use legacy
      loadLegacy();
    });
  }, [projectId]);

  const cleanupSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const subscribeSSE = useCallback((sessionId: string, skipReplayCount = 0) => {
    cleanupSSE();
    const source = api.copilot.streamProgress(sessionId);
    eventSourceRef.current = source;

    let skipped = 0;

    for (const type of COPILOT_SSE_EVENT_TYPES) {
      source.addEventListener(type, (e) => {
        const event = JSON.parse((e as MessageEvent).data) as ProgressEvent;

        if (skipped < skipReplayCount) {
          skipped++;
          if (event.type === 'copilot_flow_changed') {
            onFlowChangedRef.current?.();
          }
          return;
        }

        dispatch({ type: 'SSE_EVENT', event });

        if (event.type === 'copilot_flow_changed') {
          onFlowChangedRef.current?.();
        }
      });
    }

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        cleanupSSE();
      }
    });
  }, [cleanupSSE]);

  // Auto-reconnect to an active copilot session after page refresh
  useEffect(() => {
    api.copilot.getActiveSession(projectId).then((res) => {
      if (res.active && res.sessionId && res.activeQuery) {
        dispatch({ type: 'RECONNECT', sessionId: res.sessionId });
        subscribeSSE(res.sessionId, res.eventCount ?? 0);
      }
    }).catch(() => { /* server not available */ });
  }, [projectId, subscribeSSE]);

  const sendMessage = useCallback(async (message: string) => {
    dispatch({ type: 'SEND_MESSAGE', message });

    try {
      const { sessionId, eventCount } = await api.copilot.sendMessage(projectId, message);
      dispatch({ type: 'SESSION_STARTED', sessionId });
      subscribeSSE(sessionId, eventCount);
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

  const newChat = useCallback(async () => {
    cleanupSSE();
    try {
      const chatMeta = await api.copilot.newChat(projectId);
      dispatch({ type: 'NEW_CHAT', chatMeta });
    } catch {
      // Fallback: just reset locally
      dispatch({ type: 'RESET' });
    }
  }, [cleanupSSE, projectId]);

  const switchChat = useCallback(async (chatId: string) => {
    if (state.status === 'active') return; // Block switching during active query
    cleanupSSE();

    try {
      await api.copilot.switchChat(projectId, chatId);
      const { events } = await api.copilot.loadChatHistory(projectId, chatId);
      const { messages, totalCostUsd, todos } = replayEvents(events);
      dispatch({ type: 'SET_ACTIVE_CHAT', chatId, messages, totalCostUsd, todos });
    } catch (err) {
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : String(err) });
    }
  }, [state.status, cleanupSSE, projectId]);

  const deleteChat = useCallback(async (chatId: string) => {
    try {
      await api.copilot.deleteChat(projectId, chatId);
      dispatch({ type: 'CHAT_DELETED', chatId });
    } catch { /* ignore */ }
  }, [projectId]);

  // Cleanup SSE connection on unmount
  useEffect(() => {
    return () => cleanupSSE();
  }, [cleanupSSE]);

  const value = useMemo<CopilotContextValue>(
    () => ({ state, sendMessage, answerQuestion, stop, newChat, switchChat, deleteChat }),
    [state, sendMessage, answerQuestion, stop, newChat, switchChat, deleteChat],
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
