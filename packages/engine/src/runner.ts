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
 * Simulated verbose event sequence for MockRunner.
 */
export interface MockVerboseSequence {
  /** Tool calls to simulate (default: auto-generated from outputFiles) */
  toolCalls?: Array<{ toolName: string; input: string; output: string; isError?: boolean }>;
  /** Text blocks to simulate (default: intro + outro) */
  textBlocks?: string[];
  /** Delay between events in ms (default: 20) */
  delayMs?: number;
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
  /** Enable verbose event simulation (true = auto-generate, object = custom sequence) */
  verbose?: MockVerboseSequence | boolean;
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
    const emit = options.onProgress ?? (() => {});
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

    // Emit verbose events if requested
    if (behavior.verbose) {
      let sequence = 0;
      const delay = (typeof behavior.verbose === 'object' ? behavior.verbose.delayMs : undefined) ?? 20;
      const wait = () => new Promise<void>(r => setTimeout(r, delay));

      // Text blocks (intro)
      const textBlocks = typeof behavior.verbose === 'object' && behavior.verbose.textBlocks
        ? behavior.verbose.textBlocks
        : ['Analyzing the task requirements...'];

      for (const text of textBlocks) {
        emit({ type: 'text_block', nodeId: options.nodeId, content: text, truncated: false, charCount: text.length, sequence: sequence++ });
        emit({ type: 'message', content: text });
        await wait();
      }

      // Tool calls
      if (success) {
        const toolCalls = typeof behavior.verbose === 'object' && behavior.verbose.toolCalls
          ? behavior.verbose.toolCalls
          : Object.entries(behavior.outputFiles).map(([name, content]) => ({
              toolName: 'Write',
              input: JSON.stringify({ file_path: `output/${name}` }),
              output: `File written: output/${name} (${content.length} bytes)`,
              isError: false as boolean | undefined,
            }));

        for (const tc of toolCalls) {
          const toolUseId = `mock_${sequence}`;
          emit({ type: 'tool_call', nodeId: options.nodeId, toolName: tc.toolName, toolUseId, inputSummary: tc.input, truncated: false, sequence: sequence++ });
          await wait();
          emit({ type: 'tool_result', nodeId: options.nodeId, toolName: tc.toolName, toolUseId, outputSummary: tc.output, truncated: false, isError: tc.isError ?? false, sequence: sequence++ });
          await wait();
        }

        // Outro text block
        const outro = 'Task complete. All output files written.';
        emit({ type: 'text_block', nodeId: options.nodeId, content: outro, truncated: false, charCount: outro.length, sequence: sequence++ });
        emit({ type: 'message', content: outro });
      }
    }

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
