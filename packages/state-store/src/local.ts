import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { StateFile, RunState, CheckpointState } from '@forgeflow/types';
import type { StateStore } from './interface.js';

/**
 * Local filesystem-backed state store.
 *
 * Directory layout:
 *   {basePath}/{runId}/
 *   ├── state.json          ← RunState metadata
 *   ├── checkpoint.json     ← CheckpointState (if paused)
 *   ├── uploads/            ← User-uploaded input files
 *   └── artifacts/          ← All phase outputs (flat namespace)
 */
export class LocalStateStore implements StateStore {
  constructor(private basePath: string) {}

  private runDir(runId: string): string {
    return join(this.basePath, runId);
  }

  private artifactsDir(runId: string): string {
    return join(this.runDir(runId), 'artifacts');
  }

  private uploadsDir(runId: string): string {
    return join(this.runDir(runId), 'uploads');
  }

  async savePhaseOutputs(runId: string, phaseId: string, files: StateFile[]): Promise<void> {
    const dir = this.artifactsDir(runId);
    await mkdir(dir, { recursive: true });
    for (const file of files) {
      await writeFile(join(dir, file.name), file.content);
    }
  }

  async loadPhaseInputs(runId: string, inputNames: string[]): Promise<StateFile[]> {
    const results: StateFile[] = [];
    for (const name of inputNames) {
      // Try artifacts first, then uploads
      const content = await this.tryReadFile(join(this.artifactsDir(runId), name))
        ?? await this.tryReadFile(join(this.uploadsDir(runId), name));

      if (content !== null) {
        results.push({ name, content, producedByPhase: 'loaded' });
      }
    }
    return results;
  }

  async saveRunState(runId: string, state: RunState): Promise<void> {
    const dir = this.runDir(runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2));
  }

  async loadRunState(runId: string): Promise<RunState | null> {
    const data = await this.tryReadFile(join(this.runDir(runId), 'state.json'));
    if (!data) return null;
    try {
      return JSON.parse(data.toString('utf-8')) as RunState;
    } catch {
      return null;
    }
  }

  async saveCheckpoint(runId: string, checkpoint: CheckpointState): Promise<void> {
    const dir = this.runDir(runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'checkpoint.json'), JSON.stringify(checkpoint, null, 2));
  }

  async loadCheckpoint(runId: string): Promise<CheckpointState | null> {
    const data = await this.tryReadFile(join(this.runDir(runId), 'checkpoint.json'));
    if (!data) return null;
    try {
      return JSON.parse(data.toString('utf-8')) as CheckpointState;
    } catch {
      return null;
    }
  }

  async saveCheckpointAnswer(runId: string, fileName: string, content: Buffer): Promise<void> {
    const dir = this.artifactsDir(runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), content);
  }

  async saveUserUploads(runId: string, files: StateFile[]): Promise<void> {
    const dir = this.uploadsDir(runId);
    await mkdir(dir, { recursive: true });
    for (const file of files) {
      await writeFile(join(dir, file.name), file.content);
    }
  }

  private async tryReadFile(path: string): Promise<Buffer | null> {
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }
}
