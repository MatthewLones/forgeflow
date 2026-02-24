import { describe, it, expect } from 'vitest';
import { checkInterrupts } from '../src/passes/interrupt.js';
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

describe('checkInterrupts', () => {
  it('rejects interrupt on checkpoint node', () => {
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
            interrupts: [{ type: 'approval' }],
          },
          children: [],
        },
      ],
    });
    const errors = checkInterrupts(flow).filter((d) => d.severity === 'error');
    expect(errors.some((e) => e.code === 'CHECKPOINT_HAS_INTERRUPTS')).toBe(true);
  });

  it('accepts interrupt on agent node', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          instructions: 'Do work and ask for approval.',
          config: {
            inputs: [],
            outputs: [],
            skills: [],
            interrupts: [{ type: 'approval', mode: 'inline' }],
          },
          children: [],
        },
      ],
    });
    const diagnostics = checkInterrupts(flow);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('warns on deep interrupt without parent handling', () => {
    const flow = makeFlow({
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent',
          instructions: 'Coordinate subagents.',
          config: { inputs: [], outputs: [], skills: [] },
          children: [
            {
              id: 'child',
              type: 'agent',
              name: 'Child',
              instructions: 'Do work.',
              config: {
                inputs: [],
                outputs: [],
                skills: [],
                interrupts: [{ type: 'qa' }],
              },
              children: [],
            },
          ],
        },
      ],
    });
    const warnings = checkInterrupts(flow).filter((d) => d.severity === 'warning');
    expect(warnings.some((w) => w.code === 'DEEP_INTERRUPT_NO_PARENT_HANDLING')).toBe(true);
  });
});
