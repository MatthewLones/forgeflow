import { join } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import type { Response } from 'express';
import type {
  FlowDefinition,
  ProgressEvent,
  RunState,
  RunResult,
  InterruptAnswer,
  Interrupt,
  StateFile,
} from '@forgeflow/types';
import {
  FlowOrchestrator,
  MockRunner,
  ClaudeAgentRunner,
} from '@forgeflow/engine';
import type { AgentRunner, MockBehavior } from '@forgeflow/engine';
import { LocalStateStore } from '@forgeflow/state-store';

/* ── Logger ──────────────────────────────────────────────── */

const LOG_PREFIX = '[RunManager]';

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args);
}

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
  readonly workspaceBasePath: string;

  constructor() {
    const home = homedir();
    this.runsBasePath = join(home, '.forgeflow', 'runs');
    this.workspaceBasePath = join(home, '.forgeflow', 'workspaces');
    this.stateStore = new LocalStateStore(this.runsBasePath);
    this.cleanupOrphanedRuns();
  }

  /**
   * On startup, mark any runs stuck in 'running' or 'awaiting_input' as failed.
   * These are orphans from a previous server session that can never complete.
   */
  private cleanupOrphanedRuns(): void {
    try {
      const dirs = readdirSync(this.runsBasePath, { withFileTypes: true });
      let cleaned = 0;
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const stateFile = join(this.runsBasePath, dir.name, 'state.json');
        try {
          const raw = readFileSync(stateFile, 'utf-8');
          const state = JSON.parse(raw);
          if (state.status === 'running' || state.status === 'awaiting_input') {
            state.status = 'failed';
            state.error = 'Server restarted - run orphaned';
            state.updatedAt = new Date().toISOString();
            writeFileSync(stateFile, JSON.stringify(state, null, 2));
            cleaned++;
          }
        } catch {
          // Skip invalid state files
        }
      }
      if (cleaned > 0) {
        log(`cleaned up ${cleaned} orphaned runs from previous server session`);
      }
    } catch {
      // Runs directory may not exist yet
    }
  }

  async startRun(
    projectId: string,
    flow: FlowDefinition,
    runnerType: RunnerType,
    options?: { model?: string; apiKey?: string; skillPaths?: string[]; userUploads?: StateFile[] },
  ): Promise<string> {
    log(`startRun: project=${projectId} runner=${runnerType} uploads=${options?.userUploads?.length ?? 0}`);
    const runner = await this.createRunner(runnerType, options);

    // Generate runId up front so we can register the ActiveRun before execution starts.
    // This avoids a race where fast runs (mock) complete before the map entry exists.
    const { randomUUID } = await import('node:crypto');
    const runId = randomUUID();

    const events: ProgressEvent[] = [];
    const sseClients = new Set<Response>();

    const interruptHandler = async (interrupt: Interrupt): Promise<InterruptAnswer> => {
      return new Promise<InterruptAnswer>((resolve, reject) => {
        const run = this.runs.get(runId);
        if (run) {
          run.pendingInterrupt = { interrupt, resolve, reject };
        }
        // NOTE: Do NOT broadcast here — InterruptWatcher already emits the
        // interrupt event via onProgress, which handles persistence + SSE.
      });
    };

    const orchestrator = new FlowOrchestrator(runner, this.stateStore, {
      onProgress: (event: ProgressEvent) => {
        events.push(event);
        this.persistEvent(runId, event);
        this.broadcastEvent(runId, event);
      },
      skillSearchPaths: options?.skillPaths ?? [],
      interruptHandler,
      workspaceBasePath: this.workspaceBasePath,
      preserveWorkspace: true,
    });

    // Register the ActiveRun BEFORE starting execution so the .then() callback
    // and SSE subscribers can always find it in the map.
    const activeRun: ActiveRun = {
      runId,
      projectId,
      orchestrator,
      sseClients,
      pendingInterrupt: null,
      events,
      resultPromise: null as unknown as Promise<RunResult>, // set below
      result: null,
    };
    this.runs.set(runId, activeRun);

    // Start execution (don't await — it runs in background)
    // Pass runId so the orchestrator uses our pre-generated ID
    activeRun.resultPromise = orchestrator.execute(flow, options?.userUploads ?? [], runId).then((result) => {
      log(`run ${runId} completed: status=${result.status}`);
      activeRun.result = result;

      // Close SSE connections
      for (const client of activeRun.sseClients) {
        client.write(`event: done\ndata: ${JSON.stringify({ status: result.status })}\n\n`);
        client.end();
      }
      activeRun.sseClients.clear();

      return result;
    }).catch((err) => {
      logError(`run ${runId} crashed:`, err);
      activeRun.result = {
        runId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        outputs: [],
        totalCost: { turns: 0, usd: 0 },
      } as RunResult;

      // Close SSE connections with failure
      for (const client of activeRun.sseClients) {
        client.write(`event: done\ndata: ${JSON.stringify({ status: 'failed' })}\n\n`);
        client.end();
      }
      activeRun.sseClients.clear();

      return activeRun.result;
    });

    log(`run ${runId} started, execution in background`);
    return runId;
  }

  async resumeRun(
    runId: string,
    flow: FlowDefinition,
    checkpointInputs: Array<{ fileName: string; content: Buffer }>,
    runnerType: RunnerType,
    options?: { model?: string; apiKey?: string; skillPaths?: string[] },
  ): Promise<string> {
    log(`resumeRun: runId=${runId} runner=${runnerType} files=${checkpointInputs.length}`);
    const runner = await this.createRunner(runnerType, options);
    const events: ProgressEvent[] = [];
    const sseClients = new Set<Response>();

    const interruptHandler = async (interrupt: Interrupt): Promise<InterruptAnswer> => {
      return new Promise<InterruptAnswer>((resolve, reject) => {
        const run = this.runs.get(runId);
        if (run) {
          run.pendingInterrupt = { interrupt, resolve, reject };
        }
        // NOTE: Do NOT broadcast here — InterruptWatcher already emits the
        // interrupt event via onProgress, which handles persistence + SSE.
      });
    };

    const orchestrator = new FlowOrchestrator(runner, this.stateStore, {
      onProgress: (event: ProgressEvent) => {
        events.push(event);
        this.persistEvent(runId, event);
        this.broadcastEvent(runId, event);
      },
      skillSearchPaths: options?.skillPaths ?? [],
      interruptHandler,
      workspaceBasePath: this.workspaceBasePath,
      preserveWorkspace: true,
    });

    const resultPromise = orchestrator.resume(flow, runId, checkpointInputs).then((result) => {
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
    }).catch((err) => {
      logError(`resume ${runId} crashed:`, err);
      const run = this.runs.get(runId);
      const failResult: RunResult = {
        runId,
        success: false,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        outputFiles: [],
        totalCost: { turns: 0, usd: 0 },
      };
      if (run) {
        run.result = failResult;
        for (const client of run.sseClients) {
          client.write(`event: done\ndata: ${JSON.stringify({ status: 'failed' })}\n\n`);
          client.end();
        }
        run.sseClients.clear();
      }
      return failResult;
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

  /**
   * Retry a failed run from the phase that failed.
   * Re-uses the same runId — the orchestrator picks up from the failed phase.
   */
  async retryRun(
    runId: string,
    flow: FlowDefinition,
    runnerType: RunnerType,
    options?: { model?: string; apiKey?: string; skillPaths?: string[] },
  ): Promise<string> {
    log(`retryRun: runId=${runId} runner=${runnerType}`);
    const runner = await this.createRunner(runnerType, options);
    const events: ProgressEvent[] = [];
    const sseClients = new Set<Response>();

    const interruptHandler = async (interrupt: Interrupt): Promise<InterruptAnswer> => {
      return new Promise<InterruptAnswer>((resolve, reject) => {
        const run = this.runs.get(runId);
        if (run) {
          run.pendingInterrupt = { interrupt, resolve, reject };
        }
      });
    };

    const orchestrator = new FlowOrchestrator(runner, this.stateStore, {
      onProgress: (event: ProgressEvent) => {
        events.push(event);
        this.persistEvent(runId, event);
        this.broadcastEvent(runId, event);
      },
      skillSearchPaths: options?.skillPaths ?? [],
      interruptHandler,
      workspaceBasePath: this.workspaceBasePath,
      preserveWorkspace: true,
    });

    const resultPromise = orchestrator.retryFromFailure(flow, runId).then((result) => {
      log(`retry ${runId} completed: status=${result.status}`);
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
    }).catch((err) => {
      logError(`retry ${runId} crashed:`, err);
      const run = this.runs.get(runId);
      const failResult: RunResult = {
        runId,
        success: false,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        outputFiles: [],
        totalCost: { turns: 0, usd: 0 },
      };
      if (run) {
        run.result = failResult;
        for (const client of run.sseClients) {
          client.write(`event: done\ndata: ${JSON.stringify({ status: 'failed' })}\n\n`);
          client.end();
        }
        run.sseClients.clear();
      }
      return failResult;
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

  /**
   * Validate a checkpoint file without resuming the run.
   */
  async validateCheckpointFile(
    runId: string,
    fileName: string,
    content: Buffer,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const checkpoint = await this.stateStore.loadCheckpoint(runId);
    if (!checkpoint) {
      return { valid: false, errors: ['No checkpoint found for this run'] };
    }

    const expected = checkpoint.expectedFiles?.find((f) => f.fileName === fileName);
    if (!expected) {
      return { valid: false, errors: [`File "${fileName}" is not expected at this checkpoint`] };
    }

    const { validateCheckpointContent } = await import('@forgeflow/engine');
    return validateCheckpointContent(fileName, content, expected.schema);
  }

  answerInterrupt(runId: string, answer: InterruptAnswer): boolean {
    const run = this.runs.get(runId);
    if (!run?.pendingInterrupt) return false;

    run.pendingInterrupt.resolve(answer);
    run.pendingInterrupt = null;
    return true;
  }

  stopRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.result) return false;

    log(`stopRun: stopping run ${runId}`);

    // Mark as stopped
    run.result = {
      runId,
      status: 'failed',
      error: 'Run stopped by user',
      outputs: [],
      totalCost: { turns: 0, usd: 0 },
    } as RunResult;

    // Reject any pending interrupt
    if (run.pendingInterrupt) {
      run.pendingInterrupt.reject(new Error('Run stopped by user'));
      run.pendingInterrupt = null;
    }

    // Broadcast run_completed event + done
    const completeEvent: ProgressEvent = {
      type: 'run_completed',
      success: false,
      totalCost: { turns: 0, usd: 0 },
    };
    run.events.push(completeEvent);
    this.persistEvent(runId, completeEvent);
    this.broadcastEvent(runId, completeEvent);

    for (const client of run.sseClients) {
      client.write(`event: done\ndata: ${JSON.stringify({ status: 'failed' })}\n\n`);
      client.end();
    }
    run.sseClients.clear();

    return true;
  }

  subscribeProgress(runId: string, res: Response): (() => void) {
    const run = this.runs.get(runId);

    // Run not in active map — try loading events from disk (historical/completed run)
    if (!run) {
      const diskEvents = this.loadEventsFromDisk(runId);
      if (diskEvents.length > 0) {
        log(`subscribeProgress: run ${runId} not active, replaying ${diskEvents.length} events from disk`);
        for (const event of diskEvents) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        // Determine final status from events
        const lastRunComplete = [...diskEvents].reverse().find((e) => e.type === 'run_completed');
        const status = lastRunComplete ? (lastRunComplete.success ? 'completed' : 'failed') : 'completed';
        res.write(`event: done\ndata: ${JSON.stringify({ status })}\n\n`);
        res.end();
        return () => {};
      }

      log(`subscribeProgress: run ${runId} not found (no active run, no disk events)`);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Run not found or already completed' })}\n\n`);
      res.end();
      return () => {};
    }

    log(`subscribeProgress: run ${runId}, replaying ${run.events.length} events, done=${!!run.result}`);

    // Send all past events first (replay)
    for (const event of run.events) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }

    // If already done, send done and close
    if (run.result) {
      log(`subscribeProgress: run ${runId} already done (${run.result.status}), sending done`);
      res.write(`event: done\ndata: ${JSON.stringify({ status: run.result.status })}\n\n`);
      res.end();
      return () => {};
    }

    run.sseClients.add(res);
    log(`subscribeProgress: run ${runId}, SSE client added (total: ${run.sseClients.size})`);

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

  async listArtifacts(runId: string): Promise<Array<{ name: string; size: number; format: string }>> {
    return this.stateStore.listArtifacts(runId);
  }

  async readArtifact(runId: string, fileName: string): Promise<{ content: Buffer; resolvedName: string } | null> {
    return this.stateStore.readArtifact(runId, fileName);
  }

  /**
   * List workspace files for a run, organized by phase.
   */
  async listWorkspaceFiles(runId: string): Promise<{
    phases: Array<{
      phaseId: string;
      files: Array<{ path: string; size: number }>;
    }>;
  }> {
    const { readdir, stat } = await import('node:fs/promises');
    const runWorkspace = join(this.workspaceBasePath, runId);

    let phaseDirs: string[];
    try {
      phaseDirs = await readdir(runWorkspace);
    } catch {
      return { phases: [] };
    }

    const phases: Array<{ phaseId: string; files: Array<{ path: string; size: number }> }> = [];

    for (const phaseId of phaseDirs) {
      const phaseDir = join(runWorkspace, phaseId);
      const files: Array<{ path: string; size: number }> = [];

      const walk = async (dir: string, prefix: string) => {
        let entries: string[];
        try {
          entries = await readdir(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const s = await stat(fullPath);
          if (s.isDirectory()) {
            await walk(fullPath, prefix ? `${prefix}/${entry}` : entry);
          } else {
            files.push({ path: prefix ? `${prefix}/${entry}` : entry, size: s.size });
          }
        }
      };

      await walk(phaseDir, '');
      if (files.length > 0) {
        phases.push({ phaseId, files });
      }
    }

    return { phases };
  }

  /**
   * Read a specific workspace file.
   */
  async readWorkspaceFile(runId: string, phaseId: string, filePath: string): Promise<Buffer | null> {
    const { readFile } = await import('node:fs/promises');
    const fullPath = join(this.workspaceBasePath, runId, phaseId, filePath);

    // Prevent directory traversal
    const resolved = (await import('node:path')).resolve(fullPath);
    const base = (await import('node:path')).resolve(join(this.workspaceBasePath, runId, phaseId));
    if (!resolved.startsWith(base)) return null;

    try {
      return await readFile(fullPath);
    } catch {
      return null;
    }
  }

  /**
   * Get the stored events for a run (for summary computation).
   */
  getRunEvents(runId: string): ProgressEvent[] {
    // Fast path: run is active in memory
    const run = this.runs.get(runId);
    if (run) return run.events;
    // Fallback: load from disk for historical/completed runs
    return this.loadEventsFromDisk(runId);
  }

  /**
   * Compute a post-run summary from stored events and state.
   */
  async computeSummary(runId: string): Promise<Record<string, unknown> | null> {
    const state = await this.stateStore.loadRunState(runId);
    if (!state) return null;

    const events = this.getRunEvents(runId);

    // Phase summaries
    const phaseMap = new Map<string, {
      nodeId: string;
      nodeName: string;
      startIndex: number;
      endIndex: number;
      cost: number;
      outputFiles: string[];
      missingOutputs: string[];
      toolCallCount: number;
      textBlockCount: number;
    }>();

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'phase_started') {
        phaseMap.set(e.nodeId, {
          nodeId: e.nodeId,
          nodeName: e.nodeName,
          startIndex: i,
          endIndex: -1,
          cost: 0,
          outputFiles: [],
          missingOutputs: [],
          toolCallCount: 0,
          textBlockCount: 0,
        });
      } else if (e.type === 'phase_completed') {
        const phase = phaseMap.get(e.nodeId);
        if (phase) {
          phase.endIndex = i;
          phase.cost = e.cost;
          phase.outputFiles = e.outputFiles;
          phase.missingOutputs = e.missingOutputs ?? [];
        }
      } else if (e.type === 'phase_failed') {
        const phase = phaseMap.get(e.nodeId);
        if (phase) phase.endIndex = i;
      } else if (e.type === 'tool_call') {
        const phase = phaseMap.get(e.nodeId);
        if (phase) phase.toolCallCount++;
      } else if (e.type === 'text_block') {
        const phase = phaseMap.get(e.nodeId);
        if (phase) phase.textBlockCount++;
      }
    }

    // Artifacts
    const artifacts = await this.stateStore.listArtifacts(runId);
    const artifactProducers = new Map<string, string>();
    for (const e of events) {
      if (e.type === 'phase_completed') {
        for (const file of e.outputFiles) {
          artifactProducers.set(file, e.nodeId);
        }
      }
    }

    // Interrupts
    const interrupts: Array<{
      id: string;
      type: string;
      nodeId: string;
      escalated: boolean;
    }> = [];
    for (const e of events) {
      if (e.type === 'interrupt') {
        interrupts.push({
          id: e.interrupt.interrupt_id,
          type: e.interrupt.type,
          nodeId: e.interrupt.source.agentPath[0] ?? '',
          escalated: false,
        });
      } else if (e.type === 'interrupt_answered') {
        const found = interrupts.find((i) => i.id === e.interruptId);
        if (found) found.escalated = e.escalated;
      }
    }

    // Errors
    const errors: string[] = [];
    for (const e of events) {
      if (e.type === 'phase_failed') {
        errors.push(`Phase "${e.nodeId}" failed: ${e.error}`);
      }
    }
    if (state.error) errors.push(state.error);

    return {
      runId,
      status: state.status,
      duration: {
        startedAt: state.startedAt,
        completedAt: state.updatedAt,
      },
      cost: state.totalCost,
      phases: [...phaseMap.values()].map((p) => ({
        nodeId: p.nodeId,
        nodeName: p.nodeName,
        cost: p.cost,
        outputFiles: p.outputFiles,
        missingOutputs: p.missingOutputs,
        toolCallCount: p.toolCallCount,
        textBlockCount: p.textBlockCount,
      })),
      artifacts: artifacts.map((a) => ({
        name: a.name,
        size: a.size,
        format: a.format,
        producedBy: artifactProducers.get(a.name) ?? 'unknown',
      })),
      errors,
      interrupts,
    };
  }

  /**
   * Append a progress event to the run's NDJSON event log on disk.
   */
  private persistEvent(runId: string, event: ProgressEvent): void {
    try {
      const runDir = join(this.runsBasePath, runId);
      if (!existsSync(runDir)) {
        mkdirSync(runDir, { recursive: true });
      }
      const eventsFile = join(runDir, 'events.ndjson');
      appendFileSync(eventsFile, JSON.stringify(event) + '\n');
    } catch (err) {
      logError(`persistEvent: failed to write event for run ${runId}:`, err);
    }
  }

  /**
   * Load persisted events from disk for a completed/historical run.
   */
  private loadEventsFromDisk(runId: string): ProgressEvent[] {
    try {
      const eventsFile = join(this.runsBasePath, runId, 'events.ndjson');
      const raw = readFileSync(eventsFile, 'utf-8');
      const events: ProgressEvent[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as ProgressEvent);
        } catch {
          // Skip malformed lines
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  private broadcastEvent(runId: string, event: ProgressEvent): void {
    const run = this.runs.get(runId);
    if (!run) {
      logError(`broadcastEvent: run ${runId} not in map, dropping ${event.type} event`);
      return;
    }

    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    if (run.sseClients.size > 0) {
      log(`broadcast: ${event.type} → ${run.sseClients.size} clients`);
    }
    for (const client of run.sseClients) {
      client.write(data);
    }
  }

  private async createRunner(
    type: RunnerType,
    options?: { model?: string; apiKey?: string },
  ): Promise<AgentRunner> {
    switch (type) {
      case 'mock':
        return new MockRunner(new Map<string, MockBehavior>());
      case 'local':
        return new ClaudeAgentRunner({
          model: options?.model,
          apiKey: options?.apiKey,
        });
      case 'docker': {
        // Lazy-load from subpath to avoid pulling in dockerode/ssh2 native
        // modules at startup — they cause NODE_MODULE_VERSION crashes in Electron.
        const { DockerAgentRunner } = await import('@forgeflow/engine/docker');
        return new DockerAgentRunner({
          model: options?.model,
          apiKey: options?.apiKey,
        });
      }
    }
  }
}

// Singleton
export const runManager = new RunManager();
