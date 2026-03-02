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
  // Phase lifecycle
  | { type: 'phase_started'; nodeId: string; nodeName: string; phaseNumber: number }
  | { type: 'phase_completed'; nodeId: string; outputFiles: string[]; cost: number; missingOutputs?: string[] }
  | { type: 'phase_failed'; nodeId: string; error: string }
  | { type: 'run_completed'; success: boolean; totalCost: { turns: number; usd: number } }
  | { type: 'resume'; runId: string; checkpointNodeId: string }
  // Checkpoints & interrupts
  | { type: 'checkpoint'; checkpoint: CheckpointState }
  | { type: 'interrupt'; interrupt: Interrupt }
  | { type: 'interrupt_answered'; interruptId: string; nodeId: string; escalated: boolean }
  | { type: 'escalation_timeout'; interruptId: string; nodeId: string; timeoutMs: number }
  // Artifacts & children
  | { type: 'message'; content: string }
  | { type: 'cost_update'; turns: number; usd: number }
  | { type: 'child_started'; childId: string; childName: string; parentPath: string[] }
  | { type: 'child_completed'; childId: string; childName: string; parentPath: string[]; outputFiles: string[] }
  | { type: 'file_written'; fileName: string; fileSize: number; nodeId: string }
  // Verbose: runner-level (emitted by AgentRunner implementations)
  | { type: 'tool_call'; nodeId: string; toolName: string; toolUseId: string; inputSummary: string; truncated: boolean; sequence: number }
  | { type: 'tool_result'; nodeId: string; toolName: string; toolUseId: string; outputSummary: string; truncated: boolean; isError: boolean; sequence: number }
  | { type: 'text_block'; nodeId: string; content: string; truncated: boolean; charCount: number; sequence: number }
  // Verbose: orchestrator-level
  | { type: 'prompt_compiled'; nodeId: string; promptChars: number; childPromptCount: number; childPromptTotalChars: number }
  | { type: 'workspace_prepared'; nodeId: string; inputFileCount: number; skillCount: number; childPromptCount: number; workspacePath: string }
  | { type: 'skill_loaded'; nodeId: string; skillName: string; fileCount: number }
  | { type: 'output_validated'; nodeId: string; expectedCount: number; foundCount: number; missingFiles: string[]; valid: boolean }
  // Rate limiting
  | { type: 'rate_limited'; nodeId: string; retryAttempt: number; maxRetries: number; waitMs: number; error: string }
  // Copilot events
  | { type: 'copilot_text'; content: string; sequence: number }
  | { type: 'copilot_tool_call'; toolName: string; toolUseId: string; inputSummary: string; truncated: boolean; sequence: number }
  | { type: 'copilot_tool_result'; toolName: string; toolUseId: string; outputSummary: string; truncated: boolean; isError: boolean; sequence: number }
  | { type: 'copilot_todo_update'; todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }> }
  | { type: 'copilot_user_question'; questionId: string; questions: Array<{ question: string; header?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }> }
  | { type: 'copilot_completed'; numTurns: number; totalCostUsd: number }
  | { type: 'copilot_error'; error: string }
  | { type: 'copilot_flow_changed'; projectId: string };

// --- Run Result ---

export interface RunResult {
  success: boolean;
  status: RunStatus;
  runId: string;
  totalCost: { turns: number; usd: number };
  outputFiles: string[];
  error?: string;
}
