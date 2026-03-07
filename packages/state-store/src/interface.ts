import type { StateFile, RunState, CheckpointState } from '@forgeflow/types';

/**
 * StateStore interface — abstracts persistence of run state and artifacts.
 * Local MVP uses filesystem; Cloud version would use Postgres + S3.
 */
export interface StateStore {
  /** Save output files from a completed phase */
  savePhaseOutputs(runId: string, phaseId: string, files: StateFile[]): Promise<void>;

  /** Load input files needed for a phase (from artifacts + uploads) */
  loadPhaseInputs(runId: string, inputNames: string[]): Promise<StateFile[]>;

  /** Save run metadata */
  saveRunState(runId: string, state: RunState): Promise<void>;

  /** Load run metadata (null if run doesn't exist) */
  loadRunState(runId: string): Promise<RunState | null>;

  /** Save checkpoint state */
  saveCheckpoint(runId: string, checkpoint: CheckpointState): Promise<void>;

  /** Load checkpoint state (null if no checkpoint) */
  loadCheckpoint(runId: string): Promise<CheckpointState | null>;

  /** Save a checkpoint answer file */
  saveCheckpointAnswer(runId: string, fileName: string, content: Buffer): Promise<void>;

  /** Save multiple checkpoint answer files at once */
  saveCheckpointAnswers(runId: string, files: Array<{ fileName: string; content: Buffer }>): Promise<void>;

  /** Save user-uploaded input files */
  saveUserUploads(runId: string, files: StateFile[]): Promise<void>;

  /** List artifact files for a run */
  listArtifacts(runId: string): Promise<Array<{ name: string; size: number; format: string }>>;

  /** Read a single artifact file (resolves extension fallback if exact match not found) */
  readArtifact(runId: string, fileName: string): Promise<{ content: Buffer; resolvedName: string } | null>;
}
