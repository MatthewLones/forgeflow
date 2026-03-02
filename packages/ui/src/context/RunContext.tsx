import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import type { ProgressEvent, Interrupt, InterruptAnswer } from '@forgeflow/types';
import { api } from '../lib/api-client';

/* ── Types ─────────────────────────────────────────────── */

export type NodeRunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'waiting';
type RunnerType = 'mock' | 'local' | 'docker';

interface RunState {
  status: 'idle' | 'starting' | 'running' | 'awaiting_input' | 'completed' | 'failed';
  runId: string | null;
  events: ProgressEvent[];
  nodeStatuses: Record<string, NodeRunStatus>;
  currentPhaseId: string | null;
  completedPhases: string[];
  totalCost: { turns: number; usd: number };
  error: string | null;
  pendingInterrupt: Interrupt | null;
  reconnecting: boolean;
  /** Timestamp (ms) when the run started, used for elapsed timer */
  startedAt: number | null;
}

/* ── Actions ───────────────────────────────────────────── */

type RunAction =
  | { type: 'RUN_STARTED'; runId: string }
  | { type: 'SSE_EVENT'; event: ProgressEvent }
  | { type: 'RUN_FINISHED'; status: 'completed' | 'failed' }
  | { type: 'INTERRUPT_ANSWERED' }
  | { type: 'SSE_DISCONNECTED' }
  | { type: 'SSE_RECONNECTED' }
  | { type: 'RESET' };

/* ── Initial state ─────────────────────────────────────── */

const initialState: RunState = {
  status: 'idle',
  runId: null,
  events: [],
  nodeStatuses: {},
  currentPhaseId: null,
  completedPhases: [],
  totalCost: { turns: 0, usd: 0 },
  error: null,
  pendingInterrupt: null,
  reconnecting: false,
  startedAt: null,
};

/* ── Reducer ───────────────────────────────────────────── */

function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'RUN_STARTED':
      return { ...initialState, status: 'running', runId: action.runId, startedAt: Date.now() };

    case 'SSE_EVENT': {
      const event = action.event;
      const events = [...state.events, event];

      switch (event.type) {
        case 'phase_started':
          return {
            ...state,
            events,
            status: 'running',
            currentPhaseId: event.nodeId,
            nodeStatuses: { ...state.nodeStatuses, [event.nodeId]: 'running' },
          };

        case 'phase_completed':
          return {
            ...state,
            events,
            nodeStatuses: { ...state.nodeStatuses, [event.nodeId]: 'completed' },
            completedPhases: [...state.completedPhases, event.nodeId],
            currentPhaseId: state.currentPhaseId === event.nodeId ? null : state.currentPhaseId,
          };

        case 'phase_failed':
          return {
            ...state,
            events,
            nodeStatuses: { ...state.nodeStatuses, [event.nodeId]: 'failed' },
            error: event.error,
          };

        case 'checkpoint':
          return {
            ...state,
            events,
            status: 'awaiting_input',
            nodeStatuses: { ...state.nodeStatuses, [event.checkpoint.checkpointNodeId]: 'waiting' },
          };

        case 'interrupt':
          return { ...state, events, pendingInterrupt: event.interrupt };

        case 'cost_update':
          return { ...state, events, totalCost: { turns: event.turns, usd: event.usd } };

        case 'run_completed':
          return {
            ...state,
            events,
            status: event.success ? 'completed' : 'failed',
            totalCost: event.totalCost,
            currentPhaseId: null,
          };

        default:
          return { ...state, events };
      }
    }

    case 'RUN_FINISHED':
      return {
        ...state,
        status: action.status,
        currentPhaseId: null,
      };

    case 'INTERRUPT_ANSWERED':
      return { ...state, pendingInterrupt: null };

    case 'SSE_DISCONNECTED':
      return { ...state, reconnecting: true };

    case 'SSE_RECONNECTED':
      return { ...state, reconnecting: false };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

/* ── SSE event types to listen for ─────────────────────── */

const SSE_EVENT_TYPES = [
  'phase_started', 'phase_completed', 'phase_failed',
  'checkpoint', 'interrupt', 'cost_update', 'run_completed',
  'child_started', 'child_completed', 'file_written',
  'message', 'resume', 'escalation_timeout', 'interrupt_answered',
  // Verbose events
  'tool_call', 'tool_result', 'text_block',
  'prompt_compiled', 'workspace_prepared', 'skill_loaded', 'output_validated',
  'rate_limited',
] as const;

/* ── Context ───────────────────────────────────────────── */

interface RunContextValue {
  run: RunState;
  startRun: (projectId: string, runner?: RunnerType, files?: File[], model?: string) => Promise<void>;
  stopRun: () => void;
  resetRun: () => void;
  answerInterrupt: (answer: InterruptAnswer) => Promise<void>;
  resumeFromCheckpoint: (projectId: string, fileName: string, content: string, runner?: RunnerType) => Promise<void>;
  /** Attach to an existing run (replays events via SSE) */
  connectToRun: (runId: string) => void;
}

const RunContext = createContext<RunContextValue | null>(null);

/* ── Provider ──────────────────────────────────────────── */

const MAX_RECONNECT_ATTEMPTS = 5;

export function RunProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(runReducer, initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const doneReceivedRef = useRef(false);
  const eventCountRef = useRef(0);

  // Internal: tears down SSE connection without sending stop to server
  const cleanupSSE = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    doneReceivedRef.current = false;
  }, []);

  // Public: stop the run on the server + tear down SSE + update state
  const stopRun = useCallback(() => {
    const runId = state.runId;
    cleanupSSE();
    if (runId && state.status !== 'completed' && state.status !== 'failed' && state.status !== 'idle') {
      api.runs.stop(runId).catch(() => {});
      dispatch({ type: 'RUN_FINISHED', status: 'failed' });
    }
  }, [cleanupSSE, state.runId, state.status]);

  const subscribeSSE = useCallback((runId: string, skipEvents = 0) => {
    const source = api.runs.streamProgress(runId);
    eventSourceRef.current = source;
    let eventIndex = 0;

    for (const type of SSE_EVENT_TYPES) {
      source.addEventListener(type, (e) => {
        eventIndex++;
        // Skip replayed events on reconnect
        if (eventIndex <= skipEvents) return;
        const event = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        dispatch({ type: 'SSE_EVENT', event });
        eventCountRef.current++;
      });
    }

    source.addEventListener('done', (e) => {
      doneReceivedRef.current = true;
      const data = JSON.parse((e as MessageEvent).data) as { status: string };
      // Don't overwrite status if it's already awaiting_input (checkpoint hit)
      if (data.status !== 'awaiting_input') {
        dispatch({ type: 'RUN_FINISHED', status: data.status === 'failed' ? 'failed' : 'completed' });
      }
      source.close();
      eventSourceRef.current = null;
      reconnectAttemptsRef.current = 0;
    });

    source.addEventListener('error', () => {
      // SSE error can fire for connection drops, server crashes, or normal close
      // Only reconnect if we didn't receive a 'done' event
      if (!doneReceivedRef.current) {
        source.close();
        eventSourceRef.current = null;

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          dispatch({ type: 'SSE_DISCONNECTED' });
          const delay = 1000 * Math.pow(2, reconnectAttemptsRef.current - 1); // 1s, 2s, 4s, 8s, 16s
          console.log(`[RunContext] SSE disconnected, reconnect attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
          reconnectTimerRef.current = setTimeout(() => {
            subscribeSSE(runId, eventCountRef.current);
          }, delay);
        } else {
          console.warn('[RunContext] SSE reconnect exhausted, checking run state from server...');
          // Before declaring failure, check the actual server-side run state
          // The run may have completed while we were disconnected
          api.runs.getState(runId).then((serverState) => {
            if (serverState && (serverState.status === 'completed' || serverState.status === 'failed')) {
              dispatch({ type: 'RUN_FINISHED', status: serverState.status === 'completed' ? 'completed' : 'failed' });
            } else {
              dispatch({ type: 'RUN_FINISHED', status: 'failed' });
            }
          }).catch(() => {
            dispatch({ type: 'RUN_FINISHED', status: 'failed' });
          });
        }
      }
    });

    // On successful open, reset reconnect counter
    source.addEventListener('open', () => {
      if (reconnectAttemptsRef.current > 0) {
        dispatch({ type: 'SSE_RECONNECTED' });
      }
      reconnectAttemptsRef.current = 0;
    });
  }, []);

  const startRun = useCallback(async (projectId: string, runner: RunnerType = 'mock', files?: File[], model?: string) => {
    cleanupSSE();
    dispatch({ type: 'RESET' });
    eventCountRef.current = 0;
    doneReceivedRef.current = false;

    const { runId } = await api.runs.start(projectId, runner, files, model);
    dispatch({ type: 'RUN_STARTED', runId });
    subscribeSSE(runId);
  }, [cleanupSSE, subscribeSSE]);

  const resetRun = useCallback(() => {
    cleanupSSE();
    dispatch({ type: 'RESET' });
  }, [cleanupSSE]);

  const answerInterrupt = useCallback(async (answer: InterruptAnswer) => {
    if (!state.runId) return;
    await api.runs.answerInterrupt(state.runId, answer);
    dispatch({ type: 'INTERRUPT_ANSWERED' });
  }, [state.runId]);

  const connectToRun = useCallback((runId: string) => {
    cleanupSSE();
    eventCountRef.current = 0;
    doneReceivedRef.current = false;
    dispatch({ type: 'RUN_STARTED', runId });
    subscribeSSE(runId);
  }, [cleanupSSE, subscribeSSE]);

  const resumeFromCheckpoint = useCallback(async (
    projectId: string,
    fileName: string,
    content: string,
    runner: RunnerType = 'mock',
  ) => {
    if (!state.runId) return;
    cleanupSSE();
    eventCountRef.current = 0;
    doneReceivedRef.current = false;
    const { runId } = await api.runs.resume(state.runId, projectId, fileName, content, runner);
    dispatch({ type: 'RUN_STARTED', runId });
    subscribeSSE(runId);
  }, [state.runId, cleanupSSE, subscribeSSE]);

  const value = useMemo<RunContextValue>(
    () => ({ run: state, startRun, stopRun, resetRun, answerInterrupt, resumeFromCheckpoint, connectToRun }),
    [state, startRun, stopRun, resetRun, answerInterrupt, resumeFromCheckpoint, connectToRun],
  );

  return (
    <RunContext.Provider value={value}>
      {children}
    </RunContext.Provider>
  );
}

export function useRun(): RunContextValue {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRun must be used within RunProvider');
  return ctx;
}
