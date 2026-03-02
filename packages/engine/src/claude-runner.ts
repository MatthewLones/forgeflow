import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PhaseResult, ProgressEvent } from '@forgeflow/types';
import { FORGEFLOW_PHASE_SYSTEM_PROMPT } from '@forgeflow/compiler';
import type { AgentRunner } from './runner.js';
import { extractVerboseEvents } from './verbose-events.js';
import type { SequenceRef } from './verbose-events.js';

export interface ClaudeAgentRunnerOptions {
  /** Claude model to use (default: 'sonnet') */
  model?: string;
  /** API key override (default: uses ANTHROPIC_API_KEY from env) */
  apiKey?: string;
  /** Max rate-limit retries per phase (default: 5) */
  maxRetries?: number;
}

/** Check if an error is a rate limit (429) or overloaded (529) error */
function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('429') ||
    msg.includes('overloaded') ||
    msg.includes('529') ||
    msg.includes('too many requests') ||
    msg.includes('resource_exhausted')
  );
}

/** Calculate backoff delay with jitter */
function getBackoffMs(attempt: number): number {
  // Base: 10s, 20s, 40s, 60s, 60s (capped)
  const base = Math.min(10000 * Math.pow(2, attempt), 60000);
  // Add 0-20% jitter
  const jitter = base * 0.2 * Math.random();
  return Math.round(base + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AgentRunner implementation that executes phases using the Claude Agent SDK.
 *
 * Runs the agent on the host with `cwd` set to the workspace directory.
 * For sandboxed execution, use DockerAgentRunner instead.
 *
 * Includes automatic retry with exponential backoff for rate limit errors.
 */
export class ClaudeAgentRunner implements AgentRunner {
  private maxRetries: number;

  constructor(private options?: ClaudeAgentRunnerOptions) {
    this.maxRetries = options?.maxRetries ?? 5;
  }

  async runPhase(options: {
    nodeId: string;
    prompt: string;
    workspacePath: string;
    budget: { maxTurns: number; maxBudgetUsd: number };
    onProgress?: (event: ProgressEvent) => void;
  }): Promise<PhaseResult> {
    const emit = options.onProgress ?? (() => {});

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const result = await this.attemptPhase(options, emit);

      // If it succeeded or failed for a non-rate-limit reason, return immediately
      if (result.success || !result.error || !isRateLimitError(new Error(result.error))) {
        return result;
      }

      // Rate limit error — retry with backoff
      if (attempt < this.maxRetries) {
        const waitMs = getBackoffMs(attempt);
        emit({
          type: 'rate_limited',
          nodeId: options.nodeId,
          retryAttempt: attempt + 1,
          maxRetries: this.maxRetries,
          waitMs,
          error: result.error,
        });
        await sleep(waitMs);
      }
      // If this was the last attempt, fall through and return the error
      if (attempt === this.maxRetries) {
        return result;
      }
    }

    // Unreachable, but TypeScript needs it
    return { success: false, cost: { turns: 0, usd: 0 }, outputFiles: [], error: 'Retry logic error' };
  }

  private async attemptPhase(
    options: {
      nodeId: string;
      prompt: string;
      workspacePath: string;
      budget: { maxTurns: number; maxBudgetUsd: number };
      onProgress?: (event: ProgressEvent) => void;
    },
    emit: (event: ProgressEvent) => void,
  ): Promise<PhaseResult> {
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
    const seq: SequenceRef = { value: 0 };
    const toolNameMap = new Map<string, string>();

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
          // Extract verbose events (tool_call, text_block)
          const verboseEvents = extractVerboseEvents(
            message as { type: string; message?: { content?: unknown[] } },
            options.nodeId,
            seq,
            toolNameMap,
          );
          for (const ev of verboseEvents) {
            emit(ev);
          }
        } else if (message.type === 'user') {
          // Extract tool_result verbose events from user messages
          const verboseEvents = extractVerboseEvents(
            message as { type: string; message?: { content?: unknown[] } },
            options.nodeId,
            seq,
            toolNameMap,
          );
          for (const ev of verboseEvents) {
            emit(ev);
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        cost: { turns: numTurns, usd: totalCostUsd },
        outputFiles: [],
        error: `Agent SDK error: ${errorMsg}`,
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
