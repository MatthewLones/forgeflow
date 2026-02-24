/**
 * ForgeFlow Sandbox Entrypoint
 *
 * Runs inside a Docker container. Reads the phase prompt and config from
 * mounted workspace files, executes the Agent SDK, and streams progress
 * as JSONL to stdout.
 *
 * Expected files:
 *   /workspace/.forgeflow-prompt.md   — The compiled phase prompt
 *   /workspace/.forgeflow-config.json — { model, maxTurns, maxBudgetUsd, systemPromptAppend }
 *
 * Environment:
 *   ANTHROPIC_API_KEY — Required for API access
 */

import { readFile } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';

async function main() {
  // Read prompt
  let prompt;
  try {
    prompt = await readFile('/workspace/.forgeflow-prompt.md', 'utf-8');
  } catch (err) {
    console.error(JSON.stringify({ type: 'error', message: 'Failed to read prompt file', detail: err.message }));
    process.exit(1);
  }

  // Read config
  let config;
  try {
    const raw = await readFile('/workspace/.forgeflow-config.json', 'utf-8');
    config = JSON.parse(raw);
  } catch (err) {
    console.error(JSON.stringify({ type: 'error', message: 'Failed to read config file', detail: err.message }));
    process.exit(1);
  }

  const { model = 'sonnet', maxTurns = 50, maxBudgetUsd = 5, systemPromptAppend = '' } = config;

  try {
    const stream = query({
      prompt,
      options: {
        cwd: '/workspace',
        model,
        maxTurns,
        maxBudgetUsd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        settingSources: [],
        systemPrompt: systemPromptAppend
          ? { type: 'preset', preset: 'claude_code', append: systemPromptAppend }
          : { type: 'preset', preset: 'claude_code' },
      },
    });

    for await (const message of stream) {
      // Stream all messages as JSONL to stdout
      console.log(JSON.stringify(message));
    }
  } catch (err) {
    console.error(JSON.stringify({ type: 'error', message: 'Agent SDK error', detail: err.message }));
    process.exit(1);
  }
}

main();
