import { randomUUID } from 'node:crypto';
import type {
  FlowDefinition,
  FlowNode,
  StateFile,
  RunState,
  RunResult,
  CheckpointState,
  ProgressEvent,
  ExecutionPlan,
} from '@forgeflow/types';
import { validateFlow } from '@forgeflow/validator';
import { compilePhasePrompt } from '@forgeflow/compiler';
import type { CompileContext } from '@forgeflow/compiler';
import type { StateStore } from '@forgeflow/state-store';
import type { AgentRunner } from './runner.js';
import { prepareWorkspace, collectOutputs, cleanupWorkspace } from './workspace.js';

export interface OrchestratorOptions {
  /** Callback for progress events */
  onProgress?: (event: ProgressEvent) => void;
  /** Base path for workspace directories (default: os.tmpdir()) */
  workspaceBasePath?: string;
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
   */
  async execute(flow: FlowDefinition, userUploads: StateFile[]): Promise<RunResult> {
    const runId = randomUUID();
    const emit = this.options?.onProgress ?? (() => {});

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

    const executionPlan = validation.executionPlan;

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

    // 4. Build output map for input source attribution
    const outputMap = buildOutputMap(flow.nodes);
    const nodeMap = new Map(flow.nodes.map((n) => [n.id, n]));

    // 5. Walk phases in execution order
    let totalCost = { turns: 0, usd: 0 };
    const allOutputFiles: string[] = [];

    for (let i = 0; i < executionPlan.phases.length; i++) {
      const phase = executionPlan.phases[i];
      const node = nodeMap.get(phase.nodeId)!;

      runState.currentPhaseId = phase.nodeId;
      runState.updatedAt = new Date().toISOString();
      await this.stateStore.saveRunState(runId, runState);

      // --- Checkpoint node: pause for user input ---
      if (node.type === 'checkpoint') {
        const checkpoint: CheckpointState = {
          runId,
          checkpointNodeId: node.id,
          status: 'waiting',
          presentFiles: node.config.inputs,
          waitingForFile: node.config.outputs[0] ?? '',
          completedPhases: [...runState.completedPhases],
          costSoFar: { ...totalCost },
          presentation: node.config.presentation!,
        };

        await this.stateStore.saveCheckpoint(runId, checkpoint);
        emit({ type: 'checkpoint', checkpoint });

        // Update run state to awaiting_input and return
        runState.status = 'awaiting_input';
        runState.totalCost = { ...totalCost };
        runState.updatedAt = new Date().toISOString();
        await this.stateStore.saveRunState(runId, runState);

        return {
          success: true,
          status: 'awaiting_input',
          runId,
          totalCost: { ...totalCost },
          outputFiles: [...allOutputFiles],
        };
      }

      // --- Agent/Merge node: execute in workspace ---
      emit({ type: 'phase_started', nodeId: node.id, nodeName: node.name, phaseNumber: i });

      // Build compile context for this phase
      const inputSources = new Map<string, string>();
      for (const input of node.config.inputs) {
        inputSources.set(input, outputMap.get(input) ?? 'user_upload');
      }

      const compileContext: CompileContext = {
        flowName: flow.name,
        globalSkills: flow.skills,
        inputSources,
        flowBudget: flow.budget,
      };

      // Compile prompt
      const prompt = compilePhasePrompt(node, compileContext);

      // Load input files from state store
      const inputFiles = await this.stateStore.loadPhaseInputs(runId, node.config.inputs);

      // Prepare workspace
      const workspaceBase = this.options?.workspaceBasePath ?? '/tmp/forgeflow-workspaces';
      const workspacePath = await prepareWorkspace(workspaceBase, {
        runId,
        phaseId: node.id,
        inputFiles,
      });

      // Run the phase
      const budget = node.config.budget ?? {
        maxTurns: flow.budget.maxTurns,
        maxBudgetUsd: flow.budget.maxBudgetUsd,
      };

      const phaseResult = await this.runner.runPhase({
        nodeId: node.id,
        prompt,
        workspacePath,
        budget,
        onProgress: emit,
      });

      if (!phaseResult.success) {
        emit({ type: 'phase_failed', nodeId: node.id, error: phaseResult.error ?? 'Unknown error' });

        runState.status = 'failed';
        runState.error = `Phase "${node.id}" failed: ${phaseResult.error ?? 'Unknown error'}`;
        runState.totalCost = { ...totalCost };
        runState.updatedAt = new Date().toISOString();
        await this.stateStore.saveRunState(runId, runState);

        await cleanupWorkspace(workspacePath);

        return {
          success: false,
          status: 'failed',
          runId,
          totalCost: { ...totalCost },
          outputFiles: [...allOutputFiles],
          error: runState.error,
        };
      }

      // Collect outputs and save to state store
      const outputs = await collectOutputs(workspacePath, node.id);
      if (outputs.length > 0) {
        await this.stateStore.savePhaseOutputs(runId, node.id, outputs);
        allOutputFiles.push(...outputs.map((f) => f.name));
      }

      // Update cost
      totalCost.turns += phaseResult.cost.turns;
      totalCost.usd += phaseResult.cost.usd;

      emit({
        type: 'phase_completed',
        nodeId: node.id,
        outputFiles: phaseResult.outputFiles,
        cost: phaseResult.cost.usd,
      });

      // Update run state
      runState.completedPhases.push(node.id);
      runState.totalCost = { ...totalCost };
      runState.updatedAt = new Date().toISOString();
      await this.stateStore.saveRunState(runId, runState);

      // Clean up workspace
      await cleanupWorkspace(workspacePath);
    }

    // 6. All phases complete
    runState.status = 'completed';
    runState.currentPhaseId = null;
    runState.updatedAt = new Date().toISOString();
    await this.stateStore.saveRunState(runId, runState);

    emit({
      type: 'run_completed',
      success: true,
      totalCost: { ...totalCost },
    });

    return {
      success: true,
      status: 'completed',
      runId,
      totalCost: { ...totalCost },
      outputFiles: [...allOutputFiles],
    };
  }
}

/**
 * Build a map of output file → producing node ID.
 */
function buildOutputMap(nodes: FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    for (const file of node.config.outputs) {
      map.set(file, node.id);
    }
  }
  return map;
}
