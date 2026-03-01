import { describe, it, expect } from 'vitest';
import { compilePhase, compileChildPrompts, compilePhasePrompt, compileChildPromptFiles, createCompileContext } from '../src/compiler.js';
import type { FlowNode, FlowDefinition } from '@forgeflow/types';
import { buildFlowGraph } from '../../validator/src/flow-graph.js';

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
    description: 'Test flow',
    nodes: [],
    edges: [],
    skills: [],
    budget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
    ...overrides,
  };
}

describe('compilePhase (FlowGraph API)', () => {
  it('returns both IR and markdown', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({ id: 'a', name: 'Phase A', config: { inputs: [], outputs: ['out.json'], skills: [] } }),
      ],
    });
    const graph = buildFlowGraph(flow);
    const { ir, markdown } = compilePhase('a', graph);

    expect(ir.kind).toBe('agent');
    expect(ir.nodeId).toBe('a');
    expect(ir.name).toBe('Phase A');
    expect(markdown).toContain('# Phase: Phase A');
    expect(markdown).toContain('## Your Task');
  });

  it('produces identical markdown to legacy compilePhasePrompt', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parse',
          name: 'Parse Document',
          instructions: 'Read the document and extract content.',
          config: {
            inputs: ['doc.pdf'],
            outputs: ['parsed.json'],
            skills: ['extraction'],
            budget: { maxTurns: 25, maxBudgetUsd: 3 },
          },
        }),
        makeNode({
          id: 'analyze',
          name: 'Analyze',
          instructions: 'Analyze the parsed data.',
          config: {
            inputs: ['parsed.json'],
            outputs: ['analysis.json'],
            skills: [],
            budget: { maxTurns: 50, maxBudgetUsd: 5 },
          },
        }),
      ],
      edges: [{ from: 'parse', to: 'analyze' }],
      skills: ['common-skill'],
    });
    const graph = buildFlowGraph(flow);

    // New API
    const { markdown: newMarkdown } = compilePhase('analyze', graph);

    // Legacy API
    const context = createCompileContext(graph, 'analyze');
    const legacyMarkdown = compilePhasePrompt(graph.symbols.get('analyze')!.node, context);

    expect(newMarkdown).toBe(legacyMarkdown);
  });

  it('throws for unknown nodeId', () => {
    const flow = makeFlow({
      nodes: [makeNode({ id: 'a' })],
    });
    const graph = buildFlowGraph(flow);
    expect(() => compilePhase('nonexistent', graph)).toThrow('not found');
  });

  it('handles checkpoint nodes', () => {
    const flow = makeFlow({
      nodes: [
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
    });
    const graph = buildFlowGraph(flow);
    const { ir, markdown } = compilePhase('review', graph);

    expect(ir.kind).toBe('checkpoint');
    expect(markdown).toContain('# Checkpoint: Expert Review');
  });
});

describe('compileChildPrompts (FlowGraph API)', () => {
  it('produces identical markdowns to legacy compileChildPromptFiles', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          name: 'Research Phase',
          instructions: 'Coordinate research.',
          config: {
            inputs: [],
            outputs: ['findings_a.json', 'findings_b.json'],
            skills: [],
            budget: { maxTurns: 100, maxBudgetUsd: 15 },
          },
          children: [
            {
              id: 'child_a',
              type: 'agent' as const,
              name: 'Researcher A',
              instructions: 'Analyze liability.',
              config: {
                inputs: [],
                outputs: ['findings_a.json'],
                skills: ['legal-basics'],
                budget: { maxTurns: 30, maxBudgetUsd: 4 },
              },
              children: [],
            },
            {
              id: 'child_b',
              type: 'agent' as const,
              name: 'Researcher B',
              instructions: 'Analyze IP.',
              config: {
                inputs: [],
                outputs: ['findings_b.json'],
                skills: [],
                budget: { maxTurns: 30, maxBudgetUsd: 4 },
              },
              children: [],
            },
          ],
        }),
      ],
    });
    const graph = buildFlowGraph(flow);

    // New API
    const { irs, markdowns: newMarkdowns } = compileChildPrompts('parent', graph);

    // Legacy API
    const context = createCompileContext(graph, 'parent');
    const legacyMarkdowns = compileChildPromptFiles(graph.symbols.get('parent')!.node, context);

    expect(newMarkdowns.size).toBe(legacyMarkdowns.size);
    for (const [filename, legacyContent] of legacyMarkdowns) {
      expect(newMarkdowns.get(filename)).toBe(legacyContent);
    }

    // IRs are also present
    expect(irs.children.size).toBe(2);
    expect(irs.children.has('child_a.md')).toBe(true);
    expect(irs.children.has('child_b.md')).toBe(true);
  });

  it('handles recursive descendants with parity', () => {
    const flow = makeFlow({
      nodes: [
        makeNode({
          id: 'parent',
          name: 'Research',
          instructions: 'Coordinate.',
          config: {
            inputs: [],
            outputs: ['final.json'],
            skills: [],
            budget: { maxTurns: 100, maxBudgetUsd: 15 },
          },
          children: [
            {
              id: 'child_a',
              type: 'agent' as const,
              name: 'Child A',
              instructions: 'Delegate.',
              config: {
                inputs: [],
                outputs: ['child_out.json'],
                skills: [],
                budget: { maxTurns: 50, maxBudgetUsd: 7 },
              },
              children: [
                {
                  id: 'grandchild_x',
                  type: 'agent' as const,
                  name: 'Grandchild X',
                  instructions: 'Analyze X.',
                  config: {
                    inputs: [],
                    outputs: ['gc_x.json'],
                    skills: ['analysis'],
                    budget: { maxTurns: 20, maxBudgetUsd: 2 },
                  },
                  children: [],
                },
              ],
            },
          ],
        }),
      ],
    });
    const graph = buildFlowGraph(flow);

    const { markdowns: newMarkdowns } = compileChildPrompts('parent', graph);
    const context = createCompileContext(graph, 'parent');
    const legacyMarkdowns = compileChildPromptFiles(graph.symbols.get('parent')!.node, context);

    expect(newMarkdowns.size).toBe(2); // child_a + grandchild_x
    for (const [filename, legacyContent] of legacyMarkdowns) {
      expect(newMarkdowns.get(filename)).toBe(legacyContent);
    }
  });
});
