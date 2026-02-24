import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PhaseResult, ProgressEvent } from '@forgeflow/types';
import { FORGEFLOW_PHASE_SYSTEM_PROMPT } from '@forgeflow/compiler';
import type { AgentRunner } from './runner.js';

export interface ClaudeAgentRunnerOptions {
  /** Claude model to use (default: 'sonnet') */
  model?: string;
  /** API key override (default: uses ANTHROPIC_API_KEY from env) */
  apiKey?: string;
}

/**
 * AgentRunner implementation that executes phases using the Claude Agent SDK.
 *
 * Runs the agent on the host with `cwd` set to the workspace directory.
 * For sandboxed execution, use DockerAgentRunner instead.
 */
export class ClaudeAgentRunner implements AgentRunner {
  constructor(private options?: ClaudeAgentRunnerOptions) {}

  async runPhase(options: {
    nodeId: string;
    prompt: string;
    workspacePath: string;
    budget: { maxTurns: number; maxBudgetUsd: number };
    onProgress?: (event: ProgressEvent) => void;
  }): Promise<PhaseResult> {
    const emit = options.onProgress ?? (() => {});

    // Lazy import to avoid loading the SDK unless actually used
    const sdk = await import('@anthropic-ai/claude-agent-sdk');

    const env: Record<string, string | undefined> = { ...process.env };
    if (this.options?.apiKey) {
      env.ANTHROPIC_API_KEY = this.options.apiKey;
    }

    let resultSubtype: string | undefined;
    let numTurns = 0;
    let totalCostUsd = 0;
    let errors: string[] = [];

    try {
      const stream = sdk.query({
        prompt: options.prompt,
        options: {
          cwd: options.workspacePath,
          model: this.options?.model ?? 'sonnet',
          maxTurns: options.budget.maxTurns,
          maxBudgetUsd: options.budget.maxBudgetUsd,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          persistSession: false,
          settingSources: [],
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: FORGEFLOW_PHASE_SYSTEM_PROMPT,
          },
          env,
        },
      });

      for await (const message of stream) {
        if (message.type === 'assistant') {
          // Extract text content from assistant message for progress events
          const apiMsg = message.message;
          if (apiMsg?.content) {
            for (const block of apiMsg.content) {
              if (block.type === 'text' && block.text) {
                emit({ type: 'message', content: block.text });
              }
            }
          }
        } else if (message.type === 'result') {
          resultSubtype = message.subtype;
          numTurns = message.num_turns;
          totalCostUsd = message.total_cost_usd;
          if (message.subtype !== 'success' && 'errors' in message) {
            errors = message.errors;
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        cost: { turns: 0, usd: 0 },
        outputFiles: [],
        error: `Agent SDK error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Collect output file names
    const outputFiles = await listOutputFiles(options.workspacePath);

    if (!resultSubtype) {
      return {
        success: false,
        cost: { turns: numTurns, usd: totalCostUsd },
        outputFiles,
        error: 'No result message received from agent',
      };
    }

    const success = resultSubtype === 'success';

    return {
      success,
      cost: { turns: numTurns, usd: totalCostUsd },
      outputFiles,
      error: success
        ? undefined
        : errors.length > 0
          ? errors.join('; ')
          : `Agent finished with status: ${resultSubtype}`,
    };
  }
}

/**
 * List output files in the workspace output/ directory.
 * Excludes interrupt/answer signal files.
 */
async function listOutputFiles(workspacePath: string): Promise<string[]> {
  const outputDir = join(workspacePath, 'output');
  try {
    const entries = await readdir(outputDir);
    return entries.filter(
      (f) => !f.startsWith('__INTERRUPT__') && !f.startsWith('__ANSWER__'),
    );
  } catch {
    return [];
  }
}
