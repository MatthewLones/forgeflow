import { describe, it, expect } from 'vitest';
import { checkDependencies } from '../src/passes/dependency.js';
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

describe('checkDependencies', () => {
  it('resolves a simple linear chain', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: ['doc.pdf'], outputs: ['x.json'], skills: [] }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: ['x.json'], outputs: ['y.json'], skills: [] }, children: [] },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['doc.pdf']);
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
    const diagnostics = checkDependencies(buildFlowGraph(flow), []);
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
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['document.pdf']);
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
    const diagnostics = checkDependencies(buildFlowGraph(flow), []);
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
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('allows child depending on sibling output (wave ordering)', () => {
    // child_b depends on child_a's output — valid with wave ordering.
    // child_a runs in wave 0, child_b in wave 1.
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
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('detects circular dependencies among children', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate.',
          config: { inputs: ['data.json'], outputs: ['a.json', 'b.json'], skills: [] },
          children: [
            { id: 'child_a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: ['b.json'], outputs: ['a.json'], skills: [] }, children: [] },
            { id: 'child_b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: ['a.json'], outputs: ['b.json'], skills: [] }, children: [] },
          ],
        },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'CHILD_CYCLE')).toBe(true);
  });

  it('allows multi-wave child dependencies (3 waves)', () => {
    // wave 0: analyzer → wave 1: synthesizer → wave 2: reviewer
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate.',
          config: {
            inputs: ['data.json'],
            outputs: ['analysis.json', 'synthesis.json', 'review.json'],
            skills: [],
          },
          children: [
            { id: 'analyzer', type: 'agent', name: 'Analyzer', instructions: 'Analyze.', config: { inputs: ['data.json'], outputs: ['analysis.json'], skills: [] }, children: [] },
            { id: 'synthesizer', type: 'agent', name: 'Synthesizer', instructions: 'Synthesize.', config: { inputs: ['analysis.json'], outputs: ['synthesis.json'], skills: [] }, children: [] },
            { id: 'reviewer', type: 'agent', name: 'Reviewer', instructions: 'Review.', config: { inputs: ['synthesis.json'], outputs: ['review.json'], skills: [] }, children: [] },
          ],
        },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('allows parent to consume children outputs (aggregation pattern)', () => {
    // This is the core coordination pattern: parent delegates to children,
    // children produce outputs, parent declares those as inputs for aggregation.
    const flow = makeFlow({
      nodes: [
        {
          id: 'risk_assessment',
          type: 'agent',
          name: 'Risk Assessment',
          instructions: 'Coordinate risk analysis.',
          config: {
            inputs: ['startup_data.json', 'financial_findings.json', 'legal_findings.json', 'team_assessment.json'],
            outputs: ['financial_findings.json', 'legal_findings.json', 'team_assessment.json', 'risk_matrix.json'],
            skills: [],
          },
          children: [
            {
              id: 'analyze_financials',
              type: 'agent',
              name: 'Financial Analysis',
              instructions: 'Analyze financials.',
              config: { inputs: ['startup_data.json'], outputs: ['financial_findings.json'], skills: [] },
              children: [],
            },
            {
              id: 'analyze_legal',
              type: 'agent',
              name: 'Legal Analysis',
              instructions: 'Analyze legal.',
              config: { inputs: ['startup_data.json'], outputs: ['legal_findings.json'], skills: [] },
              children: [],
            },
            {
              id: 'analyze_team',
              type: 'agent',
              name: 'Team Assessment',
              instructions: 'Assess team.',
              config: { inputs: ['startup_data.json'], outputs: ['team_assessment.json'], skills: [] },
              children: [],
            },
          ],
        },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['startup_data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('allows parent to consume nested grandchild outputs', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'coordinator',
          type: 'agent',
          name: 'Coordinator',
          instructions: 'Coordinate.',
          config: {
            inputs: ['data.json', 'deep_result.json'],
            outputs: ['deep_result.json', 'final.json'],
            skills: [],
          },
          children: [
            {
              id: 'mid',
              type: 'agent',
              name: 'Mid',
              instructions: 'Middle layer.',
              config: { inputs: ['data.json'], outputs: ['deep_result.json'], skills: [] },
              children: [
                {
                  id: 'deep',
                  type: 'agent',
                  name: 'Deep',
                  instructions: 'Deep work.',
                  config: { inputs: ['data.json'], outputs: ['deep_result.json'], skills: [] },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('still rejects parent input not produced by any child or prior node', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate.',
          config: {
            inputs: ['data.json', 'nonexistent.json'],
            outputs: ['result.json'],
            skills: [],
          },
          children: [
            {
              id: 'child',
              type: 'agent',
              name: 'Child',
              instructions: 'Do.',
              config: { inputs: ['data.json'], outputs: ['result.json'], skills: [] },
              children: [],
            },
          ],
        },
      ],
      edges: [],
    });
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['data.json']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('UNRESOLVED_INPUT');
    expect(errors[0].message).toContain('nonexistent.json');
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
    const diagnostics = checkDependencies(buildFlowGraph(flow), ['doc.pdf']);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});
