import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  prepareWorkspace,
  collectOutputs,
  cleanupWorkspace,
  getExpectedOutputs,
  validateOutputs,
} from '../src/workspace.js';
import type { FlowNode, StateFile } from '../../types/src/index.js';
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

  it('writes child prompt files to prompts/ directory', async () => {
    const childPrompts = new Map([
      ['child_a.md', '# Subagent: Child A\n\nDo the work.'],
      ['child_b.md', '# Subagent: Child B\n\nDo other work.'],
    ]);

    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'phase1',
      inputFiles: [],
      childPrompts,
    });

    const promptsDir = join(workspacePath, 'prompts');
    const entries = await readdir(promptsDir);
    expect(entries.sort()).toEqual(['child_a.md', 'child_b.md']);

    const content = await readFile(join(promptsDir, 'child_a.md'), 'utf-8');
    expect(content).toBe('# Subagent: Child A\n\nDo the work.');
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

  it('skips all sandbox channel signal files', async () => {
    const workspacePath = await prepareWorkspace(tempDir, {
      runId: 'run1',
      phaseId: 'phase1',
      inputFiles: [],
    });

    const outputDir = join(workspacePath, 'output');
    await writeFile(join(outputDir, 'result.json'), 'data');
    await writeFile(join(outputDir, '__INTERRUPT__agent1.json'), '{}');
    await writeFile(join(outputDir, '__ANSWER__agent1.json'), '{}');
    await writeFile(join(outputDir, '__CHILD_START__child1.json'), '{}');
    await writeFile(join(outputDir, '__CHILD_DONE__child1.json'), '{}');

    const outputs = await collectOutputs(workspacePath, 'phase1');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe('result.json');
  });

  it('returns empty array when no output directory exists', async () => {
    const outputs = await collectOutputs(join(tempDir, 'nonexistent'), 'phase1');
    expect(outputs).toHaveLength(0);
  });
});

describe('getExpectedOutputs', () => {
  function makeNode(overrides: Partial<FlowNode> = {}): FlowNode {
    return {
      id: 'node1',
      type: 'agent',
      name: 'Test Node',
      instructions: 'test',
      config: {
        inputs: [],
        outputs: ['output_a.json'],
        skills: [],
      },
      children: [],
      ...overrides,
    };
  }

  it('collects outputs from a simple node', () => {
    const node = makeNode({ config: { inputs: [], outputs: ['a.json', 'b.json'], skills: [] } });
    expect(getExpectedOutputs(node)).toEqual(['a.json', 'b.json']);
  });

  it('collects outputs recursively from children', () => {
    const node = makeNode({
      config: { inputs: [], outputs: ['parent_out.json'], skills: [] },
      children: [
        makeNode({ id: 'child1', config: { inputs: [], outputs: ['child1_out.json'], skills: [] } }),
        makeNode({ id: 'child2', config: { inputs: [], outputs: ['child2_out.json'], skills: [] } }),
      ],
    });
    const outputs = getExpectedOutputs(node);
    expect(outputs).toEqual(['parent_out.json', 'child1_out.json', 'child2_out.json']);
  });

  it('collects outputs from deeply nested children', () => {
    const grandchild = makeNode({
      id: 'grandchild',
      config: { inputs: [], outputs: ['gc_out.json'], skills: [] },
    });
    const child = makeNode({
      id: 'child',
      config: { inputs: [], outputs: ['child_out.json'], skills: [] },
      children: [grandchild],
    });
    const parent = makeNode({
      config: { inputs: [], outputs: ['parent_out.json'], skills: [] },
      children: [child],
    });

    const outputs = getExpectedOutputs(parent);
    expect(outputs).toEqual(['parent_out.json', 'child_out.json', 'gc_out.json']);
  });
});

describe('validateOutputs', () => {
  it('returns valid when all expected outputs are found', () => {
    const collected: StateFile[] = [
      { name: 'a.json', content: Buffer.from('{}'), producedByPhase: 'test' },
      { name: 'b.json', content: Buffer.from('{}'), producedByPhase: 'test' },
    ];
    const result = validateOutputs(collected, ['a.json', 'b.json']);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.found).toEqual(['a.json', 'b.json']);
  });

  it('reports missing outputs', () => {
    const collected: StateFile[] = [
      { name: 'a.json', content: Buffer.from('{}'), producedByPhase: 'test' },
    ];
    const result = validateOutputs(collected, ['a.json', 'b.json', 'c.json']);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['b.json', 'c.json']);
    expect(result.found).toEqual(['a.json']);
  });

  it('handles empty expected outputs', () => {
    const result = validateOutputs([], []);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
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
