import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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
      const filePath = join(dir, file.name);
      if (file.name.includes('/')) {
        await mkdir(dirname(filePath), { recursive: true });
      }
      await writeFile(filePath, file.content);
    }
  }

  async loadPhaseInputs(runId: string, inputNames: string[]): Promise<StateFile[]> {
    const results: StateFile[] = [];
    for (const name of inputNames) {
      // Try exact match first (artifacts then uploads)
      const content = await this.tryReadFile(join(this.artifactsDir(runId), name))
        ?? await this.tryReadFile(join(this.uploadsDir(runId), name));

      if (content !== null) {
        results.push({ name, content, producedByPhase: 'loaded' });
        continue;
      }

      // Agents commonly add file extensions (e.g., company_profile.json for
      // an artifact declared as "company_profile"). Try common extensions.
      const found = await this.tryReadWithExtension(this.artifactsDir(runId), name)
        ?? await this.tryReadWithExtension(this.uploadsDir(runId), name);
      if (found) {
        // Store under the declared artifact name so downstream phases match
        results.push({ name, content: found.content, producedByPhase: 'loaded' });
      }
    }
    return results;
  }

  private async tryReadWithExtension(dir: string, baseName: string): Promise<{ content: Buffer; resolvedName: string } | null> {
    const extensions = ['.json', '.md', '.txt', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    for (const ext of extensions) {
      const name = baseName + ext;
      const content = await this.tryReadFile(join(dir, name));
      if (content !== null) return { content, resolvedName: name };
    }
    return null;
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
      const raw = JSON.parse(data.toString('utf-8')) as CheckpointState & { waitingForFile?: string };
      // Migrate old single-file format to expectedFiles array
      if (!raw.expectedFiles && raw.waitingForFile) {
        raw.expectedFiles = [{
          fileName: raw.waitingForFile,
          provided: raw.status === 'answered',
        }];
      }
      return raw;
    } catch {
      return null;
    }
  }

  async saveCheckpointAnswer(runId: string, fileName: string, content: Buffer): Promise<void> {
    const dir = this.artifactsDir(runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), content);
  }

  async saveCheckpointAnswers(runId: string, files: Array<{ fileName: string; content: Buffer }>): Promise<void> {
    for (const file of files) {
      await this.saveCheckpointAnswer(runId, file.fileName, file.content);
    }
  }

  async saveUserUploads(runId: string, files: StateFile[]): Promise<void> {
    const dir = this.uploadsDir(runId);
    await mkdir(dir, { recursive: true });
    for (const file of files) {
      const filePath = join(dir, file.name);
      if (file.name.includes('/')) {
        await mkdir(dirname(filePath), { recursive: true });
      }
      await writeFile(filePath, file.content);
    }
  }

  async listArtifacts(runId: string): Promise<Array<{ name: string; size: number; format: string }>> {
    const baseDir = this.artifactsDir(runId);
    const results: Array<{ name: string; size: number; format: string }> = [];

    async function walkDir(dir: string, prefix: string) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walkDir(join(dir, entry.name), relativeName);
        } else {
          try {
            const s = await stat(join(dir, entry.name));
            results.push({ name: relativeName, size: s.size, format: inferFormat(entry.name) });
          } catch {
            // skip inaccessible files
          }
        }
      }
    }

    await walkDir(baseDir, '');
    return results;
  }

  async readArtifact(runId: string, fileName: string): Promise<{ content: Buffer; resolvedName: string } | null> {
    // Try exact match in artifacts
    const exact = await this.tryReadFile(join(this.artifactsDir(runId), fileName));
    if (exact !== null) return { content: exact, resolvedName: fileName };

    // Try exact match in uploads
    const upload = await this.tryReadFile(join(this.uploadsDir(runId), fileName));
    if (upload !== null) return { content: upload, resolvedName: fileName };

    // Extension fallback (agents often add .json, .md, etc.)
    const withExt = await this.tryReadWithExtension(this.artifactsDir(runId), fileName)
      ?? await this.tryReadWithExtension(this.uploadsDir(runId), fileName);
    return withExt;
  }

  private async tryReadFile(path: string): Promise<Buffer | null> {
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }
}

function inferFormat(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'txt') return 'text';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return 'image';
  return 'text';
}
