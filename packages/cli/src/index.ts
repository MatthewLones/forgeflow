#!/usr/bin/env node

import { run } from './run.js';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'run') {
  try {
    await run(args.slice(1));
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
} else {
  console.log(`ForgeFlow CLI v0.1.0

Usage:
  forgeflow run <flow-dir> [options]

Options:
  --input <file>    User upload file (repeatable)
  --model <model>   Claude model (default: sonnet)
  --docker          Run in Docker sandbox (default)
  --local           Run on host (no Docker isolation)
  --mock            Use MockRunner (no API calls)
  --skills <dir>    Additional skill search path (repeatable)
  --api-key <key>   Anthropic API key override`);

  if (command && command !== 'help' && command !== '--help' && command !== '-h') {
    console.error(`\nUnknown command: ${command}`);
    process.exit(1);
  }
}
