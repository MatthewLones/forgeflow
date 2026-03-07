import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { watch } from 'chokidar';
import type { Interrupt, InterruptAnswer, EscalatedAnswer, ProgressEvent } from '@forgeflow/types';

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
  /** Current node ID (used for file_written and escalation events) */
  nodeId?: string;
  /** Timeout in ms before escalating an inline interrupt to a checkpoint */
  escalateTimeoutMs?: number;
  /** Called when an interrupt is escalated due to timeout */
  onEscalation?: (interrupt: Interrupt) => void;
}

/**
 * Watches the workspace output/ directory for signal files and regular output files.
 *
 * Signal files handled:
 * - __INTERRUPT__*.json → queued for sequential handler processing
 * - __CHILD_START__*.json → fire-and-forget progress event
 * - __CHILD_DONE__*.json → fire-and-forget progress event
 * - __ANSWER__*.json → ignored (written by us)
 *
 * Regular files → emit file_written progress event
 */
export class InterruptWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private seen = new Set<string>();
  private interruptQueue: Array<{ filePath: string; fileName: string }> = [];
  private draining = false;
  private options: InterruptWatcherOptions | null = null;
  private outputDir = '';

  /** Set to true when an interrupt is escalated due to handler timeout */
  public escalated = false;
  /** The interrupt that was escalated (for checkpoint state) */
  public escalatedInterrupt: Interrupt | null = null;

  async start(options: InterruptWatcherOptions): Promise<void> {
    this.options = options;
    this.outputDir = join(options.workspacePath, 'output');

    this.watcher = watch(this.outputDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    const handleFile = (filePath: string, isChange = false) => {
      const fileName = basename(filePath);

      // Subtask progress file — read on both add and change (not added to seen)
      if (fileName === '__PROGRESS__.json') {
        this.handleProgressFile(filePath);
        return;
      }

      // For change events, only progress file is relevant
      if (isChange) return;

      // Prevent duplicate processing
      if (this.seen.has(fileName)) return;
      this.seen.add(fileName);

      // Child progress markers (JSON only): fire-and-forget
      if (fileName.startsWith('__CHILD_START__') && fileName.endsWith('.json')) {
        this.handleChildMarker(filePath, 'child_started');
        return;
      }
      if (fileName.startsWith('__CHILD_DONE__') && fileName.endsWith('.json')) {
        this.handleChildMarker(filePath, 'child_completed');
        return;
      }

      // Interrupt files (JSON only): queue for sequential processing
      if (fileName.startsWith('__INTERRUPT__') && fileName.endsWith('.json')) {
        this.interruptQueue.push({ filePath, fileName });
        this.drain();
        return;
      }

      // Skip answer files (we write these)
      if (fileName.startsWith('__ANSWER__')) return;

      // Regular output file → emit file_written event
      this.handleRegularFile(filePath, fileName);
    };

    this.watcher.on('add', (filePath: string) => handleFile(filePath));
    this.watcher.on('change', (filePath: string) => handleFile(filePath, true));

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', resolve);
    });
  }

  /**
   * Process interrupt queue sequentially — one handler at a time.
   * Supports auto-escalation: if handler doesn't respond within timeout,
   * writes an escalated answer and sets the escalated flag.
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    while (this.interruptQueue.length > 0) {
      const { filePath, fileName } = this.interruptQueue.shift()!;
      try {
        const content = await readFile(filePath, 'utf-8');
        const interrupt: Interrupt = JSON.parse(content);

        // Emit interrupt progress event
        this.options?.onProgress?.({ type: 'interrupt', interrupt });

        // Determine timeout: interrupt-specific first, then watcher-level
        const timeoutMs = interrupt.timeoutMs ?? this.options?.escalateTimeoutMs;

        let answer: InterruptAnswer;

        if (timeoutMs && interrupt.mode === 'inline') {
          // Race handler against timeout
          const timeoutPromise = new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), timeoutMs),
          );

          const result = await Promise.race([
            this.options!.onInterrupt(interrupt).then((a) => ({ type: 'answer' as const, answer: a })),
            timeoutPromise,
          ]);

          if (result === 'timeout') {
            this.escalated = true;
            this.escalatedInterrupt = interrupt;

            answer = {
              decision: 'escalated',
              originalInterruptId: interrupt.interrupt_id,
              reason: 'timeout',
            } as EscalatedAnswer;

            this.options?.onProgress?.({
              type: 'escalation_timeout',
              interruptId: interrupt.interrupt_id,
              nodeId: this.options?.nodeId ?? 'unknown',
              timeoutMs,
            });

            this.options?.onEscalation?.(interrupt);
          } else {
            answer = result.answer;
          }
        } else {
          // No timeout or checkpoint mode — call handler directly
          answer = await this.options!.onInterrupt(interrupt);
        }

        // Write answer file
        const answerFileName = `__ANSWER__${interrupt.interrupt_id}.json`;
        await writeFile(
          join(this.outputDir, answerFileName),
          JSON.stringify(answer, null, 2),
        );

        // Emit interrupt_answered event
        this.options?.onProgress?.({
          type: 'interrupt_answered',
          interruptId: interrupt.interrupt_id,
          nodeId: this.options?.nodeId ?? 'unknown',
          escalated: this.escalated,
        });
      } catch (error) {
        // Log but don't crash — the agent will timeout and handle gracefully
        console.error(
          `InterruptWatcher: failed to handle ${fileName}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    this.draining = false;
  }

  /**
   * Handle child progress marker files (fire-and-forget, no queueing needed).
   */
  private async handleChildMarker(
    filePath: string,
    eventType: 'child_started' | 'child_completed',
  ): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.options?.onProgress?.({
        type: eventType,
        childId: data.childId,
        childName: data.childName ?? data.childId,
        parentPath: data.parentPath ?? [],
        ...(eventType === 'child_completed' ? { outputFiles: data.outputFiles ?? [] } : {}),
      } as ProgressEvent);
    } catch {
      // Malformed marker — ignore silently
    }
  }

  /**
   * Handle subtask progress file — emit subtask_update progress event.
   */
  private async handleProgressFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      if (Array.isArray(data.subtasks)) {
        this.options?.onProgress?.({
          type: 'subtask_update',
          nodeId: this.options?.nodeId ?? 'unknown',
          subtasks: data.subtasks,
        });
      }
    } catch {
      // Partial write or malformed — ignore
    }
  }

  /**
   * Handle regular output files — emit file_written progress event.
   */
  private async handleRegularFile(filePath: string, fileName: string): Promise<void> {
    try {
      const stats = await stat(filePath);
      this.options?.onProgress?.({
        type: 'file_written',
        fileName,
        fileSize: stats.size,
        nodeId: this.options?.nodeId ?? 'unknown',
      });
    } catch {
      // File may have been moved/deleted between detection and stat
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.seen.clear();
    this.interruptQueue.length = 0;
    this.draining = false;
    this.options = null;
    this.escalated = false;
    this.escalatedInterrupt = null;
  }
}
