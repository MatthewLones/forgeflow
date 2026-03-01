import { describe, it, expect } from 'vitest';
import { checkBudget } from '../src/passes/budget.js';
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

describe('checkBudget', () => {
  it('warns when node budgets exceed flow budget (turns)', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [], budget: { maxTurns: 60, maxBudgetUsd: 5 } }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [], budget: { maxTurns: 60, maxBudgetUsd: 5 } }, children: [] },
      ],
    });
    const diagnostics = checkBudget(buildFlowGraph(flow));
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.some((w) => w.code === 'BUDGET_SUM_EXCEEDS_FLOW')).toBe(true);
  });

  it('suggests budget when node has none', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [] }, children: [] },
      ],
    });
    const diagnostics = checkBudget(buildFlowGraph(flow));
    const suggestions = diagnostics.filter((d) => d.severity === 'suggestion');
    expect(suggestions.some((s) => s.code === 'NO_NODE_BUDGET')).toBe(true);
  });

  it('warns when children budgets exceed parent', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate.',
          config: { inputs: [], outputs: [], skills: [], budget: { maxTurns: 50, maxBudgetUsd: 5 } },
          children: [
            { id: 'child_a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [], budget: { maxTurns: 30, maxBudgetUsd: 3 } }, children: [] },
            { id: 'child_b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [], budget: { maxTurns: 30, maxBudgetUsd: 3 } }, children: [] },
          ],
        },
      ],
    });
    const diagnostics = checkBudget(buildFlowGraph(flow));
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.some((w) => w.code === 'CHILDREN_BUDGET_EXCEEDS_PARENT')).toBe(true);
  });

  it('passes clean budget', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'a', type: 'agent', name: 'A', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [], budget: { maxTurns: 40, maxBudgetUsd: 4 } }, children: [] },
        { id: 'b', type: 'agent', name: 'B', instructions: 'Do.', config: { inputs: [], outputs: [], skills: [], budget: { maxTurns: 40, maxBudgetUsd: 4 } }, children: [] },
      ],
    });
    const diagnostics = checkBudget(buildFlowGraph(flow));
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
