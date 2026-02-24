import { readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { parseFlowJSON } from '@forgeflow/parser';
import { LocalStateStore } from '@forgeflow/state-store';
import { FlowOrchestrator } from '@forgeflow/engine';
import { createRunner, formatProgressEvent } from './run.js';
import type { RunOptions } from './run.js';
import { createCliInterruptHandler } from './interrupt-handler.js';

interface ResumeOptions {
  flowDir: string;
  runId: string;
  inputFile: string;
  model?: string;
  runner: 'docker' | 'local' | 'mock';
  skillPaths: string[];
  apiKey?: string;
}

function parseResumeArgs(args: string[]): ResumeOptions {
  const options: ResumeOptions = {
    flowDir: '',
    runId: '',
    inputFile: '',
    runner: 'docker',
    skillPaths: [],
  };

  let positional = 0;
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--input' && args[i + 1]) {
      options.inputFile = args[++i];
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
    } else if (!arg.startsWith('-')) {
      if (positional === 0) options.flowDir = arg;
      else if (positional === 1) options.runId = arg;
      positional++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }

    i++;
  }

  if (!options.flowDir) {
    throw new Error('Missing required argument: <flow-dir>');
  }
  if (!options.runId) {
    throw new Error('Missing required argument: <run-id>');
  }
  if (!options.inputFile) {
    throw new Error('Missing required argument: --input <file>');
  }

  return options;
}

export async function resume(args: string[]): Promise<void> {
  const options = parseResumeArgs(args);
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
  console.log(`Resuming run: ${options.runId}`);

  // Read checkpoint input file
  const inputContent = await readFile(resolve(options.inputFile));
  const inputFileName = basename(options.inputFile);
  console.log(`  Checkpoint input: ${inputFileName}`);

  // Build skill search paths
  const skillSearchPaths = [
    join(flowDir, 'skills'),
    ...options.skillPaths.map((p) => resolve(p)),
  ];

  // Create runner and orchestrator
  const runnerOptions: RunOptions = {
    flowDir: options.flowDir,
    inputFiles: [],
    runner: options.runner,
    skillPaths: options.skillPaths,
    model: options.model,
    apiKey: options.apiKey,
  };
  const runner = createRunner(runnerOptions);
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

  // Resume
  console.log('\nResuming execution...');
  const result = await orchestrator.resume(flow, options.runId, {
    fileName: inputFileName,
    content: inputContent,
  });

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
