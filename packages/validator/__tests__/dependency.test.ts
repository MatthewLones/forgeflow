import { describe, it, expect } from 'vitest';
import { checkDependencies } from '../src/passes/dependency.js';
import type { FlowDefinition } from '@flowforge/types';

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

describe('checkDependencies', () => {
  it('resolves a simple linear chain', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: ['doc.pdf'], outputs: ['x.json'], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: ['x.json'], outputs: ['y.json'], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const diagnostics = checkDependencies(flow, ['doc.pdf']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('detects unresolved input', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: ['missing.json'], outputs: ['x.json'], skills: [] }, children: [] },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(flow, []);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('UNRESOLVED_INPUT');
  });

  it('resolves user upload inputs', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: ['document.pdf'], outputs: ['x.json'], skills: [] }, children: [] },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(flow, ['document.pdf']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('suggests closest match for typo', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: ['risk_matrix.json'], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: ['risk_matirx.json'], outputs: [], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const diagnostics = checkDependencies(flow, []);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].suggestion).toContain('risk_matrix.json');
  });

  it('validates child inputs come from parent', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate.',
          config: { inputs: ['data.json'], outputs: ['result.json'], skills: [] },
          children: [
            { id: 'child', type: 'agent', name: 'Child', instructions: 'Do.', config: { inputs: ['data.json'], outputs: ['result.json'], skills: [] }, children: [] },
          ],
        },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(flow, ['data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('detects child depending on sibling output', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate.',
          config: { inputs: ['data.json'], outputs: ['a.json', 'b.json'], skills: [] },
          children: [
            { id: 'child_a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: ['data.json'], outputs: ['a.json'], skills: [] }, children: [] },
            { id: 'child_b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: ['a.json'], outputs: ['b.json'], skills: [] }, children: [] },
          ],
        },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(flow, ['data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('CHILD_DEPENDS_ON_SIBLING');
  });

  it('handles transitive dependencies', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: ['doc.pdf'], outputs: ['x.json'], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: ['x.json'], outputs: ['y.json'], skills: [] }, children: [] },
        { id: 'c', type: 'agent', name: 'C', instructions: 'Do.', config: { inputs: ['x.json', 'y.json'], outputs: ['z.json'], skills: [] }, children: [] },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });
    const diagnostics = checkDependencies(flow, ['doc.pdf']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});
