import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import type { ProgressEvent, Interrupt } from '@forgeflow/types';
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
}

/* ── Actions ───────────────────────────────────────────── */

type RunAction =
  | { type: 'RUN_STARTED'; runId: string }
  | { type: 'SSE_EVENT'; event: ProgressEvent }
  | { type: 'RUN_FINISHED'; status: 'completed' | 'failed' }
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
};

/* ── Reducer ───────────────────────────────────────────── */

function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'RUN_STARTED':
      return { ...initialState, status: 'running', runId: action.runId };

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
] as const;

/* ── Context ───────────────────────────────────────────── */

interface RunContextValue {
  run: RunState;
  startRun: (projectId: string, runner?: RunnerType) => Promise<void>;
  stopRun: () => void;
  resetRun: () => void;
}

const RunContext = createContext<RunContextValue | null>(null);

/* ── Provider ──────────────────────────────────────────── */

export function RunProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(runReducer, initialState);
  const eventSourceRef = useRef<EventSource | null>(null);

  const stopRun = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const startRun = useCallback(async (projectId: string, runner: RunnerType = 'mock') => {
    // Clean up any previous run
    stopRun();
    dispatch({ type: 'RESET' });

    const { runId } = await api.runs.start(projectId, runner);
    dispatch({ type: 'RUN_STARTED', runId });

    // Connect to SSE stream
    const source = api.runs.streamProgress(runId);
    eventSourceRef.current = source;

    for (const type of SSE_EVENT_TYPES) {
      source.addEventListener(type, (e) => {
        const event = JSON.parse((e as MessageEvent).data) as ProgressEvent;
        dispatch({ type: 'SSE_EVENT', event });
      });
    }

    source.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { status: string };
      dispatch({ type: 'RUN_FINISHED', status: data.status === 'failed' ? 'failed' : 'completed' });
      source.close();
      eventSourceRef.current = null;
    });

    source.addEventListener('error', () => {
      // SSE error event fires when connection closes or fails
      if (source.readyState === EventSource.CLOSED) {
        dispatch({ type: 'RUN_FINISHED', status: 'failed' });
        eventSourceRef.current = null;
      }
    });
  }, [stopRun]);

  const resetRun = useCallback(() => {
    stopRun();
    dispatch({ type: 'RESET' });
  }, [stopRun]);

  const value = useMemo<RunContextValue>(
    () => ({ run: state, startRun, stopRun, resetRun }),
    [state, startRun, stopRun, resetRun],
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
