import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MockRunner } from '../src/runner.js';
import type { MockBehavior } from '../src/runner.js';
import { prepareWorkspace } from '../src/workspace.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'forgeflow-runner-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('MockRunner', () => {
  it('creates expected output files on success', async () => {
    const behaviors = new Map<string, MockBehavior>([
      [
        'parse_doc',
        {
          outputFiles: { 'parsed.json': '{"data":"parsed"}' },
          cost: { turns: 10, usd: 1.0 },
        },
      ],
    ]);
    const runner = new MockRunner(behaviors);

    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'parse',
      inputFiles: [],
    });

    const result = await runner.runPhase({
      nodeId: 'parse_doc',
      prompt: '# Phase: Parse Document\nDo the work.',
      workspacePath,
      budget: { maxTurns: 25, maxBudgetUsd: 3 },
    });

    expect(result.success).toBe(true);
    expect(result.cost).toEqual({ turns: 10, usd: 1.0 });
    expect(result.outputFiles).toEqual(['parsed.json']);

    // Verify file was written
    const content = await readFile(join(workspacePath, 'output', 'parsed.json'), 'utf-8');
    expect(content).toBe('{"data":"parsed"}');
  });

  it('returns failure without writing files', async () => {
    const behaviors = new Map<string, MockBehavior>([
      [
        'broken_phase',
        {
          outputFiles: { 'result.json': 'data' },
          success: false,
          error: 'Agent crashed',
        },
      ],
    ]);
    const runner = new MockRunner(behaviors);

    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'broken',
      inputFiles: [],
    });

    const result = await runner.runPhase({
      nodeId: 'broken_phase',
      prompt: '# Phase: Broken Phase\nFail.',
      workspacePath,
      budget: { maxTurns: 25, maxBudgetUsd: 3 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Agent crashed');
    expect(result.outputFiles).toEqual([]);
  });

  it('uses default cost when not specified', async () => {
    const behaviors = new Map<string, MockBehavior>([
      ['default_phase', { outputFiles: {} }],
    ]);
    const runner = new MockRunner(behaviors);

    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'default',
      inputFiles: [],
    });

    const result = await runner.runPhase({
      nodeId: 'default_phase',
      prompt: '# Phase: Default Phase\nDo.',
      workspacePath,
      budget: { maxTurns: 25, maxBudgetUsd: 3 },
    });

    expect(result.success).toBe(true);
    expect(result.cost).toEqual({ turns: 5, usd: 0.5 });
  });
});
