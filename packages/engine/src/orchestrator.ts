import { randomUUID } from 'node:crypto';
import type {
  FlowDefinition,
  StateFile,
  RunState,
  RunResult,
  CheckpointState,
  ProgressEvent,
  ExecutionPlan,
} from '@forgeflow/types';
import { validateFlow, buildFlowGraph } from '@forgeflow/validator';
import { compilePhase, compileChildPrompts } from '@forgeflow/compiler';
import type { StateStore } from '@forgeflow/state-store';
import { resolveSkills } from '@forgeflow/skill-resolver';
import type { ResolvedSkill } from '@forgeflow/skill-resolver';
import type { AgentRunner } from './runner.js';
import {
  prepareWorkspace,
  collectOutputs,
  cleanupWorkspace,
  getExpectedOutputs,
  validateOutputs,
} from './workspace.js';
import { InterruptWatcher } from './interrupt-watcher.js';
import type { InterruptHandler } from './interrupt-watcher.js';

export interface OrchestratorOptions {
  /** Callback for progress events */
  onProgress?: (event: ProgressEvent) => void;
  /** Base path for workspace directories (default: os.tmpdir()) */
  workspaceBasePath?: string;
  /** Ordered search paths for skill directories */
  skillSearchPaths?: string[];
  /** Handler for inline interrupts (if not provided, interrupts are ignored) */
  interruptHandler?: InterruptHandler;
  /** Default timeout for inline interrupt escalation (ms) */
  escalateTimeoutMs?: number;
  /** Preserve workspace directories after phase execution (default: false) */
  preserveWorkspace?: boolean;
}

interface ExecuteContext {
  runId: string;
  flow: FlowDefinition;
  executionPlan: ExecutionPlan;
  runState: RunState;
  startingPhaseIndex: number;
  initialCost: { turns: number; usd: number };
  initialOutputFiles: string[];
}

export class FlowOrchestrator {
  constructor(
    private runner: AgentRunner,
    private stateStore: StateStore,
    private options?: OrchestratorOptions,
  ) {}

  /**
   * Execute a flow end-to-end.
   * Returns RunResult with status, cost, and output files.
   * @param externalRunId - optional pre-generated runId (used by RunManager to avoid race conditions)
   */
  async execute(flow: FlowDefinition, userUploads: StateFile[], externalRunId?: string): Promise<RunResult> {
    const runId = externalRunId ?? randomUUID();

    // 1. Validate the flow
    const validation = validateFlow(flow);
    if (!validation.valid || !validation.executionPlan) {
      return {
        success: false,
        status: 'failed',
        runId,
        totalCost: { turns: 0, usd: 0 },
        outputFiles: [],
        error: `Flow validation failed: ${validation.errors.map((e) => e.message).join('; ')}`,
      };
    }

    // 2. Initialize run state
    const runState: RunState = {
      runId,
      flowId: flow.id,
      status: 'running',
      currentPhaseId: null,
      completedPhases: [],
      totalCost: { turns: 0, usd: 0 },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.stateStore.saveRunState(runId, runState);

    // 3. Save user uploads
    if (userUploads.length > 0) {
      await this.stateStore.saveUserUploads(runId, userUploads);
    }

    // 4. Execute phases from the beginning
    return this.executePhases({
      runId,
      flow,
      executionPlan: validation.executionPlan,
      runState,
      startingPhaseIndex: 0,
      initialCost: { turns: 0, usd: 0 },
      initialOutputFiles: [],
    });
  }

  /**
   * Resume a flow that was paused at a checkpoint.
   * Requires the same flow definition and the user's checkpoint answer.
   */
  async resume(
    flow: FlowDefinition,
    runId: string,
    checkpointInput: { fileName: string; content: Buffer },
  ): Promise<RunResult> {
    const emit = this.options?.onProgress ?? (() => {});

    // 1. Load and verify run state
    const runState = await this.stateStore.loadRunState(runId);
    if (!runState) {
      return {
        success: false,
        status: 'failed',
        runId,
        totalCost: { turns: 0, usd: 0 },
        outputFiles: [],
        error: `Run ${runId} not found`,
      };
    }
    if (runState.status !== 'awaiting_input') {
      return {
        success: false,
        status: 'failed',
        runId,
        totalCost: runState.totalCost,
        outputFiles: [],
        error: `Run ${runId} is not awaiting input (status: ${runState.status})`,
      };
    }

    // 2. Load checkpoint state
    const checkpoint = await this.stateStore.loadCheckpoint(runId);
    if (!checkpoint) {
      return {
        success: false,
        status: 'failed',
        runId,
        totalCost: runState.totalCost,
        outputFiles: [],
        error: `No checkpoint found for run ${runId}`,
      };
    }

    // 3. Save checkpoint answer as artifact
    await this.stateStore.saveCheckpointAnswer(
      runId,
      checkpointInput.fileName,
      checkpointInput.content,
    );

    // 4. Update checkpoint status
    checkpoint.status = 'answered';
    await this.stateStore.saveCheckpoint(runId, checkpoint);

    // 5. Re-validate flow to get execution plan
    const validation = validateFlow(flow);
    if (!validation.valid || !validation.executionPlan) {
      return {
        success: false,
        status: 'failed',
        runId,
        totalCost: runState.totalCost,
        outputFiles: [],
        error: `Flow re-validation failed: ${validation.errors.map((e) => e.message).join('; ')}`,
      };
    }

    // 6. Find checkpoint phase index
    const checkpointIndex = validation.executionPlan.phases.findIndex(
      (p) => p.nodeId === checkpoint.checkpointNodeId,
    );
    if (checkpointIndex === -1) {
      return {
        success: false,
        status: 'failed',
        runId,
        totalCost: runState.totalCost,
        outputFiles: [],
        error: `Checkpoint node "${checkpoint.checkpointNodeId}" not found in execution plan`,
      };
    }

    // 7. Update run state to running
    runState.status = 'running';
    runState.updatedAt = new Date().toISOString();
    await this.stateStore.saveRunState(runId, runState);

    emit({ type: 'resume', runId, checkpointNodeId: checkpoint.checkpointNodeId });

    // 8. Execute remaining phases (starting after checkpoint)
    return this.executePhases({
      runId,
      flow,
      executionPlan: validation.executionPlan,
      runState,
      startingPhaseIndex: checkpointIndex + 1,
      initialCost: { ...checkpoint.costSoFar },
      initialOutputFiles: [],
    });
  }

  /**
   * Execute phases starting from a given index.
   * Shared by execute() and resume().
   */
  private async executePhases(ctx: ExecuteContext): Promise<RunResult> {
    const emit = this.options?.onProgress ?? (() => {});
    const graph = buildFlowGraph(ctx.flow);
    const nodeMap = new Map(ctx.flow.nodes.map((n) => [n.id, n]));
    let totalCost = { ...ctx.initialCost };
    const allOutputFiles = [...ctx.initialOutputFiles];

    for (let i = ctx.startingPhaseIndex; i < ctx.executionPlan.phases.length; i++) {
      const phase = ctx.executionPlan.phases[i];
      const node = nodeMap.get(phase.nodeId)!;
      const sym = graph.symbols.get(phase.nodeId)!;

      ctx.runState.currentPhaseId = phase.nodeId;
      ctx.runState.updatedAt = new Date().toISOString();
      await this.stateStore.saveRunState(ctx.runId, ctx.runState);

      // --- Checkpoint node: pause for user input ---
      if (node.type === 'checkpoint') {
        const checkpoint: CheckpointState = {
          runId: ctx.runId,
          checkpointNodeId: node.id,
          status: 'waiting',
          presentFiles: sym.declaredInputs,
          waitingForFile: sym.declaredOutputs[0] ?? '',
          completedPhases: [...ctx.runState.completedPhases],
          costSoFar: { ...totalCost },
          presentation: node.config.presentation!,
        };

        await this.stateStore.saveCheckpoint(ctx.runId, checkpoint);
        emit({ type: 'checkpoint', checkpoint });

        ctx.runState.status = 'awaiting_input';
        ctx.runState.totalCost = { ...totalCost };
        ctx.runState.updatedAt = new Date().toISOString();
        await this.stateStore.saveRunState(ctx.runId, ctx.runState);

        return {
          success: true,
          status: 'awaiting_input',
          runId: ctx.runId,
          totalCost: { ...totalCost },
          outputFiles: [...allOutputFiles],
        };
      }

      // --- Agent node: execute in workspace ---
      emit({ type: 'phase_started', nodeId: node.id, nodeName: node.name, phaseNumber: i });

      // Compile prompt via FlowGraph
      const { markdown: prompt } = compilePhase(node.id, graph);
      const childPrompts = node.children.length > 0
        ? compileChildPrompts(node.id, graph).markdowns
        : undefined;

      emit({
        type: 'prompt_compiled',
        nodeId: node.id,
        promptChars: prompt.length,
        childPromptCount: childPrompts?.size ?? 0,
        childPromptTotalChars: childPrompts
          ? [...childPrompts.values()].reduce((sum, md) => sum + md.length, 0)
          : 0,
      });

      const inputFiles = await this.stateStore.loadPhaseInputs(ctx.runId, sym.declaredInputs);

      // Resolve skills
      const allSkillNames = [...new Set([...ctx.flow.skills, ...node.config.skills])];
      let resolvedSkills: ResolvedSkill[] = [];
      if (allSkillNames.length > 0 && this.options?.skillSearchPaths?.length) {
        resolvedSkills = await resolveSkills(allSkillNames, this.options.skillSearchPaths);
        for (const skill of resolvedSkills) {
          emit({
            type: 'skill_loaded',
            nodeId: node.id,
            skillName: skill.name,
            fileCount: 1 + skill.references.size + skill.scripts.size,
          });
        }
      }

      // Prepare workspace
      const workspaceBase = this.options?.workspaceBasePath ?? '/tmp/forgeflow-workspaces';
      const workspacePath = await prepareWorkspace(workspaceBase, {
        runId: ctx.runId,
        phaseId: node.id,
        inputFiles,
        skills: resolvedSkills,
        childPrompts,
      });

      emit({
        type: 'workspace_prepared',
        nodeId: node.id,
        inputFileCount: inputFiles.length,
        skillCount: resolvedSkills.length,
        childPromptCount: childPrompts?.size ?? 0,
        workspacePath,
      });

      // Run the phase (with interrupt watcher if handler provided)
      const budget = node.config.budget ?? {
        maxTurns: ctx.flow.budget.maxTurns,
        maxBudgetUsd: ctx.flow.budget.maxBudgetUsd,
      };

      let interruptWatcher: InterruptWatcher | undefined;
      if (this.options?.interruptHandler && sym.interruptCapable) {
        interruptWatcher = new InterruptWatcher();
        await interruptWatcher.start({
          workspacePath,
          onInterrupt: this.options.interruptHandler,
          onProgress: emit,
          nodeId: node.id,
          escalateTimeoutMs: this.options.escalateTimeoutMs,
        });
      }

      const phaseResult = await this.runner.runPhase({
        nodeId: node.id,
        prompt,
        workspacePath,
        budget,
        onProgress: emit,
      });

      if (interruptWatcher) {
        await interruptWatcher.stop();
      }

      // --- Check for escalation (interrupt handler timed out) ---
      if (interruptWatcher?.escalated && interruptWatcher.escalatedInterrupt) {
        const outputs = await collectOutputs(workspacePath, node.id);
        if (outputs.length > 0) {
          await this.stateStore.savePhaseOutputs(ctx.runId, node.id, outputs);
          allOutputFiles.push(...outputs.map((f) => f.name));
        }

        totalCost.turns += phaseResult.cost.turns;
        totalCost.usd += phaseResult.cost.usd;

        // Mark phase as completed (agent did run and produce outputs)
        ctx.runState.completedPhases.push(node.id);

        // Create synthetic checkpoint from escalated interrupt
        const escalatedInterrupt = interruptWatcher.escalatedInterrupt;
        const checkpoint: CheckpointState = {
          runId: ctx.runId,
          checkpointNodeId: node.id,
          status: 'waiting',
          presentFiles: outputs.map((f) => f.name),
          waitingForFile: `escalated_answer_${escalatedInterrupt.interrupt_id}.json`,
          completedPhases: [...ctx.runState.completedPhases],
          costSoFar: { ...totalCost },
          presentation: {
            title: `Escalated: ${escalatedInterrupt.title}`,
            sections: ['escalated_interrupt'],
          },
        };

        await this.stateStore.saveCheckpoint(ctx.runId, checkpoint);
        emit({ type: 'checkpoint', checkpoint });

        ctx.runState.status = 'awaiting_input';
        ctx.runState.totalCost = { ...totalCost };
        ctx.runState.updatedAt = new Date().toISOString();
        await this.stateStore.saveRunState(ctx.runId, ctx.runState);

        if (!this.options?.preserveWorkspace) {
          await cleanupWorkspace(workspacePath);
        }

        return {
          success: true,
          status: 'awaiting_input',
          runId: ctx.runId,
          totalCost: { ...totalCost },
          outputFiles: [...allOutputFiles],
        };
      }

      if (!phaseResult.success) {
        emit({ type: 'phase_failed', nodeId: node.id, error: phaseResult.error ?? 'Unknown error' });

        ctx.runState.status = 'failed';
        ctx.runState.error = `Phase "${node.id}" failed: ${phaseResult.error ?? 'Unknown error'}`;
        ctx.runState.totalCost = { ...totalCost };
        ctx.runState.updatedAt = new Date().toISOString();
        await this.stateStore.saveRunState(ctx.runId, ctx.runState);

        if (!this.options?.preserveWorkspace) {
          await cleanupWorkspace(workspacePath);
        }

        return {
          success: false,
          status: 'failed',
          runId: ctx.runId,
          totalCost: { ...totalCost },
          outputFiles: [...allOutputFiles],
          error: ctx.runState.error,
        };
      }

      // Collect outputs and save to state store
      const outputs = await collectOutputs(workspacePath, node.id);
      if (outputs.length > 0) {
        await this.stateStore.savePhaseOutputs(ctx.runId, node.id, outputs);
        allOutputFiles.push(...outputs.map((f) => f.name));
      }

      // Validate expected outputs (warning, not hard failure)
      const expectedOutputs = getExpectedOutputs(node);
      const outputValidation = validateOutputs(outputs, expectedOutputs);

      emit({
        type: 'output_validated',
        nodeId: node.id,
        expectedCount: expectedOutputs.length,
        foundCount: outputValidation.found.length,
        missingFiles: outputValidation.missing,
        valid: outputValidation.missing.length === 0,
      });

      // Update cost
      totalCost.turns += phaseResult.cost.turns;
      totalCost.usd += phaseResult.cost.usd;

      emit({
        type: 'phase_completed',
        nodeId: node.id,
        outputFiles: outputValidation.found,
        cost: phaseResult.cost.usd,
        missingOutputs: outputValidation.missing.length > 0 ? outputValidation.missing : undefined,
      });

      // Update run state
      ctx.runState.completedPhases.push(node.id);
      ctx.runState.totalCost = { ...totalCost };
      ctx.runState.updatedAt = new Date().toISOString();
      await this.stateStore.saveRunState(ctx.runId, ctx.runState);

      // Clean up workspace (unless preservation is enabled)
      if (!this.options?.preserveWorkspace) {
        await cleanupWorkspace(workspacePath);
      }
    }

    // All phases complete
    ctx.runState.status = 'completed';
    ctx.runState.currentPhaseId = null;
    ctx.runState.updatedAt = new Date().toISOString();
    await this.stateStore.saveRunState(ctx.runId, ctx.runState);

    emit({
      type: 'run_completed',
      success: true,
      totalCost: { ...totalCost },
    });

    return {
      success: true,
      status: 'completed',
      runId: ctx.runId,
      totalCost: { ...totalCost },
      outputFiles: [...allOutputFiles],
    };
  }
}
