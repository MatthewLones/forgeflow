import { readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { watch } from 'chokidar';
import type { Interrupt, InterruptAnswer, ProgressEvent } from '@forgeflow/types';

/**
 * Async callback that receives an interrupt and returns the answer.
 * The CLI would prompt stdin; the frontend would wait for a WebSocket message.
 */
export type InterruptHandler = (interrupt: Interrupt) => Promise<InterruptAnswer>;

export interface InterruptWatcherOptions {
  /** Host-side workspace path (works for both local and Docker mounted volumes) */
  workspacePath: string;
  /** Handler that resolves the interrupt (e.g., by prompting the user) */
  onInterrupt: InterruptHandler;
  /** Optional progress event callback */
  onProgress?: (event: ProgressEvent) => void;
}

/**
 * Watches the workspace output/ directory for __INTERRUPT__*.json files.
 *
 * When an interrupt file is detected:
 * 1. Parse the interrupt JSON
 * 2. Emit an interrupt progress event
 * 3. Call the handler to get the answer
 * 4. Write __ANSWER__{id}.json back to the output directory
 *
 * Works identically for local filesystem and Docker mounted volumes
 * (always watches the host-side path).
 */
export class InterruptWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private processing = new Set<string>();

  async start(options: InterruptWatcherOptions): Promise<void> {
    const outputDir = join(options.workspacePath, 'output');

    this.watcher = watch(outputDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', async (filePath: string) => {
      const fileName = basename(filePath);

      // Only handle __INTERRUPT__*.json files
      if (!fileName.startsWith('__INTERRUPT__') || !fileName.endsWith('.json')) return;

      // Prevent duplicate processing
      if (this.processing.has(fileName)) return;
      this.processing.add(fileName);

      try {
        const content = await readFile(filePath, 'utf-8');
        const interrupt: Interrupt = JSON.parse(content);

        // Emit interrupt progress event
        options.onProgress?.({ type: 'interrupt', interrupt });

        // Call handler to get the answer
        const answer = await options.onInterrupt(interrupt);

        // Write answer file: __ANSWER__{interrupt_id}.json
        const answerFileName = `__ANSWER__${interrupt.interrupt_id}.json`;
        await writeFile(
          join(outputDir, answerFileName),
          JSON.stringify(answer, null, 2),
        );
      } catch (error) {
        // Log but don't crash — the agent will timeout and handle gracefully
        console.error(
          `InterruptWatcher: failed to handle ${fileName}:`,
          error instanceof Error ? error.message : error,
        );
      } finally {
        this.processing.delete(fileName);
      }
    });

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', resolve);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.processing.clear();
  }
}
