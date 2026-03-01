import { describe, it, expect } from 'vitest';
import { buildFlowGraph } from '../src/flow-graph.js';
import type { FlowDefinition, FlowNode, ArtifactSchema } from '@forgeflow/types';

function makeNode(overrides: Partial<FlowNode> & { id: string }): FlowNode {
  return {
    type: 'agent',
    name: overrides.id,
    instructions: 'Do something',
    config: {
      inputs: [],
      outputs: [],
      skills: [],
    },
    children: [],
    ...overrides,
  };
}

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'test_flow',
    name: 'Test Flow',
    version: '1.0.0',
    description: 'A test flow',
    skills: [],
    budget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe('buildFlowGraph', () => {
  it('builds symbols for all top-level nodes', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: ['doc.pdf'], outputs: ['parsed.json'], skills: [] } }),
        makeNode({ id: 'b', config: { inputs: ['parsed.json'], outputs: ['summary.md'], skills: [] } }),
      ],
      edges: [{ from: 'a', to: 'b' }],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.symbols.size).toBe(2);
    expect(graph.symbols.get('a')!.depth).toBe(0);
    expect(graph.symbols.get('b')!.depth).toBe(0);
    expect(graph.symbols.get('a')!.parentId).toBeNull();
  });

  it('builds symbols for nested children', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          config: { inputs: [], outputs: ['result.json'], skills: [] },
          children: [
            makeNode({ id: 'child_a', config: { inputs: [], outputs: ['a.json'], skills: [] } }),
            makeNode({ id: 'child_b', config: { inputs: [], outputs: ['b.json'], skills: [] } }),
          ],
        }),
      ],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.symbols.size).toBe(3);
    expect(graph.symbols.get('parent')!.depth).toBe(0);
    expect(graph.symbols.get('parent')!.childIds).toEqual(['child_a', 'child_b']);
    expect(graph.symbols.get('parent')!.descendantIds).toEqual(['child_a', 'child_b']);

    expect(graph.symbols.get('child_a')!.depth).toBe(1);
    expect(graph.symbols.get('child_a')!.parentId).toBe('parent');
    expect(graph.symbols.get('child_a')!.topoIndex).toBe(-1);
  });

  it('collects deep descendants', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'root',
          children: [
            makeNode({
              id: 'mid',
              children: [
                makeNode({ id: 'leaf' }),
              ],
            }),
          ],
        }),
      ],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.symbols.size).toBe(3);
    expect(graph.symbols.get('root')!.descendantIds).toEqual(['mid', 'leaf']);
    expect(graph.symbols.get('mid')!.descendantIds).toEqual(['leaf']);
    expect(graph.symbols.get('leaf')!.descendantIds).toEqual([]);
  });

  it('computes topological order', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a' }),
        makeNode({ id: 'b' }),
        makeNode({ id: 'c' }),
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.topoOrder).toEqual(['a', 'b', 'c']);
    expect(graph.hasCycle).toBe(false);
    expect(graph.cycleNodes).toEqual([]);

    expect(graph.symbols.get('a')!.topoIndex).toBe(0);
    expect(graph.symbols.get('b')!.topoIndex).toBe(1);
    expect(graph.symbols.get('c')!.topoIndex).toBe(2);
  });

  it('detects cycles', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a' }),
        makeNode({ id: 'b' }),
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.hasCycle).toBe(true);
    expect(graph.cycleNodes).toContain('a');
    expect(graph.cycleNodes).toContain('b');
  });

  it('builds adjacency maps', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a' }),
        makeNode({ id: 'b' }),
        makeNode({ id: 'c' }),
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.symbols.get('a')!.successors).toEqual(['b', 'c']);
    expect(graph.symbols.get('a')!.predecessors).toEqual([]);
    expect(graph.symbols.get('b')!.predecessors).toEqual(['a']);
    expect(graph.symbols.get('c')!.predecessors).toEqual(['a']);
  });

  it('builds artifact registry', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: ['doc.pdf'], outputs: ['parsed.json'], skills: [] } }),
        makeNode({ id: 'b', config: { inputs: ['parsed.json'], outputs: ['summary.md'], skills: [] } }),
      ],
      edges: [{ from: 'a', to: 'b' }],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.artifacts.size).toBe(2);
    expect(graph.artifacts.get('parsed.json')!.producerId).toBe('a');
    expect(graph.artifacts.get('parsed.json')!.consumerIds.has('b')).toBe(true);
    expect(graph.artifacts.get('summary.md')!.producerId).toBe('b');
  });

  it('infers user upload files', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: ['doc.pdf', 'extra.txt'], outputs: ['parsed.json'], skills: [] } }),
        makeNode({ id: 'b', config: { inputs: ['parsed.json'], outputs: ['summary.md'], skills: [] } }),
      ],
      edges: [{ from: 'a', to: 'b' }],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.userUploadFiles).toEqual(['doc.pdf', 'extra.txt']);
  });

  it('computes availableAtPhase', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: ['doc.pdf'], outputs: ['parsed.json'], skills: [] } }),
        makeNode({ id: 'b', config: { inputs: ['parsed.json'], outputs: ['summary.md'], skills: [] } }),
        makeNode({ id: 'c', config: { inputs: ['parsed.json', 'summary.md'], outputs: ['final.pdf'], skills: [] } }),
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });

    const graph = buildFlowGraph(flow);

    // Before 'a': only user uploads available
    const beforeA = graph.availableAtPhase.get('a')!;
    expect(beforeA.has('doc.pdf')).toBe(true);
    expect(beforeA.has('parsed.json')).toBe(false);

    // Before 'b': user uploads + a's outputs
    const beforeB = graph.availableAtPhase.get('b')!;
    expect(beforeB.has('doc.pdf')).toBe(true);
    expect(beforeB.has('parsed.json')).toBe(true);
    expect(beforeB.has('summary.md')).toBe(false);

    // Before 'c': everything except c's own outputs
    const beforeC = graph.availableAtPhase.get('c')!;
    expect(beforeC.has('doc.pdf')).toBe(true);
    expect(beforeC.has('parsed.json')).toBe(true);
    expect(beforeC.has('summary.md')).toBe(true);
    expect(beforeC.has('final.pdf')).toBe(false);
  });

  it('detects interrupt capability', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'a',
          config: {
            inputs: [],
            outputs: [],
            skills: [],
            interrupts: [{ type: 'approval' }],
          },
        }),
        makeNode({ id: 'b' }),
      ],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.symbols.get('a')!.interruptCapable).toBe(true);
    expect(graph.symbols.get('b')!.interruptCapable).toBe(false);
  });

  it('detects interrupt capability from children', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          children: [
            makeNode({
              id: 'child',
              config: {
                inputs: [],
                outputs: [],
                skills: [],
                interrupts: [{ type: 'qa' }],
              },
            }),
          ],
        }),
      ],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.symbols.get('parent')!.interruptCapable).toBe(true);
    expect(graph.symbols.get('child')!.interruptCapable).toBe(true);
  });

  it('extracts inline ArtifactSchema from outputs', () => {
    const schema: ArtifactSchema = {
      name: 'result.json',
      format: 'json',
      description: 'The result',
      fields: [{ key: 'score', type: 'number', description: 'Score' }],
    };

    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'a',
          config: { inputs: [], outputs: [schema], skills: [] },
        }),
      ],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.symbols.get('a')!.declaredOutputs).toEqual(['result.json']);
    expect(graph.symbols.get('a')!.outputSchemas.get('result.json')).toEqual(schema);
    expect(graph.artifacts.get('result.json')!.schema).toEqual(schema);
  });

  it('pulls schemas from flow.artifacts registry', () => {
    const schema: ArtifactSchema = {
      name: 'data.json',
      format: 'json',
      description: 'Data file',
    };

    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'a',
          config: { inputs: [], outputs: ['data.json'], skills: [] },
        }),
      ],
      artifacts: { 'data.json': schema },
    });

    const graph = buildFlowGraph(flow);

    // Schema pulled from flow.artifacts even though output is a plain string
    expect(graph.symbols.get('a')!.outputSchemas.get('data.json')).toEqual(schema);
    expect(graph.artifacts.get('data.json')!.schema).toEqual(schema);
  });

  it('inline schemas take precedence over flow.artifacts', () => {
    const inlineSchema: ArtifactSchema = {
      name: 'data.json',
      format: 'json',
      description: 'Inline version',
    };
    const registrySchema: ArtifactSchema = {
      name: 'data.json',
      format: 'json',
      description: 'Registry version',
    };

    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'a',
          config: { inputs: [], outputs: [inlineSchema], skills: [] },
        }),
      ],
      artifacts: { 'data.json': registrySchema },
    });

    const graph = buildFlowGraph(flow);

    expect(graph.symbols.get('a')!.outputSchemas.get('data.json')!.description).toBe('Inline version');
  });

  it('handles single-node flow with no edges', () => {
    const flow = makeFlow({
      nodes: [makeNode({ id: 'solo', config: { inputs: ['doc.pdf'], outputs: ['result.md'], skills: [] } })],
    });

    const graph = buildFlowGraph(flow);

    expect(graph.topoOrder).toEqual(['solo']);
    expect(graph.hasCycle).toBe(false);
    expect(graph.userUploadFiles).toEqual(['doc.pdf']);
    expect(graph.symbols.size).toBe(1);
  });
});
