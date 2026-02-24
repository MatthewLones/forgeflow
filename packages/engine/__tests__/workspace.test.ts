import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareWorkspace, collectOutputs, cleanupWorkspace } from '../src/workspace.js';
import type { StateFile } from '@forgeflow/types';
import { writeFile, mkdir } from 'node:fs/promises';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'forgeflow-workspace-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('prepareWorkspace', () => {
  it('creates correct directory structure', async () => {
    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'phase1',
      inputFiles: [],
    });

    expect(workspacePath).toBe(join(tempDir, 'run1', 'phase1'));

    const entries = await readdir(workspacePath);
    expect(entries.sort()).toEqual(['input', 'output', 'skills']);
  });

  it('populates input files', async () => {
    const inputFiles: StateFile[] = [
      { name: 'doc.pdf', content: Buffer.from('pdf-bytes'), producedByPhase: 'upload' },
      { name: 'data.json', content: Buffer.from('{"key":"value"}'), producedByPhase: 'phase_0' },
    ];

    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'phase1',
      inputFiles,
    });

    const inputDir = join(workspacePath, 'input');
    const entries = await readdir(inputDir);
    expect(entries.sort()).toEqual(['data.json', 'doc.pdf']);

    const content = await readFile(join(inputDir, 'data.json'), 'utf-8');
    expect(content).toBe('{"key":"value"}');
  });
});

describe('collectOutputs', () => {
  it('reads output files from workspace', async () => {
    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'phase1',
      inputFiles: [],
    });

    // Simulate agent writing output files
    const outputDir = join(workspacePath, 'output');
    await writeFile(join(outputDir, 'result.json'), '{"done":true}');
    await writeFile(join(outputDir, 'summary.md'), '# Summary');

    const outputs = await collectOutputs(workspacePath, 'phase1');
    expect(outputs).toHaveLength(2);
    expect(outputs.find((f) => f.name === 'result.json')!.content.toString()).toBe('{"done":true}');
    expect(outputs.find((f) => f.name === 'summary.md')!.content.toString()).toBe('# Summary');
    expect(outputs[0].producedByPhase).toBe('phase1');
  });

  it('skips interrupt and answer signal files', async () => {
    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'phase1',
      inputFiles: [],
    });

    const outputDir = join(workspacePath, 'output');
    await writeFile(join(outputDir, 'result.json'), 'data');
    await writeFile(join(outputDir, '__INTERRUPT__agent1.json'), '{}');
    await writeFile(join(outputDir, '__ANSWER__agent1.json'), '{}');

    const outputs = await collectOutputs(workspacePath, 'phase1');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe('result.json');
  });

  it('returns empty array when no output directory exists', async () => {
    const outputs = await collectOutputs(join(tempDir, 'nonexistent'), 'phase1');
    expect(outputs).toHaveLength(0);
  });
});

describe('cleanupWorkspace', () => {
  it('removes workspace directory', async () => {
    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'phase1',
      inputFiles: [{ name: 'file.txt', content: Buffer.from('data'), producedByPhase: 'test' }],
    });

    await cleanupWorkspace(workspacePath);

    await expect(access(workspacePath)).rejects.toThrow();
  });
});
