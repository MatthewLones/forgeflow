import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PhaseResult, ProgressEvent } from '@forgeflow/types';

/**
 * AgentRunner interface — abstracts how a phase prompt is executed.
 * Swap MockRunner for ClaudeAgentRunner to use real API.
 */
export interface AgentRunner {
  runPhase(options: {
    nodeId: string;
    prompt: string;
    workspacePath: string;
    budget: { maxTurns: number; maxBudgetUsd: number };
    onProgress?: (event: ProgressEvent) => void;
  }): Promise<PhaseResult>;
}

/**
 * Defines what a MockRunner should do for a given phase.
 */
export interface MockBehavior {
  /** Output files to create: filename → content */
  outputFiles: Record<string, string>;
  /** Whether the phase succeeds (default: true) */
  success?: boolean;
  /** Mock cost (default: { turns: 5, usd: 0.50 }) */
  cost?: { turns: number; usd: number };
  /** Error message if success is false */
  error?: string;
}

/**
 * MockRunner — executes phases by writing predefined output files.
 * Used for testing the orchestrator without real API calls.
 */
export class MockRunner implements AgentRunner {
  /** Map of phase node ID → behavior */
  private behaviors: Map<string, MockBehavior>;

  constructor(behaviors: Map<string, MockBehavior>) {
    this.behaviors = behaviors;
  }

  async runPhase(options: {
    nodeId: string;
    prompt: string;
    workspacePath: string;
    budget: { maxTurns: number; maxBudgetUsd: number };
    onProgress?: (event: ProgressEvent) => void;
  }): Promise<PhaseResult> {
    const behavior = this.behaviors.get(options.nodeId);

    if (!behavior) {
      // Default behavior: succeed with no outputs
      return {
        success: true,
        cost: { turns: 5, usd: 0.5 },
        outputFiles: [],
      };
    }

    const success = behavior.success ?? true;

    if (success) {
      // Write output files to workspace/output/
      const outputDir = join(options.workspacePath, 'output');
      await mkdir(outputDir, { recursive: true });

      for (const [fileName, content] of Object.entries(behavior.outputFiles)) {
        await writeFile(join(outputDir, fileName), content);
      }
    }

    const cost = behavior.cost ?? { turns: 5, usd: 0.5 };

    return {
      success,
      cost,
      outputFiles: success ? Object.keys(behavior.outputFiles) : [],
      error: success ? undefined : (behavior.error ?? 'Mock phase failed'),
    };
  }

}
