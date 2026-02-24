import { describe, it, expect } from 'vitest';
import { parseFlowJSON, parseFlowObject } from '../src/parser.js';

const validSimpleFlow = {
  id: 'simple_summary',
  name: 'Simple Document Summary',
  version: '1.0',
  description: 'Reads a document and produces a structured summary',
  skills: [],
  budget: { maxTurns: 60, maxBudgetUsd: 8.0, timeoutMs: 300000 },
  nodes: [
    {
      id: 'extract_content',
      type: 'agent',
      name: 'Extract Document Content',
      instructions: 'Read the input document and extract structured content.',
      config: {
        inputs: ['document.pdf'],
        outputs: ['content_extracted.json'],
        skills: [],
        budget: { maxTurns: 25, maxBudgetUsd: 3.0 },
        estimatedDuration: '30s',
      },
      children: [],
    },
    {
      id: 'generate_summary',
      type: 'agent',
      name: 'Generate Summary',
      instructions: 'Using the extracted content, produce a 1-page summary.',
      config: {
        inputs: ['content_extracted.json'],
        outputs: ['summary.md'],
        skills: [],
        budget: { maxTurns: 20, maxBudgetUsd: 2.0 },
        estimatedDuration: '20s',
      },
      children: [],
    },
  ],
  edges: [{ from: 'extract_content', to: 'generate_summary' }],
};

describe('parseFlowJSON', () => {
  it('rejects invalid JSON', () => {
    const result = parseFlowJSON('not json {{{');
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_JSON');
  });
});

describe('parseFlowObject', () => {
  it('parses a valid simple flow', () => {
    const result = parseFlowObject(validSimpleFlow);
    expect(result.success).toBe(true);
    expect(result.flow).not.toBeNull();
    expect(result.flow!.id).toBe('simple_summary');
    expect(result.flow!.nodes).toHaveLength(2);
    expect(result.flow!.edges).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('parses a valid flow with children', () => {
    const flow = {
      ...validSimpleFlow,
      id: 'with_children',
      nodes: [
        {
          id: 'parent',
          type: 'agent',
          name: 'Parent Agent',
          instructions: 'Coordinate subagents.',
          config: {
            inputs: ['data.json'],
            outputs: ['result_a.json', 'result_b.json'],
            skills: ['some_skill'],
            budget: { maxTurns: 50, maxBudgetUsd: 5.0 },
          },
          children: [
            {
              id: 'child_a',
              type: 'agent',
              name: 'Child A',
              instructions: 'Do task A.',
              config: {
                inputs: ['data.json'],
                outputs: ['result_a.json'],
                skills: [],
                budget: { maxTurns: 20, maxBudgetUsd: 2.0 },
              },
              children: [],
            },
            {
              id: 'child_b',
              type: 'agent',
              name: 'Child B',
              instructions: 'Do task B.',
              config: {
                inputs: ['data.json'],
                outputs: ['result_b.json'],
                skills: [],
                budget: { maxTurns: 20, maxBudgetUsd: 2.0 },
              },
              children: [],
            },
          ],
        },
      ],
      edges: [],
    };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(true);
    expect(result.flow!.nodes[0].children).toHaveLength(2);
  });

  it('rejects missing required fields', () => {
    const result = parseFlowObject({ id: 'test' });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].code).toBe('SCHEMA_ERROR');
  });

  it('rejects invalid node ID format', () => {
    const flow = {
      ...validSimpleFlow,
      nodes: [
        {
          ...validSimpleFlow.nodes[0],
          id: 'Parse Input', // spaces not allowed
        },
      ],
      edges: [],
    };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.includes('snake_case'))).toBe(true);
  });

  it('rejects invalid node type', () => {
    const flow = {
      ...validSimpleFlow,
      nodes: [
        {
          ...validSimpleFlow.nodes[0],
          type: 'worker',
        },
      ],
      edges: [],
    };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(false);
  });

  it('rejects negative budget', () => {
    const flow = {
      ...validSimpleFlow,
      budget: { maxTurns: -5, maxBudgetUsd: 8.0, timeoutMs: 300000 },
    };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(false);
  });

  it('allows optional fields to be absent', () => {
    const flow = {
      ...validSimpleFlow,
      nodes: [
        {
          id: 'minimal_node',
          type: 'agent',
          name: 'Minimal',
          instructions: 'Do something.',
          config: {
            inputs: [],
            outputs: [],
            skills: [],
          },
          children: [],
        },
      ],
      edges: [],
    };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(true);
    expect(result.flow!.nodes[0].config.budget).toBeUndefined();
    expect(result.flow!.nodes[0].config.estimatedDuration).toBeUndefined();
    expect(result.flow!.nodes[0].config.presentation).toBeUndefined();
    expect(result.flow!.nodes[0].config.interrupts).toBeUndefined();
  });

  it('parses checkpoint node with presentation', () => {
    const flow = {
      ...validSimpleFlow,
      nodes: [
        {
          id: 'review',
          type: 'checkpoint',
          name: 'Review',
          instructions: 'Present data to user.',
          config: {
            inputs: ['data.json'],
            outputs: ['answers.json'],
            skills: [],
            presentation: {
              title: 'Review Complete',
              sections: ['findings', 'questions'],
            },
          },
          children: [],
        },
      ],
      edges: [],
    };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(true);
    expect(result.flow!.nodes[0].config.presentation!.title).toBe('Review Complete');
  });

  it('parses node with interrupt configs', () => {
    const flow = {
      ...validSimpleFlow,
      nodes: [
        {
          id: 'research',
          type: 'agent',
          name: 'Research',
          instructions: 'Research and ask questions.',
          config: {
            inputs: [],
            outputs: [],
            skills: [],
            interrupts: [
              { type: 'approval', mode: 'inline', timeoutMs: 60000 },
              { type: 'qa' },
            ],
          },
          children: [],
        },
      ],
      edges: [],
    };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(true);
    expect(result.flow!.nodes[0].config.interrupts).toHaveLength(2);
  });

  it('rejects invalid flow ID', () => {
    const flow = { ...validSimpleFlow, id: 'Invalid-Id' };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(false);
  });

  it('handles deeply nested children', () => {
    const flow = {
      ...validSimpleFlow,
      nodes: [
        {
          id: 'level_0',
          type: 'agent',
          name: 'Level 0',
          instructions: 'Top level.',
          config: { inputs: [], outputs: [], skills: [] },
          children: [
            {
              id: 'level_1',
              type: 'agent',
              name: 'Level 1',
              instructions: 'Nested.',
              config: { inputs: [], outputs: [], skills: [] },
              children: [
                {
                  id: 'level_2',
                  type: 'agent',
                  name: 'Level 2',
                  instructions: 'Deeply nested.',
                  config: { inputs: [], outputs: [], skills: [] },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
      edges: [],
    };
    const result = parseFlowObject(flow);
    expect(result.success).toBe(true);
    expect(result.flow!.nodes[0].children[0].children[0].id).toBe('level_2');
  });
});
