import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseFlowJSON } from '@forgeflow/parser';
import { LocalStateStore } from '@forgeflow/state-store';
import {
  FlowOrchestrator,
  MockRunner,
  ClaudeAgentRunner,
  DockerAgentRunner,
} from '@forgeflow/engine';
import type { AgentRunner, MockBehavior } from '@forgeflow/engine';
import type { StateFile, ProgressEvent } from '@forgeflow/types';
import { createCliInterruptHandler } from './interrupt-handler.js';

export interface RunOptions {
  flowDir: string;
  inputFiles: string[];
  model?: string;
  runner: 'docker' | 'local' | 'mock';
  skillPaths: string[];
  apiKey?: string;
}

function parseArgs(args: string[]): RunOptions {
  const options: RunOptions = {
    flowDir: '',
    inputFiles: [],
    runner: 'docker',
    skillPaths: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--input' && args[i + 1]) {
      options.inputFiles.push(args[++i]);
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--docker') {
      options.runner = 'docker';
    } else if (arg === '--local') {
      options.runner = 'local';
    } else if (arg === '--mock') {
      options.runner = 'mock';
    } else if (arg === '--skills' && args[i + 1]) {
      options.skillPaths.push(args[++i]);
    } else if (arg === '--api-key' && args[i + 1]) {
      options.apiKey = args[++i];
    } else if (!arg.startsWith('-') && !options.flowDir) {
      options.flowDir = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }

    i++;
  }

  if (!options.flowDir) {
    throw new Error('Missing required argument: <flow-dir>');
  }

  return options;
}

export function createRunner(options: RunOptions): AgentRunner {
  switch (options.runner) {
    case 'mock':
      return new MockRunner(new Map<string, MockBehavior>());
    case 'local':
      return new ClaudeAgentRunner({
        model: options.model,
        apiKey: options.apiKey,
      });
    case 'docker':
      return new DockerAgentRunner({
        model: options.model,
        apiKey: options.apiKey,
      });
  }
}

export function formatProgressEvent(event: ProgressEvent): string {
  switch (event.type) {
    case 'phase_started':
      return `\n--- Phase ${event.phaseNumber + 1}: ${event.nodeName} (${event.nodeId}) ---`;
    case 'phase_completed': {
      let msg = `  Phase complete. Outputs: [${event.outputFiles.join(', ')}] Cost: $${event.cost.toFixed(4)}`;
      if (event.missingOutputs && event.missingOutputs.length > 0) {
        msg += `\n  WARNING: Missing expected outputs: [${event.missingOutputs.join(', ')}]`;
      }
      return msg;
    }
    case 'phase_failed':
      return `  Phase FAILED: ${event.error}`;
    case 'checkpoint':
      return `\n  CHECKPOINT: ${event.checkpoint.presentation.title}\n  Waiting for user input...`;
    case 'interrupt':
      return `  INTERRUPT [${event.interrupt.type}]: ${event.interrupt.title}`;
    case 'message':
      return `  > ${event.content.slice(0, 200)}${event.content.length > 200 ? '...' : ''}`;
    case 'run_completed':
      return `\n--- Run complete. Total cost: $${event.totalCost.usd.toFixed(4)} (${event.totalCost.turns} turns) ---`;
    case 'cost_update':
      return `  Cost update: $${event.usd.toFixed(4)} (${event.turns} turns)`;
    case 'child_started':
      return `    [child] ${event.childName} (${event.childId}) started`;
    case 'child_completed':
      return `    [child] ${event.childName} (${event.childId}) completed. Outputs: [${event.outputFiles.join(', ')}]`;
    case 'resume':
      return `\n--- Resuming from checkpoint ${event.checkpointNodeId} ---`;
    case 'file_written': {
      const sizeStr = event.fileSize < 1024
        ? `${event.fileSize} B`
        : `${(event.fileSize / 1024).toFixed(1)} KB`;
      return `    [output] ${event.fileName} (${sizeStr})`;
    }
    case 'escalation_timeout':
      return `  ESCALATED: Interrupt ${event.interruptId} timed out after ${(event.timeoutMs / 1000).toFixed(0)}s — saving checkpoint`;
    case 'interrupt_answered':
      return `  ${event.escalated ? 'ESCALATED' : 'ANSWERED'}: Interrupt ${event.interruptId} — answer delivered to agent`;
  }
}

export async function run(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const flowDir = resolve(options.flowDir);

  // Read FLOW.json
  const flowJsonPath = join(flowDir, 'FLOW.json');
  let flowJson: string;
  try {
    flowJson = await readFile(flowJsonPath, 'utf-8');
  } catch {
    throw new Error(`Cannot read ${flowJsonPath}`);
  }

  // Parse and validate
  const parseResult = parseFlowJSON(flowJson);
  if (!parseResult.success) {
    throw new Error(
      `Invalid FLOW.json:\n${parseResult.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  const flow = parseResult.flow!;
  console.log(`Flow: ${flow.name} (${flow.id})`);
  console.log(`Nodes: ${flow.nodes.length}, Runner: ${options.runner}`);

  // Load user upload files
  const userUploads: StateFile[] = [];
  for (const filePath of options.inputFiles) {
    const content = await readFile(filePath);
    const name = filePath.split('/').pop()!;
    userUploads.push({ name, content, producedByPhase: 'user_upload' });
    console.log(`  Upload: ${name}`);
  }

  // Build skill search paths
  const skillSearchPaths = [
    join(flowDir, 'skills'), // Flow-relative skills first
    ...options.skillPaths.map((p) => resolve(p)),
  ];

  // Create runner and orchestrator
  const runner = createRunner(options);
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  const stateStore = new LocalStateStore(join(homeDir, '.forgeflow', 'runs'));

  const orchestrator = new FlowOrchestrator(runner, stateStore, {
    onProgress: (event) => {
      const formatted = formatProgressEvent(event);
      if (formatted) console.log(formatted);
    },
    skillSearchPaths,
    interruptHandler: createCliInterruptHandler(),
  });

  // Execute
  console.log('\nStarting execution...');
  const result = await orchestrator.execute(flow, userUploads);

  // Print result
  console.log('\n=== Result ===');
  console.log(`Status: ${result.status}`);
  console.log(`Success: ${result.success}`);
  console.log(`Cost: $${result.totalCost.usd.toFixed(4)} (${result.totalCost.turns} turns)`);
  console.log(`Outputs: [${result.outputFiles.join(', ')}]`);

  if (result.error) {
    console.error(`Error: ${result.error}`);
  }

  if (result.status === 'awaiting_input') {
    console.log(`\nRun paused at checkpoint. Run ID: ${result.runId}`);
  }

  process.exit(result.success ? 0 : 1);
}
