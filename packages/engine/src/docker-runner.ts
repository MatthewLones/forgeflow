import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import Docker from 'dockerode';
import type { PhaseResult, ProgressEvent } from '@forgeflow/types';
import { FORGEFLOW_PHASE_SYSTEM_PROMPT } from '@forgeflow/compiler';
import type { AgentRunner } from './runner.js';
import { getImageRef, imageExists, buildImage } from './docker-image.js';
import { extractVerboseEvents } from './verbose-events.js';
import type { SequenceRef } from './verbose-events.js';

export interface DockerAgentRunnerOptions {
  /** Claude model to use (default: 'sonnet') */
  model?: string;
  /** Custom Docker image name (default: 'forgeflow-sandbox') */
  imageName?: string;
  /** API key override (default: uses ANTHROPIC_API_KEY from env) */
  apiKey?: string;
  /** Auto-build image if missing (default: true) */
  autoBuildImage?: boolean;
}

/**
 * AgentRunner implementation that executes phases inside Docker containers.
 *
 * Each phase gets an isolated container with the workspace mounted as a volume.
 * The Agent SDK runs INSIDE the container, so the agent can only access files
 * within the mounted workspace directory.
 *
 * Container lifecycle per phase:
 * 1. Write prompt + config to workspace
 * 2. Create container with volume mount
 * 3. Start container, stream JSONL progress from stdout
 * 4. Wait for container to exit
 * 5. Parse result, return PhaseResult
 * 6. Remove container
 */
export class DockerAgentRunner implements AgentRunner {
  private docker: Docker;

  constructor(private options?: DockerAgentRunnerOptions) {
    this.docker = new Docker();
  }

  async runPhase(options: {
    nodeId: string;
    prompt: string;
    workspacePath: string;
    budget: { maxTurns: number; maxBudgetUsd: number };
    onProgress?: (event: ProgressEvent) => void;
  }): Promise<PhaseResult> {
    const emit = options.onProgress ?? (() => {});
    const imageRef = getImageRef(this.options?.imageName);

    // Ensure image exists (build if needed)
    const exists = await imageExists(this.docker, this.options?.imageName);
    if (!exists) {
      if (this.options?.autoBuildImage === false) {
        return {
          success: false,
          cost: { turns: 0, usd: 0 },
          outputFiles: [],
          error: `Docker image "${imageRef}" not found. Run "docker build" or set autoBuildImage: true.`,
        };
      }
      await buildImage(this.docker, this.options?.imageName);
    }

    // Write prompt and config to workspace (the agent reads these inside the container)
    await writeFile(
      join(options.workspacePath, '.forgeflow-prompt.md'),
      options.prompt,
    );

    await writeFile(
      join(options.workspacePath, '.forgeflow-config.json'),
      JSON.stringify({
        model: this.options?.model ?? 'sonnet',
        maxTurns: options.budget.maxTurns,
        maxBudgetUsd: options.budget.maxBudgetUsd,
        systemPromptAppend: FORGEFLOW_PHASE_SYSTEM_PROMPT,
      }),
    );

    // Resolve API key
    const apiKey = this.options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';

    // Create container
    const container = await this.docker.createContainer({
      Image: imageRef,
      Env: [`ANTHROPIC_API_KEY=${apiKey}`],
      HostConfig: {
        Binds: [`${options.workspacePath}:/workspace`],
      },
    });

    let resultSubtype: string | undefined;
    let numTurns = 0;
    let totalCostUsd = 0;
    let errors: string[] = [];
    const seq: SequenceRef = { value: 0 };
    const toolNameMap = new Map<string, string>();

    try {
      // Start container and attach to stdout for JSONL progress
      await container.start();

      const logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

      // Parse JSONL from container stdout
      let buffer = '';
      await new Promise<void>((resolve, reject) => {
        logStream.on('data', (chunk: Buffer) => {
          // Docker multiplexed stream: first 8 bytes are header
          // For simplicity, parse the raw text and skip non-JSON lines
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Find the first { in the line (skip Docker stream header bytes)
            const jsonStart = trimmed.indexOf('{');
            if (jsonStart === -1) continue;

            try {
              const msg = JSON.parse(trimmed.slice(jsonStart));

              if (msg.type === 'assistant' && msg.message?.content) {
                for (const block of msg.message.content) {
                  if (block.type === 'text' && block.text) {
                    emit({ type: 'message', content: block.text });
                  }
                }
              }

              if (msg.type === 'result') {
                resultSubtype = msg.subtype;
                numTurns = msg.num_turns ?? 0;
                totalCostUsd = msg.total_cost_usd ?? 0;
                if (msg.subtype !== 'success' && msg.errors) {
                  errors = msg.errors;
                }
              }

              // Extract verbose events from all message types
              if (msg.type === 'assistant' || msg.type === 'user') {
                const verboseEvents = extractVerboseEvents(msg, options.nodeId, seq, toolNameMap);
                for (const ev of verboseEvents) {
                  emit(ev);
                }
              }
            } catch {
              // Not JSON, skip (could be Docker stream header or stderr)
            }
          }
        });
        logStream.on('end', resolve);
        logStream.on('error', reject);
      });

      // Wait for container to exit
      const waitResult = await container.wait();
      const exitCode = waitResult.StatusCode;

      if (exitCode !== 0 && !resultSubtype) {
        return {
          success: false,
          cost: { turns: numTurns, usd: totalCostUsd },
          outputFiles: await listOutputFiles(options.workspacePath),
          error: `Container exited with code ${exitCode}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        cost: { turns: 0, usd: 0 },
        outputFiles: [],
        error: `Docker error: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      // Clean up container
      try {
        await container.remove({ force: true });
      } catch {
        // Best effort cleanup
      }
    }

    const outputFiles = await listOutputFiles(options.workspacePath);
    const success = resultSubtype === 'success';

    return {
      success,
      cost: { turns: numTurns, usd: totalCostUsd },
      outputFiles,
      error: success
        ? undefined
        : errors.length > 0
          ? errors.join('; ')
          : `Agent finished with status: ${resultSubtype ?? 'unknown'}`,
    };
  }
}

/**
 * List output files in the workspace output/ directory.
 * Excludes interrupt/answer signal files and forgeflow config files.
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
