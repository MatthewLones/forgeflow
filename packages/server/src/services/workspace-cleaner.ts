import { readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Periodically cleans up old workspace directories based on a configurable TTL.
 */
export class WorkspaceCleaner {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private basePath: string,
    private retentionMs: number = 24 * 60 * 60 * 1000, // 24 hours default
  ) {}

  /**
   * Start periodic cleanup (runs immediately then every hour).
   */
  start(): void {
    this.cleanup().catch(() => {});
    this.interval = setInterval(() => {
      this.cleanup().catch(() => {});
    }, 60 * 60 * 1000); // every hour
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Delete workspace directories older than the retention period.
   */
  async cleanup(): Promise<number> {
    let dirs: string[];
    try {
      dirs = await readdir(this.basePath);
    } catch {
      return 0;
    }

    const now = Date.now();
    let cleaned = 0;

    for (const dir of dirs) {
      const dirPath = join(this.basePath, dir);
      try {
        const s = await stat(dirPath);
        if (s.isDirectory() && now - s.mtimeMs > this.retentionMs) {
          await rm(dirPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        // Skip entries that can't be stat'd
      }
    }

    if (cleaned > 0) {
      console.log(`WorkspaceCleaner: removed ${cleaned} expired workspace(s)`);
    }

    return cleaned;
  }

  /**
   * Clean up a specific run's workspace.
   */
  async cleanupRun(runId: string): Promise<void> {
    const dirPath = join(this.basePath, runId);
    await rm(dirPath, { recursive: true, force: true });
  }
}
