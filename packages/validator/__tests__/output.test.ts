import { describe, it, expect } from 'vitest';
import { checkOutputUniqueness } from '../src/passes/output.js';
import { buildFlowGraph } from '../src/flow-graph.js';
import type { FlowDefinition } from '@forgeflow/types';

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'test_flow',
    name: 'Test Flow',
    version: '1.0',
    description: 'A test flow',
    skills: [],
    budget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe('checkOutputUniqueness', () => {
  it('passes with unique outputs', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: ['x.json'], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [], outputs: ['y.json'], skills: [] }, children: [] },
      ],
    });
    const errors = checkOutputUniqueness(buildFlowGraph(flow)).filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('detects duplicate outputs across nodes', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: ['same.json'], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [], outputs: ['same.json'], skills: [] }, children: [] },
      ],
    });
    const errors = checkOutputUniqueness(buildFlowGraph(flow)).filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('DUPLICATE_OUTPUT');
  });

  it('allows parent and child to share output (same node tree)', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate.',
          config: { inputs: [], outputs: ['result.json'], skills: [] },
          children: [
            { id: 'child', type: 'agent', name: 'Child', instructions: 'Do.', config: { inputs: [], outputs: ['result.json'], skills: [] }, children: [] },
          ],
        },
      ],
    });
    const errors = checkOutputUniqueness(buildFlowGraph(flow)).filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});
