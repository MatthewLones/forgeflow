import { describe, it, expect } from 'vitest';
import { resolvePhaseIR, resolveChildPromptIRs } from '../src/resolve.js';
import { buildFlowGraph } from '../../validator/src/flow-graph.js';
import type { FlowDefinition, FlowNode, AgentPhaseIR, CheckpointIR } from '@forgeflow/types';

function makeNode(overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id: 'test_node',
    type: 'agent',
    name: 'Test Node',
    instructions: 'Do the work.',
    config: { inputs: [], outputs: [], skills: [] },
    children: [],
    ...overrides,
  };
}

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'test_flow',
    name: 'Test Flow',
    version: '1.0.0',
    description: 'Test',
    nodes: [],
    edges: [],
    skills: [],
    budget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
    ...overrides,
  };
}

describe('resolvePhaseIR', () => {
  it('resolves an agent node with all sections', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parse',
          name: 'Parse Document',
          instructions: 'Extract content.',
          config: { inputs: ['doc.pdf'], outputs: ['parsed.json'], skills: ['extractor'] },
        }),
      ],
      skills: ['global-skill'],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('parse')!.node, graph) as AgentPhaseIR;

    expect(ir.kind).toBe('agent');
    expect(ir.nodeId).toBe('parse');
    expect(ir.name).toBe('Parse Document');
    expect(ir.isChild).toBe(false);
    expect(ir.flowName).toBe('Test Flow');
    expect(ir.instructions).toBe('Extract content.');
    expect(ir.inputs).toHaveLength(1);
    expect(ir.inputs[0].file).toBe('doc.pdf');
    expect(ir.outputs).toHaveLength(1);
    expect(ir.outputs[0].file).toBe('parsed.json');
    expect(ir.skills).toHaveLength(2); // global-skill + extractor
    expect(ir.budget).toBeDefined();
    expect(ir.rules).toBeUndefined();
    expect(ir.children).toHaveLength(0);
  });

  it('includes user_upload source attribution for entry node inputs', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: ['upload.pdf'], outputs: ['result.json'], skills: [] } }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('a')!.node, graph) as AgentPhaseIR;

    expect(ir.inputs[0].source).toBe('user_upload');
    expect(ir.inputs[0].sourceLabel).toBe('user upload');
  });

  it('includes producer source attribution for downstream inputs', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', config: { inputs: [], outputs: ['data.json'], skills: [] } }),
        makeNode({ id: 'b', config: { inputs: ['data.json'], outputs: ['result.json'], skills: [] } }),
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('b')!.node, graph) as AgentPhaseIR;

    expect(ir.inputs[0].source).toBe('a');
    expect(ir.inputs[0].sourceLabel).toBe('from a');
  });

  it('resolves a checkpoint node', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'producer', config: { inputs: [], outputs: ['analysis.json'], skills: [] } }),
        makeNode({
          id: 'review',
          type: 'checkpoint',
          name: 'Expert Review',
          instructions: 'Review the analysis.',
          config: {
            inputs: ['analysis.json'],
            outputs: ['decisions.json'],
            skills: [],
            presentation: { title: 'Review', sections: ['findings'] },
          },
        }),
      ],
      edges: [{ from: 'producer', to: 'review' }],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('review')!.node, graph) as CheckpointIR;

    expect(ir.kind).toBe('checkpoint');
    expect(ir.name).toBe('Expert Review');
    expect(ir.filesToPresent).toHaveLength(1);
    expect(ir.filesToPresent[0].file).toBe('analysis.json');
    expect(ir.filesToPresent[0].source).toBe('producer');
    expect(ir.expectedInputs).toHaveLength(1);
    expect(ir.expectedInputs[0].file).toBe('decisions.json');
    expect(ir.presentation?.title).toBe('Review');
  });

  it('merges and deduplicates global + node skills', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'a',
          config: { inputs: [], outputs: [], skills: ['shared', 'node-only'] },
        }),
      ],
      skills: ['shared', 'global-only'],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('a')!.node, graph) as AgentPhaseIR;

    const skillNames = ir.skills.map((s) => s.name);
    expect(skillNames).toEqual(['shared', 'global-only', 'node-only']);
  });

  it('falls back to flow budget when node has no budget', () => {
    const flow = makeFlow({
      nodes: [makeNode({ id: 'a' })],
      budget: { maxTurns: 200, maxBudgetUsd: 20, timeoutMs: 600000 },
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('a')!.node, graph) as AgentPhaseIR;

    expect(ir.budget?.maxTurns).toBe(200);
    expect(ir.budget?.maxBudgetUsd).toBe(20);
  });

  it('sets interrupt.enabled when node has interrupts', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'a',
          config: {
            inputs: [],
            outputs: [],
            skills: [],
            interrupts: [{ type: 'approval', mode: 'inline' }],
          },
        }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('a')!.node, graph) as AgentPhaseIR;

    expect(ir.interrupt.enabled).toBe(true);
  });

  it('sets interrupt.enabled when child has interrupts', () => {
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
    const ir = resolvePhaseIR(graph.symbols.get('parent')!.node, graph) as AgentPhaseIR;

    expect(ir.interrupt.enabled).toBe(true);
  });

  it('sets interrupt.enabled = false when no interrupts', () => {
    const flow = makeFlow({ nodes: [makeNode({ id: 'a' })] });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('a')!.node, graph) as AgentPhaseIR;

    expect(ir.interrupt.enabled).toBe(false);
  });

  it('includes children references', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          children: [
            makeNode({
              id: 'child_a',
              name: 'Researcher A',
              config: { inputs: [], outputs: ['a.json'], skills: [] },
            }),
            makeNode({
              id: 'child_b',
              name: 'Researcher B',
              config: { inputs: [], outputs: ['b.json'], skills: [] },
            }),
          ],
        }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('parent')!.node, graph) as AgentPhaseIR;

    expect(ir.children).toHaveLength(2);
    expect(ir.children[0]).toEqual({
      index: 1,
      id: 'child_a',
      name: 'Researcher A',
      promptFile: 'prompts/child_a.md',
      outputs: ['a.json'],
      wave: 0,
    });
    expect(ir.children[1].index).toBe(2);
  });

  it('marks isChild = true for child nodes', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          children: [makeNode({ id: 'child' })],
        }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('child')!.node, graph, { isChild: true }) as AgentPhaseIR;

    expect(ir.isChild).toBe(true);
  });

  it('omits budget for children without explicit budget', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          children: [makeNode({ id: 'child' })], // no config.budget
        }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('child')!.node, graph, { isChild: true }) as AgentPhaseIR;

    expect(ir.budget).toBeUndefined();
  });

  it('includes budget for children with explicit budget', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          children: [
            makeNode({
              id: 'child',
              config: { inputs: [], outputs: [], skills: [], budget: { maxTurns: 30, maxBudgetUsd: 4 } },
            }),
          ],
        }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const ir = resolvePhaseIR(graph.symbols.get('child')!.node, graph, { isChild: true }) as AgentPhaseIR;

    expect(ir.budget?.maxTurns).toBe(30);
    expect(ir.budget?.maxBudgetUsd).toBe(4);
  });
});

describe('resolveChildPromptIRs', () => {
  it('resolves IR for all descendants recursively', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          children: [
            makeNode({
              id: 'child_a',
              name: 'Child A',
              children: [
                makeNode({ id: 'grandchild_x', name: 'Grandchild X' }),
              ],
            }),
            makeNode({ id: 'child_b', name: 'Child B' }),
          ],
        }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const result = resolveChildPromptIRs(graph.symbols.get('parent')!.node, graph);

    expect(result.children.size).toBe(3);
    expect(result.children.has('child_a.md')).toBe(true);
    expect(result.children.has('child_b.md')).toBe(true);
    expect(result.children.has('grandchild_x.md')).toBe(true);

    // All are marked as children
    for (const [, ir] of result.children) {
      expect(ir.kind).toBe('agent');
      expect((ir as AgentPhaseIR).isChild).toBe(true);
    }
  });

  it('returns empty map for nodes with no children', () => {
    const flow = makeFlow({ nodes: [makeNode({ id: 'solo' })] });
    const graph = buildFlowGraph(flow);
    const result = resolveChildPromptIRs(graph.symbols.get('solo')!.node, graph);

    expect(result.children.size).toBe(0);
  });

  it('child IR includes its own children references', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          children: [
            makeNode({
              id: 'child_a',
              children: [
                makeNode({ id: 'gc_x', name: 'GC X' }),
                makeNode({ id: 'gc_y', name: 'GC Y' }),
              ],
            }),
          ],
        }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const result = resolveChildPromptIRs(graph.symbols.get('parent')!.node, graph);

    const childIR = result.children.get('child_a.md') as AgentPhaseIR;
    expect(childIR.children).toHaveLength(2);
    expect(childIR.children[0].id).toBe('gc_x');
    expect(childIR.children[1].id).toBe('gc_y');
  });
});
