import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Response } from 'express';
import type {
  FlowDefinition,
  ProgressEvent,
  RunState,
  RunResult,
  InterruptAnswer,
  Interrupt,
} from '@forgeflow/types';
import {
  FlowOrchestrator,
  MockRunner,
  ClaudeAgentRunner,
  DockerAgentRunner,
} from '@forgeflow/engine';
import type { AgentRunner, MockBehavior } from '@forgeflow/engine';
import { LocalStateStore } from '@forgeflow/state-store';

export type RunnerType = 'mock' | 'local' | 'docker';

interface PendingInterrupt {
  interrupt: Interrupt;
  resolve: (answer: InterruptAnswer) => void;
  reject: (error: Error) => void;
}

interface ActiveRun {
  runId: string;
  projectId: string;
  orchestrator: FlowOrchestrator;
  sseClients: Set<Response>;
  pendingInterrupt: PendingInterrupt | null;
  events: ProgressEvent[];
  resultPromise: Promise<RunResult>;
  result: RunResult | null;
}

/**
 * Manages active flow runs, SSE streaming, and interrupt bridging.
 */
export class RunManager {
  private runs = new Map<string, ActiveRun>();
  private stateStore: LocalStateStore;
  private runsBasePath: string;

  constructor() {
    const home = homedir();
    this.runsBasePath = join(home, '.forgeflow', 'runs');
    this.stateStore = new LocalStateStore(this.runsBasePath);
  }

  async startRun(
    projectId: string,
    flow: FlowDefinition,
    runnerType: RunnerType,
    options?: { model?: string; apiKey?: string; skillPaths?: string[] },
  ): Promise<string> {
    const runner = this.createRunner(runnerType, options);

    // We'll capture the runId after orchestrator starts
    let capturedRunId = '';
    const events: ProgressEvent[] = [];
    const sseClients = new Set<Response>();
    let pendingInterrupt: PendingInterrupt | null = null;

    const interruptHandler = async (interrupt: Interrupt): Promise<InterruptAnswer> => {
      return new Promise<InterruptAnswer>((resolve, reject) => {
        const run = this.runs.get(capturedRunId);
        if (run) {
          run.pendingInterrupt = { interrupt, resolve, reject };
        } else {
          pendingInterrupt = { interrupt, resolve, reject };
        }

        // Emit interrupt event to SSE clients
        const event: ProgressEvent = { type: 'interrupt', interrupt };
        this.broadcastEvent(capturedRunId, event);
      });
    };

    const orchestrator = new FlowOrchestrator(runner, this.stateStore, {
      onProgress: (event: ProgressEvent) => {
        events.push(event);
        this.broadcastEvent(capturedRunId, event);

        // Capture runId from resume events
        if (event.type === 'resume') {
          capturedRunId = event.runId;
        }
      },
      skillSearchPaths: options?.skillPaths ?? [],
      interruptHandler,
    });

    // Start execution (don't await — it runs in background)
    const resultPromise = orchestrator.execute(flow, []).then((result) => {
      const run = this.runs.get(result.runId);
      if (run) {
        run.result = result;
        // Send run_completed if not already sent by engine
        if (result.status === 'completed' || result.status === 'failed') {
          // Close SSE connections
          for (const client of run.sseClients) {
            client.write(`event: done\ndata: ${JSON.stringify({ status: result.status })}\n\n`);
            client.end();
          }
          run.sseClients.clear();
        }
      }
      return result;
    });

    // We need to get the runId synchronously. The orchestrator generates it internally.
    // Wait briefly for the first event or state save to capture it.
    // Actually, the orchestrator.execute() creates the runId immediately and saves state.
    // Let's wait for the first progress event or a small timeout.
    const runId = await this.waitForRunId(resultPromise, events);
    capturedRunId = runId;

    const activeRun: ActiveRun = {
      runId,
      projectId,
      orchestrator,
      sseClients,
      pendingInterrupt,
      events,
      resultPromise,
      result: null,
    };
    this.runs.set(runId, activeRun);

    return runId;
  }

  private async waitForRunId(
    resultPromise: Promise<RunResult>,
    events: ProgressEvent[],
  ): Promise<string> {
    // Race: either the result comes back quickly (e.g. validation failure)
    // or we poll for the first event that contains a runId.
    // For simplicity, wait for the result promise with a short timeout,
    // or check the state store for the most recent run.
    const result = await Promise.race([
      resultPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);

    if (result) return result.runId;

    // Check state store for most recent run
    const { readdir } = await import('node:fs/promises');
    try {
      const dirs = await readdir(this.runsBasePath);
      // Sort by modification time (most recent first)
      const sorted = dirs.sort().reverse();
      if (sorted.length > 0) return sorted[0];
    } catch {
      // Directory may not exist yet
    }

    // Fallback: generate a UUID (shouldn't normally happen)
    const { randomUUID } = await import('node:crypto');
    return randomUUID();
  }

  async resumeRun(
    runId: string,
    flow: FlowDefinition,
    checkpointInput: { fileName: string; content: Buffer },
    runnerType: RunnerType,
    options?: { model?: string; apiKey?: string; skillPaths?: string[] },
  ): Promise<string> {
    const runner = this.createRunner(runnerType, options);
    const events: ProgressEvent[] = [];
    const sseClients = new Set<Response>();

    const interruptHandler = async (interrupt: Interrupt): Promise<InterruptAnswer> => {
      return new Promise<InterruptAnswer>((resolve, reject) => {
        const run = this.runs.get(runId);
        if (run) {
          run.pendingInterrupt = { interrupt, resolve, reject };
        }
        const event: ProgressEvent = { type: 'interrupt', interrupt };
        this.broadcastEvent(runId, event);
      });
    };

    const orchestrator = new FlowOrchestrator(runner, this.stateStore, {
      onProgress: (event: ProgressEvent) => {
        events.push(event);
        this.broadcastEvent(runId, event);
      },
      skillSearchPaths: options?.skillPaths ?? [],
      interruptHandler,
    });

    const resultPromise = orchestrator.resume(flow, runId, checkpointInput).then((result) => {
      const run = this.runs.get(runId);
      if (run) {
        run.result = result;
        for (const client of run.sseClients) {
          client.write(`event: done\ndata: ${JSON.stringify({ status: result.status })}\n\n`);
          client.end();
        }
        run.sseClients.clear();
      }
      return result;
    });

    const activeRun: ActiveRun = {
      runId,
      projectId: flow.id,
      orchestrator,
      sseClients,
      pendingInterrupt: null,
      events,
      resultPromise,
      result: null,
    };
    this.runs.set(runId, activeRun);

    return runId;
  }

  answerInterrupt(runId: string, answer: InterruptAnswer): boolean {
    const run = this.runs.get(runId);
    if (!run?.pendingInterrupt) return false;

    run.pendingInterrupt.resolve(answer);
    run.pendingInterrupt = null;
    return true;
  }

  subscribeProgress(runId: string, res: Response): (() => void) {
    const run = this.runs.get(runId);
    if (!run) {
      // Run may have already completed — check state store
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Run not found or already completed' })}\n\n`);
      res.end();
      return () => {};
    }

    // Send all past events first (replay)
    for (const event of run.events) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }

    // If already done, send done and close
    if (run.result) {
      res.write(`event: done\ndata: ${JSON.stringify({ status: run.result.status })}\n\n`);
      res.end();
      return () => {};
    }

    run.sseClients.add(res);

    return () => {
      run.sseClients.delete(res);
    };
  }

  async getRunState(runId: string): Promise<RunState | null> {
    return this.stateStore.loadRunState(runId);
  }

  async listRuns(projectId?: string): Promise<RunState[]> {
    const { readdir } = await import('node:fs/promises');
    let dirs: string[];
    try {
      dirs = await readdir(this.runsBasePath);
    } catch {
      return [];
    }

    const results: RunState[] = [];
    for (const dir of dirs) {
      const state = await this.stateStore.loadRunState(dir);
      if (state) {
        if (!projectId || state.flowId === projectId) {
          results.push(state);
        }
      }
    }

    // Sort by startedAt descending (most recent first)
    results.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    return results;
  }

  async listArtifacts(runId: string): Promise<Array<{ name: string; size: number }>> {
    return this.stateStore.listArtifacts(runId);
  }

  async readArtifact(runId: string, fileName: string): Promise<Buffer | null> {
    return this.stateStore.readArtifact(runId, fileName);
  }

  private broadcastEvent(runId: string, event: ProgressEvent): void {
    const run = this.runs.get(runId);
    if (!run) return;

    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of run.sseClients) {
      client.write(data);
    }
  }

  private createRunner(
    type: RunnerType,
    options?: { model?: string; apiKey?: string },
  ): AgentRunner {
    switch (type) {
      case 'mock':
        return new MockRunner(new Map<string, MockBehavior>());
      case 'local':
        return new ClaudeAgentRunner({
          model: options?.model,
          apiKey: options?.apiKey,
        });
      case 'docker':
        return new DockerAgentRunner({
          model: options?.model,
          apiKey: options?.apiKey,
        });
    }
  }
}

// Singleton
export const runManager = new RunManager();
