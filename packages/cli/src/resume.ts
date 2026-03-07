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
  inputFiles: string[];
  model?: string;
  runner: 'docker' | 'local' | 'mock';
  skillPaths: string[];
  apiKey?: string;
}

function parseResumeArgs(args: string[]): ResumeOptions {
  const options: ResumeOptions = {
    flowDir: '',
    runId: '',
    inputFiles: [],
    runner: 'docker',
    skillPaths: [],
  };

  let positional = 0;
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
  if (options.inputFiles.length === 0) {
    throw new Error('Missing required argument: --input <file> (can be specified multiple times)');
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

  // Read all checkpoint input files
  const checkpointInputs: Array<{ fileName: string; content: Buffer }> = [];
  for (const inputPath of options.inputFiles) {
    const content = await readFile(resolve(inputPath));
    const fileName = basename(inputPath);
    checkpointInputs.push({ fileName, content });
    console.log(`  Checkpoint input: ${fileName} (${content.length} bytes)`);
  }

  // Load checkpoint state and show what's expected
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  const stateStore = new LocalStateStore(join(homeDir, '.forgeflow', 'runs'));

  const checkpoint = await stateStore.loadCheckpoint(options.runId);
  if (checkpoint?.expectedFiles?.length) {
    const provided = new Set(checkpointInputs.map((f) => f.fileName));
    const missing = checkpoint.expectedFiles.filter((ef) => !ef.provided && !provided.has(ef.fileName));
    if (missing.length > 0) {
      console.warn(`\n  Warning: checkpoint expects ${checkpoint.expectedFiles.length} file(s), but ${missing.length} not provided:`);
      for (const ef of missing) {
        const format = ef.schema?.format ?? 'any';
        console.warn(`    - ${ef.fileName} (${format})`);
      }
    }
  }

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

  const orchestrator = new FlowOrchestrator(runner, stateStore, {
    onProgress: (event) => {
      const formatted = formatProgressEvent(event);
      if (formatted) console.log(formatted);
    },
    skillSearchPaths,
    interruptHandler: createCliInterruptHandler(),
  });

  // Resume with all input files
  console.log('\nResuming execution...');
  const result = await orchestrator.resume(flow, options.runId, checkpointInputs);

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
    // Show what the next checkpoint expects
    const nextCheckpoint = await stateStore.loadCheckpoint(result.runId);
    if (nextCheckpoint?.expectedFiles?.length) {
      console.log('Expected files:');
      for (const ef of nextCheckpoint.expectedFiles) {
        const format = ef.schema?.format ?? 'any';
        console.log(`  - ${ef.fileName} (${format})`);
      }
      console.log(`\nResume with: forgeflow resume ${options.flowDir} ${result.runId} ${nextCheckpoint.expectedFiles.map((ef) => `--input <${ef.fileName}>`).join(' ')}`);
    }
  }

  process.exit(result.success ? 0 : 1);
}
