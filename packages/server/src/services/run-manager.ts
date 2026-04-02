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
    const runner = await this.createRunner(runnerType, options, flow);

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
    const runner = await this.createRunner(runnerType, options, flow);
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
    const runner = await this.createRunner(runnerType, options, flow);
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
    // Normalize: agents reference files as "output/name" (relative to workspace root)
    // but storage and workspace search use just "name" (relative to the output/ dir)
    const normalized = fileName.replace(/^output\//, '');

    // Try state store first (artifacts + uploads)
    const result = await this.stateStore.readArtifact(runId, normalized);
    if (result) return result;

    // Fallback: search workspace output directories (for mid-phase files like review drafts)
    const wsResult = await this.readFromWorkspace(runId, normalized);
    if (wsResult) return wsResult;

    // Retry once for active runs — file may still be stabilizing
    // (chokidar awaitWriteFinish has a 200ms threshold; the UI fetch can arrive before it settles)
    const activeRun = this.runs.get(runId);
    if (activeRun && !activeRun.result) {
      await new Promise((r) => setTimeout(r, 500));
      return this.readFromWorkspace(runId, normalized);
    }

    return null;
  }

  /**
   * Search workspace output directories for a file by name.
   * Handles extension fallback (e.g., "draft_blog" matches "draft_blog.md").
   */
  private async readFromWorkspace(runId: string, fileName: string): Promise<{ content: Buffer; resolvedName: string } | null> {
    try {
      const { readdir, readFile } = await import('node:fs/promises');
      const { resolve } = await import('node:path');
      const runWorkspace = join(this.workspaceBasePath, runId);
      let phaseDirs: string[];
      try {
        phaseDirs = await readdir(runWorkspace);
      } catch {
        return null;
      }
      for (const phaseId of phaseDirs) {
        const outputDir = join(runWorkspace, phaseId, 'output');
        // Try exact match
        const exactPath = join(outputDir, fileName);
        const resolvedExact = resolve(exactPath);
        const base = resolve(outputDir);
        if (resolvedExact.startsWith(base)) {
          try {
            const content = await readFile(exactPath);
            return { content, resolvedName: fileName };
          } catch { /* not in this phase */ }
        }
        // Try extension fallback (e.g., "draft_blog" -> "draft_blog.md")
        try {
          const files = await readdir(outputDir);
          const baseName = fileName.replace(/\.[^.]+$/, '');
          const match = files.find((f) => f === fileName || f.replace(/\.[^.]+$/, '') === baseName || f.replace(/\.[^.]+$/, '') === fileName);
          if (match) {
            const matchPath = join(outputDir, match);
            const content = await readFile(matchPath);
            return { content, resolvedName: match };
          }
        } catch { /* no output dir for this phase */ }
      }
    } catch { /* fallback failed */ }

    return null;
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

    // Track the latest active (unfinished) phase per nodeId for lookups
    const activePhaseKey = new Map<string, string>();

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'phase_started') {
        // Use a unique key to avoid overwriting on retry
        let key = e.nodeId;
        if (phaseMap.has(key)) {
          key = `${e.nodeId}__retry_${i}`;
        }
        phaseMap.set(key, {
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
        activePhaseKey.set(e.nodeId, key);
      } else if (e.type === 'phase_completed') {
        const key = activePhaseKey.get(e.nodeId);
        const phase = key ? phaseMap.get(key) : undefined;
        if (phase) {
          phase.endIndex = i;
          phase.cost = e.cost;
          phase.outputFiles = e.outputFiles;
          phase.missingOutputs = e.missingOutputs ?? [];
        }
      } else if (e.type === 'phase_failed') {
        const key = activePhaseKey.get(e.nodeId);
        const phase = key ? phaseMap.get(key) : undefined;
        if (phase) phase.endIndex = i;
      } else if (e.type === 'tool_call') {
        const key = activePhaseKey.get(e.nodeId);
        const phase = key ? phaseMap.get(key) : undefined;
        if (phase) phase.toolCallCount++;
      } else if (e.type === 'text_block') {
        const key = activePhaseKey.get(e.nodeId);
        const phase = key ? phaseMap.get(key) : undefined;
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

    // Workspace file inventory
    let workspace: Array<{ phaseId: string; files: Array<{ path: string; size: number }> }> = [];
    try {
      const ws = await this.listWorkspaceFiles(runId);
      workspace = ws.phases;
    } catch {
      // Workspace may not exist for mock runs
    }

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
      events,
      workspace,
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
    flow?: FlowDefinition,
  ): Promise<AgentRunner> {
    switch (type) {
      case 'mock':
        return new MockRunner(this.buildMockBehaviors(flow));
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

  /**
   * Build mock behaviors that produce realistic sample output for known seed projects.
   * Falls back to empty map (default succeed-with-no-output) for unknown projects.
   */
  private buildMockBehaviors(flow?: FlowDefinition): Map<string, MockBehavior> {
    if (!flow) return new Map();

    // Detect the startup due diligence project by checking for signature nodes
    const nodeIds = new Set(flow.nodes.map(n => n.id));
    if (nodeIds.has('ingest_materials') && nodeIds.has('risk_assessment') && nodeIds.has('partner_review')) {
      return this.buildStartupDueDiligenceMocks();
    }

    // Detect the interrupt test kitchen by signature nodes
    if (nodeIds.has('draft_content') && nodeIds.has('edit_pass') && nodeIds.has('final_review')) {
      return this.buildInterruptTestKitchenMocks();
    }

    return new Map();
  }

  private buildStartupDueDiligenceMocks(): Map<string, MockBehavior> {
    return new Map<string, MockBehavior>([
      ['ingest_materials', {
        outputFiles: {
          'company_profile.json': JSON.stringify({
            company_name: 'NovaBridge AI',
            sector: 'Enterprise AI / Developer Tools',
            stage: 'series-a',
            founded_year: 2024,
            team: [
              { name: 'Sarah Chen', role: 'CEO', background: 'Ex-Stripe engineering lead, Stanford CS, 8 years in developer tools' },
              { name: 'Marcus Rivera', role: 'CTO', background: 'Ex-Google Brain researcher, PhD MIT, led COBOL modernization at IBM' },
              { name: 'Dr. Aisha Patel', role: 'Chief Scientist', background: 'Former DeepMind, published 12 papers on code generation, Oxford PhD' },
            ],
            traction: {
              arr: 2400000,
              mrr: 200000,
              customers: 14,
              avg_contract_value: 170000,
              logo_retention: 1.0,
              nrr: 1.45,
              yoy_growth: 6.0,
            },
            funding_history: [
              { round: 'Pre-seed', date: '2024-01', amount: 500000, investors: ['Y Combinator'] },
              { round: 'Seed', date: '2024-06', amount: 4200000, investors: ['Sequoia Capital', 'Angel syndicate'] },
            ],
            cap_table: {
              founders: { total: 0.62, breakdown: { sarah_chen: 0.30, marcus_rivera: 0.22, aisha_patel: 0.10 } },
              employee_pool: { total: 0.15, allocated: 0.08, unallocated: 0.07 },
              seed_investors: { total: 0.18, sequoia: 0.10, angels: 0.08 },
              yc: 0.05,
            },
          }, null, 2),
        },
        cost: { turns: 12, usd: 0.85 },
        verbose: {
          textBlocks: [
            'Reading startup materials and extracting structured company data...',
            'Parsing financial metrics, team bios, and cap table from the pitch deck...',
            'Company profile assembled — NovaBridge AI, Series A stage, $2.4M ARR with 6x YoY growth.',
          ],
          delayMs: 30,
        },
      }],
      ['market_research', {
        outputFiles: {
          'market_analysis.json': JSON.stringify({
            tam: { value_usd: 87000000000, methodology: 'Global IT modernization spend (Gartner 2025)', sources: ['Gartner IT Spending Forecast Q1 2025', 'IDC Worldwide Digital Transformation Spending Guide'] },
            sam: { value_usd: 12000000000, methodology: 'Automated code migration tools segment, filtered by enterprise AI adoption rate', sources: ['Markets & Markets Code Migration Report 2025'] },
            som: { value_usd: 1200000000, methodology: '10% SAM capture over 5 years, based on current pipeline velocity and win rate', timeline_years: 5 },
            competitors: [
              { name: 'IBM watsonx Code Assistant', stage: 'Enterprise', funding: 'IBM subsidiary', strengths: 'Brand trust, enterprise relationships', weaknesses: '~55% accuracy, slow iteration', threat_level: 'moderate' },
              { name: 'AWS Mainframe Modernization', stage: 'Enterprise', funding: 'AWS subsidiary', strengths: 'AWS ecosystem lock-in, infrastructure', weaknesses: 'Limited language support, manual-heavy', threat_level: 'moderate' },
              { name: 'CodeMorph', stage: 'Series B', funding: '$45M', strengths: 'Strong marketing, broad language support', weaknesses: 'Lower accuracy (62%), higher error rates in production', threat_level: 'high' },
              { name: 'Modernizing.io', stage: 'Seed', funding: '$3M', strengths: 'Niche COBOL focus, government contracts', weaknesses: 'Small team, single-language, limited traction', threat_level: 'low' },
            ],
            growth_trends: 'Enterprise AI adoption for code modernization is accelerating — IDC projects 28% CAGR through 2028. Regulatory pressure (EU Digital Operational Resilience Act) is forcing legacy system migration. Key tailwind: 70% of Fortune 500 still run critical COBOL systems.',
            moat_assessment: {
              data_moat: 'Strong — proprietary training data from 14 enterprise deployments, covering COBOL/Fortran codebases totaling 45M+ lines',
              network_effects: 'Moderate — each deployment improves accuracy for similar codebases, but not a traditional platform network effect',
              switching_costs: 'High — 6-month enterprise integration cycle, custom rule libraries built per client',
              ip_protection: '14 provisional patents filed, 2 granted — covers novel AST transformation and multi-pass verification approaches',
            },
          }, null, 2),
          'competitor_matrix.csv': [
            'Company,Stage,Funding,Accuracy,Languages Supported,Enterprise Customers,Pricing Model,Key Differentiator,Threat Level',
            'NovaBridge AI,Series A,$4.7M,89%,"COBOL,Fortran → Python,Go,Rust",14,Per-migration + SaaS,Highest accuracy + verification pipeline,—',
            'IBM watsonx Code Assistant,Enterprise,IBM subsidiary,55%,"COBOL → Java",200+,Enterprise license,Brand trust + existing relationships,Moderate',
            'AWS Mainframe Modernization,Enterprise,AWS subsidiary,48%,"COBOL → Java,C#",150+,Pay-per-use + consulting,AWS ecosystem integration,Moderate',
            'CodeMorph,Series B,$45M,62%,"COBOL,FORTRAN,RPG → Python,Java,C#",38,SaaS subscription,Broad language support + marketing,High',
            'Modernizing.io,Seed,$3M,71%,"COBOL → Python",6,Per-project,Government contract focus,Low',
            'Manual Consulting (Accenture/Deloitte),N/A,N/A,95%+ (manual),Any,1000+,Time & materials ($200-400/hr),Human review + compliance expertise,Low (different segment)',
          ].join('\n'),
          'market_map.svg': [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 500" font-family="system-ui, -apple-system, sans-serif">',
            '  <defs>',
            '    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
            '      <stop offset="0%" style="stop-color:#f8fafc;stop-opacity:1" />',
            '      <stop offset="100%" style="stop-color:#f1f5f9;stop-opacity:1" />',
            '    </linearGradient>',
            '  </defs>',
            '  <rect width="600" height="500" fill="url(#bg)" rx="8" />',
            '  <text x="300" y="30" text-anchor="middle" font-size="14" font-weight="700" fill="#1e293b">Competitive Positioning — AI Code Migration</text>',
            '',
            '  <!-- Axes -->',
            '  <line x1="60" y1="450" x2="580" y2="450" stroke="#cbd5e1" stroke-width="1.5" />',
            '  <line x1="60" y1="50" x2="60" y2="450" stroke="#cbd5e1" stroke-width="1.5" />',
            '  <text x="320" y="485" text-anchor="middle" font-size="11" fill="#64748b">Migration Accuracy →</text>',
            '  <text x="20" y="250" text-anchor="middle" font-size="11" fill="#64748b" transform="rotate(-90 20 250)">Enterprise Scale →</text>',
            '',
            '  <!-- Grid lines -->',
            '  <line x1="60" y1="250" x2="580" y2="250" stroke="#e2e8f0" stroke-dasharray="4" />',
            '  <line x1="320" y1="50" x2="320" y2="450" stroke="#e2e8f0" stroke-dasharray="4" />',
            '',
            '  <!-- Quadrant labels -->',
            '  <text x="190" y="70" text-anchor="middle" font-size="9" fill="#94a3b8" font-style="italic">Broad but Inaccurate</text>',
            '  <text x="450" y="70" text-anchor="middle" font-size="9" fill="#94a3b8" font-style="italic">Market Leaders</text>',
            '  <text x="190" y="440" text-anchor="middle" font-size="9" fill="#94a3b8" font-style="italic">Early Niche Players</text>',
            '  <text x="450" y="440" text-anchor="middle" font-size="9" fill="#94a3b8" font-style="italic">Accurate but Small</text>',
            '',
            '  <!-- NovaBridge AI (high accuracy, mid-scale) — HIGHLIGHTED -->',
            '  <circle cx="470" cy="230" r="28" fill="#3b82f6" fill-opacity="0.15" stroke="#3b82f6" stroke-width="2.5" />',
            '  <circle cx="470" cy="230" r="4" fill="#3b82f6" />',
            '  <text x="470" y="270" text-anchor="middle" font-size="10" font-weight="700" fill="#1d4ed8">NovaBridge AI</text>',
            '  <text x="470" y="282" text-anchor="middle" font-size="8" fill="#3b82f6">89% accuracy · 14 customers</text>',
            '',
            '  <!-- IBM watsonx (low accuracy, high scale) -->',
            '  <circle cx="180" cy="110" r="22" fill="#f59e0b" fill-opacity="0.12" stroke="#f59e0b" stroke-width="1.5" />',
            '  <circle cx="180" cy="110" r="3.5" fill="#f59e0b" />',
            '  <text x="180" y="145" text-anchor="middle" font-size="9" font-weight="600" fill="#92400e">IBM watsonx</text>',
            '  <text x="180" y="156" text-anchor="middle" font-size="7.5" fill="#b45309">55% · 200+ customers</text>',
            '',
            '  <!-- AWS Mainframe (lowest accuracy, high scale) -->',
            '  <circle cx="130" cy="130" r="20" fill="#f59e0b" fill-opacity="0.12" stroke="#f59e0b" stroke-width="1.5" />',
            '  <circle cx="130" cy="130" r="3.5" fill="#f59e0b" />',
            '  <text x="130" y="162" text-anchor="middle" font-size="9" font-weight="600" fill="#92400e">AWS Modernize</text>',
            '  <text x="130" y="173" text-anchor="middle" font-size="7.5" fill="#b45309">48% · 150+ customers</text>',
            '',
            '  <!-- CodeMorph (mid accuracy, mid scale) — KEY COMPETITOR -->',
            '  <circle cx="280" cy="200" r="20" fill="#ef4444" fill-opacity="0.12" stroke="#ef4444" stroke-width="1.8" />',
            '  <circle cx="280" cy="200" r="3.5" fill="#ef4444" />',
            '  <text x="280" y="232" text-anchor="middle" font-size="9" font-weight="600" fill="#b91c1c">CodeMorph</text>',
            '  <text x="280" y="243" text-anchor="middle" font-size="7.5" fill="#dc2626">62% · 38 customers</text>',
            '',
            '  <!-- Modernizing.io (decent accuracy, low scale) -->',
            '  <circle cx="380" cy="370" r="14" fill="#8b5cf6" fill-opacity="0.12" stroke="#8b5cf6" stroke-width="1.5" />',
            '  <circle cx="380" cy="370" r="3" fill="#8b5cf6" />',
            '  <text x="380" y="395" text-anchor="middle" font-size="9" font-weight="600" fill="#6d28d9">Modernizing.io</text>',
            '  <text x="380" y="406" text-anchor="middle" font-size="7.5" fill="#7c3aed">71% · 6 customers</text>',
            '',
            '  <!-- Manual Consulting (highest accuracy, highest scale) -->',
            '  <circle cx="530" cy="90" r="18" fill="#6b7280" fill-opacity="0.1" stroke="#9ca3af" stroke-width="1" stroke-dasharray="3" />',
            '  <circle cx="530" cy="90" r="3" fill="#9ca3af" />',
            '  <text x="530" y="118" text-anchor="middle" font-size="8.5" font-weight="600" fill="#6b7280">Manual Consulting</text>',
            '  <text x="530" y="129" text-anchor="middle" font-size="7.5" fill="#9ca3af">95%+ · $200-400/hr</text>',
            '',
            '  <!-- Legend -->',
            '  <rect x="380" y="440" width="200" height="50" fill="white" fill-opacity="0.8" rx="4" stroke="#e2e8f0" />',
            '  <circle cx="395" cy="454" r="4" fill="#3b82f6" /><text x="405" y="457" font-size="7.5" fill="#475569">Target company</text>',
            '  <circle cx="395" cy="470" r="4" fill="#ef4444" /><text x="405" y="473" font-size="7.5" fill="#475569">Key competitor</text>',
            '  <circle cx="480" cy="454" r="4" fill="#f59e0b" /><text x="490" y="457" font-size="7.5" fill="#475569">Incumbents</text>',
            '  <circle cx="480" cy="470" r="4" fill="#8b5cf6" /><text x="490" y="473" font-size="7.5" fill="#475569">Niche player</text>',
            '</svg>',
          ].join('\n'),
        },
        cost: { turns: 18, usd: 1.40 },
        verbose: {
          textBlocks: [
            'Analyzing market sizing using bottom-up methodology...',
            'Mapping competitive landscape — identified 5 direct competitors...',
            'Generating competitive positioning SVG visualization...',
            'Building competitor comparison matrix with key metrics...',
            'Market research complete — $87B TAM, $12B SAM, strong moat indicators.',
          ],
          delayMs: 40,
        },
      }],
      ['analyze_financials', {
        outputFiles: {
          'financial_findings.json': JSON.stringify({
            arr: 2400000,
            mrr: 200000,
            burn_rate: 380000,
            runway_months: 14,
            ltv_cac_ratio: 4.8,
            burn_multiple: 1.58,
            unit_economics: {
              cac: 35400,
              ltv: 170000,
              payback_months: 8.4,
              gross_margin: 0.82,
              avg_contract_length_years: 2.8,
            },
            assessment: 'NovaBridge exhibits strong unit economics with a 4.8x LTV:CAC ratio (well above the 3x SaaS threshold) and a healthy 1.58x burn multiple. The 82% gross margin reflects an efficient AI-first delivery model. Primary concern: 14-month runway at current burn rate requires Series A within 6 months to maintain growth trajectory. Revenue concentration risk — top 3 clients represent 47% of ARR.',
          }, null, 2),
          'financial_projections.csv': [
            'Year,Revenue ($),ARR ($),ARR Growth (%),Burn Rate ($/mo),Runway (months),Headcount,Gross Margin (%),LTV:CAC,Net Revenue Retention (%)',
            '2024 (Actual),2400000,2400000,600,380000,14,18,82,4.8,145',
            '2025 (Projected),7200000,7200000,200,520000,18,32,80,4.5,140',
            '2026 (Projected),18000000,18000000,150,780000,24,55,81,5.0,142',
            '2027 (Projected),36000000,36000000,100,950000,36,78,83,5.2,138',
            '2028 (Projected),58000000,58000000,61,1100000,48,105,85,5.5,135',
          ].join('\n'),
        },
        cost: { turns: 15, usd: 1.10 },
        verbose: {
          textBlocks: [
            'Evaluating unit economics — calculating CAC, LTV, and payback period...',
            'Modeling 5-year financial projections based on current growth trajectory...',
            'Building CSV projection model with revenue, burn rate, and headcount forecasts...',
            'Financial analysis complete — strong unit economics, runway concern flagged.',
          ],
          delayMs: 30,
        },
      }],
      ['analyze_legal', {
        outputFiles: {
          'legal_findings.json': JSON.stringify({
            cap_table_flags: [
              'Clean cap table structure — no concerning red flags',
              'Standard 4-year vesting with 1-year cliff for all founders',
              'Unallocated option pool (7%) is slightly below recommended 10% pre-Series A — may need expansion',
              'YC SAFE converted at standard terms — no unusual preferences',
            ],
            ip_status: {
              ciia_coverage: '100% — all 18 employees and 3 contractors have signed CIIAs',
              patents: { provisional: 14, granted: 2, pending: 12 },
              prior_art_risk: 'Low — core technology developed post-incorporation, no university IP entanglement',
              open_source_exposure: 'Moderate — training pipeline uses Apache 2.0 licensed models, compliant for commercial use',
            },
            regulatory_risks: [
              { area: 'AI/ML', risk: 'EU AI Act classification — code migration tools likely low-risk, but monitoring required', severity: 'low' },
              { area: 'Data Privacy', risk: 'Client codebases may contain PII — SOC 2 Type II in progress, expected completion Q3 2025', severity: 'moderate' },
              { area: 'Export Control', risk: 'Some defense contractor clients may trigger ITAR considerations for COBOL systems', severity: 'moderate' },
            ],
            corporate_structure: 'Delaware C-corp, standard incorporation — clean for institutional investment. No multi-entity complexity.',
            overall_risk_level: 'low',
          }, null, 2),
        },
        cost: { turns: 14, usd: 1.00 },
        verbose: {
          textBlocks: [
            'Reviewing cap table structure and shareholder agreements...',
            'Checking IP assignment coverage across all team members...',
            'Assessing sector-specific regulatory exposure (AI/ML, data privacy)...',
            'Legal analysis complete — overall risk level: low.',
          ],
          delayMs: 30,
        },
      }],
      ['analyze_team', {
        outputFiles: {
          'team_assessment.json': JSON.stringify({
            founder_market_fit: 5,
            technical_strength: 5,
            key_person_risk: 'Moderate — Dr. Aisha Patel holds critical knowledge of the novel AST transformation approach. If she departed, 2-3 month setback on core algorithm development. Mitigation: knowledge is partially codified in patent applications, and 3 senior engineers have been cross-trained.',
            team_gaps: [
              { role: 'VP Sales', urgency: 'high', rationale: 'Only 2 sales reps for enterprise motion — need experienced leader to build out GTM team' },
              { role: 'Head of Customer Success', urgency: 'high', rationale: '100% logo retention is at risk as customer count grows without dedicated CS function' },
              { role: 'DevRel / Developer Advocacy', urgency: 'medium', rationale: 'Open-source community building would strengthen moat and pipeline' },
            ],
            culture_signals: 'Strong engineering-first culture with high psychological safety indicators. Weekly tech talks, open RFC process for architectural decisions. Low attrition (0 voluntary departures in 12 months). Founders actively engage in pair programming with team. Potential concern: rapid headcount growth (18→32 projected) may dilute culture without deliberate effort.',
          }, null, 2),
        },
        cost: { turns: 13, usd: 0.95 },
        verbose: {
          textBlocks: [
            'Evaluating founder-market fit and domain expertise...',
            'Assessing key person risk and knowledge concentration...',
            'Identifying team gaps and hiring priorities...',
            'Team assessment complete — exceptional founders, VP Sales hire is critical.',
          ],
          delayMs: 30,
        },
      }],
      ['risk_assessment', {
        outputFiles: {
          'risk_matrix.json': JSON.stringify({
            financial_risk: 4,
            legal_risk: 4,
            team_risk: 4,
            market_risk: 3,
            overall_risk: 4,
            summary: 'NovaBridge AI presents a favorable risk profile for Series A investment. Financial fundamentals are strong (4.8x LTV:CAC, 1.58x burn multiple) with the primary concern being 14-month runway requiring timely fundraise. Legal structure is clean with comprehensive IP coverage. Team is exceptional but has critical hiring gaps (VP Sales, Head of CS). Market risk is the primary concern — the AI code migration space is attracting well-funded competitors (CodeMorph $45M Series B) and incumbent interest (IBM, AWS).',
            recommendations: [
              'Negotiate Series A terms that extend runway to 24+ months to de-risk the fundraising timeline',
              'Make VP Sales hire a condition — the enterprise motion cannot scale with 2 sales reps',
              'Request quarterly competitive intelligence updates — CodeMorph is the primary threat',
              'SOC 2 Type II completion should be a milestone requirement given enterprise client base',
              'Consider board observer seat to maintain visibility into execution',
            ],
          }, null, 2),
        },
        cost: { turns: 22, usd: 1.80 },
        verbose: {
          textBlocks: [
            'Aggregating findings from financial, legal, and team sub-analyses...',
            'Computing risk scores across all dimensions...',
            'Assembling risk mitigation recommendations...',
            'Risk matrix complete — overall score: 4/5 (Low Risk). Market competition is the primary concern.',
          ],
          delayMs: 35,
        },
      }],
      ['final_report', {
        outputFiles: {
          'investment_memo.md': [
            '# Investment Memo: NovaBridge AI — Series A',
            '',
            '**Date:** March 2026  ',
            '**Analyst:** ForgeFlow Due Diligence Pipeline  ',
            '**Recommendation:** **Invest** (Conditional)  ',
            '',
            '---',
            '',
            '## Executive Summary',
            '',
            'NovaBridge AI is building an AI-powered code migration platform that converts legacy COBOL and Fortran codebases to modern languages (Python, Go, Rust) with **89% accuracy** — significantly outperforming IBM watsonx (55%) and CodeMorph (62%). The company has achieved **$2.4M ARR** with 14 enterprise customers, **6x YoY growth**, and **100% logo retention** in a $12B serviceable market.',
            '',
            'We recommend a **$15M Series A investment at a $75M pre-money valuation** (31x ARR), conditional on key hiring milestones and SOC 2 certification completion.',
            '',
            '## Investment Thesis',
            '',
            '### Why Now',
            '',
            '1. **Regulatory tailwind** — EU Digital Operational Resilience Act and US federal modernization mandates are creating urgency for legacy system migration',
            '2. **AI capability inflection** — Transformer architectures have reached the quality threshold for production code generation, validated by NovaBridge\'s 89% accuracy',
            '3. **Massive TAM** — 70% of Fortune 500 still run critical COBOL systems; the modernization wave is accelerating',
            '',
            '### Why This Team',
            '',
            '- **Sarah Chen (CEO)** — Built and led Stripe\'s developer tools platform ($0→$2B in payments volume)',
            '- **Marcus Rivera (CTO)** — Led IBM\'s initial COBOL modernization efforts, published research on AST transformation',
            '- **Dr. Aisha Patel (Chief Scientist)** — DeepMind alumna, 12 published papers on code generation',
            '',
            '### Competitive Moat',
            '',
            '| Dimension | Strength | Evidence |',
            '|-----------|----------|----------|',
            '| Data moat | **Strong** | 45M+ lines of proprietary training data from 14 enterprise deployments |',
            '| Switching costs | **High** | 6-month integration cycle, custom rule libraries per client |',
            '| IP protection | **Strong** | 14 patents filed (2 granted), novel AST transformation approach |',
            '| Network effects | Moderate | Each deployment improves accuracy for similar codebases |',
            '',
            '## Risk Assessment',
            '',
            '| Dimension | Score | Key Factors |',
            '|-----------|-------|-------------|',
            '| Financial | 4/5 | Strong unit economics (4.8x LTV:CAC), 14-month runway concern |',
            '| Legal | 4/5 | Clean cap table, full IP coverage, SOC 2 in progress |',
            '| Team | 4/5 | Exceptional founders, VP Sales and Head of CS hires needed |',
            '| Market | 3/5 | Large TAM but CodeMorph ($45M Series B) is aggressive |',
            '| **Overall** | **4/5** | **Low Risk — conditional on key milestones** |',
            '',
            '## Key Risks & Mitigations',
            '',
            '1. **Runway pressure** — 14 months at current burn. *Mitigation: Series A extends to 24+ months*',
            '2. **Revenue concentration** — Top 3 clients = 47% ARR. *Mitigation: VP Sales hire to diversify pipeline*',
            '3. **Competitive threat** — CodeMorph raising aggressively. *Mitigation: accuracy advantage is durable, enterprise switching costs are high*',
            '4. **Key person risk** — Dr. Patel holds critical IP knowledge. *Mitigation: patent codification + cross-training already underway*',
            '',
            '## Proposed Terms',
            '',
            '- **Investment:** $15M Series A',
            '- **Pre-money valuation:** $75M (31x ARR)',
            '- **Ownership:** ~17% post-money',
            '- **Board seat:** 1 board seat + 1 observer',
            '- **Key milestones:**',
            '  - VP Sales hired within 90 days',
            '  - SOC 2 Type II certified by Q3 2025',
            '  - $5M ARR by month 12',
            '',
            '---',
            '',
            '*This memo was generated by the ForgeFlow Due Diligence pipeline, incorporating automated market research, financial modeling, legal review, and team assessment.*',
          ].join('\n'),
          'term_sheet_draft.md': [
            '# Term Sheet — Series A Investment',
            '',
            '**Company:** NovaBridge AI, Inc. (Delaware C-Corp)  ',
            '**Investor(s):** [Fund Name]  ',
            '**Date:** March 2026  ',
            '',
            '> **Note:** This is a non-binding summary of proposed terms, subject to due diligence completion and legal review.',
            '',
            '---',
            '',
            '## Economics',
            '',
            '| Term | Details |',
            '|------|---------|',
            '| **Round Size** | $15,000,000 |',
            '| **Pre-Money Valuation** | $75,000,000 |',
            '| **Post-Money Valuation** | $90,000,000 |',
            '| **Price Per Share** | $12.50 (Series A Preferred) |',
            '| **Shares Issued** | 1,200,000 |',
            '| **Lead Investor Allocation** | $10,000,000 (66.7%) |',
            '| **Option Pool Expansion** | Increase to 12% pre-money (from 7% unallocated) |',
            '',
            '## Governance',
            '',
            '| Term | Details |',
            '|------|---------|',
            '| **Board Composition** | 5 seats: 2 Founders, 1 Lead Investor, 1 Independent, 1 Common |',
            '| **Observer Rights** | 1 observer seat for co-investors with >$2M participation |',
            '| **Protective Provisions** | Standard — sale of company, new equity issuance, debt >$500K |',
            '| **Information Rights** | Monthly financials, quarterly board updates, annual audit |',
            '',
            '## Investor Protections',
            '',
            '| Term | Details |',
            '|------|---------|',
            '| **Liquidation Preference** | 1x non-participating preferred |',
            '| **Anti-Dilution** | Broad-based weighted average |',
            '| **Pro-Rata Rights** | Yes, for investors with >$2M participation |',
            '| **Drag-Along** | Standard (majority preferred + majority common) |',
            '| **Right of First Refusal** | Company, then investors, on secondary transfers |',
            '',
            '## Conditions Precedent',
            '',
            '1. Completion of confirmatory legal due diligence',
            '2. VP Sales hire offer extended within 90 days of close',
            '3. SOC 2 Type II audit engagement letter signed prior to close',
            '4. Key employee retention agreements for 3 founders (24-month cliff on acceleration)',
            '5. Satisfactory reference checks with 3 largest customers',
            '',
            '## Milestone-Based Provisions',
            '',
            '| Milestone | Deadline | Consequence |',
            '|-----------|----------|-------------|',
            '| VP Sales hired | Close + 90 days | Triggers $2M tranche release |',
            '| SOC 2 Type II certified | Close + 6 months | Required for enterprise pipeline |',
            '| $5M ARR achieved | Close + 12 months | Triggers valuation ratchet protection |',
            '',
            '---',
            '',
            '*This term sheet is non-binding and subject to negotiation, definitive documentation, and approval by all parties.*',
          ].join('\n'),
        },
        cost: { turns: 28, usd: 2.20 },
        verbose: {
          textBlocks: [
            'Drafting investment memo — assembling executive summary, thesis, and risk analysis...',
            'Writing competitive moat assessment and proposed terms section...',
            'Generating term sheet with economics, governance, and milestone provisions...',
            'Final deliverables complete — investment memo and term sheet draft ready for review.',
          ],
          delayMs: 50,
        },
      }],
    ]);
  }

  private buildInterruptTestKitchenMocks(): Map<string, MockBehavior> {
    return new Map<string, MockBehavior>([
      ['draft_content', {
        outputFiles: {
          'blog_draft.md': '# The Future of AI in Code Migration\n\nAI-powered code migration is transforming how enterprises modernize legacy systems...\n\n## Key Trends\n\n1. Accuracy rates have improved from 40% to 89% in two years\n2. Enterprise adoption is accelerating due to regulatory pressure\n3. The total addressable market exceeds $87B globally\n\n## Conclusion\n\nOrganizations that delay modernization face increasing operational risk and talent shortages in legacy languages.',
        },
        cost: { turns: 10, usd: 0.75 },
        verbose: true,
      }],
      ['research_facts', {
        outputFiles: {
          'research_notes.json': JSON.stringify({ facts: ['70% of Fortune 500 still run COBOL', 'Average COBOL programmer age is 55+', 'EU DORA mandates modernization by 2027'] }, null, 2),
        },
        cost: { turns: 6, usd: 0.40 },
        verbose: true,
      }],
      ['write_outline', {
        outputFiles: {
          'outline.json': JSON.stringify({ sections: [{ title: 'Introduction', points: ['Hook', 'Context'] }, { title: 'Body', points: ['Key trends', 'Case studies'] }, { title: 'Conclusion', points: ['Call to action'] }] }, null, 2),
        },
        cost: { turns: 5, usd: 0.35 },
        verbose: true,
      }],
    ]);
  }
}

// Singleton
export const runManager = new RunManager();
