import type { CheckpointPresentation } from './node.js';
import type { Interrupt } from './interrupt.js';

// --- State Store ---

export interface StateFile {
  /** Filename, e.g., "clauses_parsed.json" */
  name: string;
  /** File contents */
  content: Buffer;
  /** Which phase created this file */
  producedByPhase: string;
}

export type RunStatus = 'ready' | 'running' | 'awaiting_input' | 'completed' | 'failed';

export interface RunState {
  runId: string;
  flowId: string;
  status: RunStatus;
  currentPhaseId: string | null;
  completedPhases: string[];
  totalCost: { turns: number; usd: number };
  startedAt: string;
  updatedAt: string;
  error?: string;
}

export interface CheckpointState {
  runId: string;
  checkpointNodeId: string;
  status: 'waiting' | 'answered';
  presentFiles: string[];
  waitingForFile: string;
  completedPhases: string[];
  costSoFar: { turns: number; usd: number };
  presentation: CheckpointPresentation;
}

// --- Agent Runner ---

export interface PhaseResult {
  success: boolean;
  cost: { turns: number; usd: number };
  outputFiles: string[];
  error?: string;
}

// --- Progress Events ---

export type ProgressEvent =
  | { type: 'phase_started'; nodeId: string; nodeName: string; phaseNumber: number }
  | { type: 'phase_completed'; nodeId: string; outputFiles: string[]; cost: number }
  | { type: 'message'; content: string }
  | { type: 'checkpoint'; checkpoint: CheckpointState }
  | { type: 'interrupt'; interrupt: Interrupt }
  | { type: 'cost_update'; turns: number; usd: number }
  | { type: 'run_completed'; success: boolean; totalCost: { turns: number; usd: number } }
  | { type: 'phase_failed'; nodeId: string; error: string };

// --- Run Result ---

export interface RunResult {
  success: boolean;
  status: RunStatus;
  runId: string;
  totalCost: { turns: number; usd: number };
  outputFiles: string[];
  error?: string;
}
