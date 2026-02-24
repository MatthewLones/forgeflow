import { describe, it, expect } from 'vitest';
import { checkStructural } from '../src/passes/structural.js';
import type { FlowDefinition } from '@forgeflow/types';

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'test_flow',
    name: 'Test Flow',
    version: '1.0',
    description: 'A test flow',
    skills: [],
    budget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
    nodes: [
      {
        id: 'node_a',
        type: 'agent',
        name: 'Node A',
        instructions: 'Do A.',
        config: { inputs: [], outputs: ['a.json'], skills: [] },
        children: [],
      },
      {
        id: 'node_b',
        type: 'agent',
        name: 'Node B',
        instructions: 'Do B.',
        config: { inputs: ['a.json'], outputs: ['b.json'], skills: [] },
        children: [],
      },
    ],
    edges: [{ from: 'node_a', to: 'node_b' }],
    ...overrides,
  };
}

describe('checkStructural', () => {
  it('passes a valid linear flow', () => {
    const diagnostics = checkStructural(makeFlow());
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('detects cycle in edges', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do A.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do B.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
        { id: 'c', type: 'agent', name: 'C', instructions: 'Do C.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'CYCLE_DETECTED')).toBe(true);
  });

  it('detects duplicate node IDs', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'same', type: 'agent', name: 'A', instructions: 'Do A.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
        { id: 'same', type: 'agent', name: 'B', instructions: 'Do B.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
      ],
      edges: [],
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'DUPLICATE_NODE_ID')).toBe(true);
  });

  it('detects duplicate IDs across nesting levels', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate.',
          config: { inputs: [], outputs: [], skills: [] },
          children: [
            { id: 'parent', type: 'agent', name: 'Child with same ID', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
          ],
        },
      ],
      edges: [],
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'DUPLICATE_NODE_ID')).toBe(true);
  });

  it('detects invalid edge references', () => {
    const flow = makeFlow({
      edges: [{ from: 'node_a', to: 'nonexistent' }],
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'INVALID_EDGE_REF')).toBe(true);
  });

  it('detects orphan node', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do A.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do B.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
        { id: 'c', type: 'agent', name: 'C', instructions: 'Do C.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }], // c is orphan
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'ORPHAN_NODE')).toBe(true);
  });

  it('detects dead-end node', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do A.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do B.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
        { id: 'c', type: 'agent', name: 'C', instructions: 'Do C.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
      ],
      edges: [{ from: 'b', to: 'c' }], // a is dead-end (no outgoing) AND orphan; b starts but a doesn't connect
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'DEAD_END_NODE' || e.code === 'ORPHAN_NODE')).toBe(true);
  });

  it('rejects checkpoint with children', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'cp',
          type: 'checkpoint',
          name: 'CP',
          instructions: 'Review.',
          config: {
            inputs: [],
            outputs: [],
            skills: [],
            presentation: { title: 'Review', sections: ['data'] },
          },
          children: [
            { id: 'child', type: 'agent', name: 'Child', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
          ],
        },
      ],
      edges: [],
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'NON_AGENT_HAS_CHILDREN')).toBe(true);
  });

  it('rejects checkpoint without presentation', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'cp',
          type: 'checkpoint',
          name: 'CP',
          instructions: 'Review.',
          config: { inputs: [], outputs: [], skills: [] },
          children: [],
        },
      ],
      edges: [],
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'CHECKPOINT_NO_PRESENTATION')).toBe(true);
  });

  it('rejects empty instructions on agent', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'empty',
          type: 'agent',
          name: 'Empty',
          instructions: '',
          config: { inputs: [], outputs: [], skills: [] },
          children: [],
        },
      ],
      edges: [],
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'EMPTY_INSTRUCTIONS')).toBe(true);
  });

  it('rejects invalid node ID', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'Invalid_ID',
          type: 'agent',
          name: 'Bad ID',
          instructions: 'Do.',
          config: { inputs: [], outputs: [], skills: [] },
          children: [],
        },
      ],
      edges: [],
    });
    const errors = checkStructural(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'INVALID_NODE_ID')).toBe(true);
  });
});
