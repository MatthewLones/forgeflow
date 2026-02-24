import { describe, it, expect } from 'vitest';
import { compilePhasePrompt, FORGEFLOW_PHASE_SYSTEM_PROMPT } from '../src/compiler.js';
import type { CompileContext } from '../src/compiler.js';
import type { FlowNode } from '@forgeflow/types';

function makeContext(overrides: Partial<CompileContext> = {}): CompileContext {
  return {
    flowName: 'Test Flow',
    globalSkills: [],
    inputSources: new Map(),
    flowBudget: { maxTurns: 100, maxBudgetUsd: 10, timeoutMs: 300000 },
    ...overrides,
  };
}

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

describe('compilePhasePrompt', () => {
  it('produces prompt with all standard sections', () => {
    const context = makeContext({
      inputSources: new Map([['doc.pdf', 'user_upload']]),
    });
    const node = makeNode({
      name: 'Parse Document',
      instructions: 'Read the document and extract content.',
      config: {
        inputs: ['doc.pdf'],
        outputs: ['parsed.json'],
        skills: [],
        budget: { maxTurns: 25, maxBudgetUsd: 3 },
      },
    });
    const prompt = compilePhasePrompt(node, context);

    expect(prompt).toContain('# Phase: Parse Document');
    expect(prompt).toContain('## Your Task');
    expect(prompt).toContain('Read the document and extract content.');
    expect(prompt).toContain('## Input Files');
    expect(prompt).toContain('input/doc.pdf (user upload)');
    expect(prompt).toContain('## Output Files (you MUST produce these)');
    expect(prompt).toContain('output/parsed.json');
    expect(prompt).toContain('## Budget');
    expect(prompt).toContain('Max turns: 25');
    expect(prompt).toContain('$3.00');
    expect(prompt).toContain('## Rules');
  });

  it('includes input source attribution from prior node', () => {
    const context = makeContext({
      inputSources: new Map([['data.json', 'parse_step']]),
    });
    const node = makeNode({
      config: { inputs: ['data.json'], outputs: ['result.json'], skills: [] },
    });
    const prompt = compilePhasePrompt(node, context);
    expect(prompt).toContain('input/data.json (from parse_step)');
  });

  it('falls back to flow budget when node has no budget', () => {
    const context = makeContext({
      flowBudget: { maxTurns: 200, maxBudgetUsd: 20, timeoutMs: 600000 },
    });
    const node = makeNode(); // no config.budget
    const prompt = compilePhasePrompt(node, context);
    expect(prompt).toContain('Max turns: 200');
    expect(prompt).toContain('$20.00');
  });

  it('includes subagent sections for nodes with children', () => {
    const node = makeNode({
      name: 'Research Phase',
      instructions: 'Coordinate parallel research.',
      config: {
        inputs: ['data.json'],
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
            inputs: ['data.json'],
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
            inputs: ['data.json'],
            outputs: ['findings_b.json'],
            skills: [],
            budget: { maxTurns: 30, maxBudgetUsd: 4 },
          },
          children: [],
        },
      ],
    });
    const prompt = compilePhasePrompt(node, makeContext());

    expect(prompt).toContain('## Subagents — Launch All 2 Concurrently');
    expect(prompt).toContain('### Subagent 1: Researcher A');
    expect(prompt).toContain('### Subagent 2: Researcher B');
    expect(prompt).toContain('Analyze liability.');
    expect(prompt).toContain('Analyze IP.');
    expect(prompt).toContain('**Budget:** 30 turns, $4.00');
    expect(prompt).toContain('**Skills:** legal-basics');
    expect(prompt).toContain('Launch all subagents concurrently');
  });

  it('produces checkpoint prompt for checkpoint nodes', () => {
    const context = makeContext({
      inputSources: new Map([['analysis.json', 'research']]),
    });
    const node = makeNode({
      type: 'checkpoint',
      name: 'Expert Review',
      instructions: 'Present analysis to the expert for review.',
      config: {
        inputs: ['analysis.json'],
        outputs: ['decisions.json'],
        skills: [],
        presentation: { title: 'Analysis Complete', sections: ['findings', 'recommendations'] },
      },
    });
    const prompt = compilePhasePrompt(node, context);

    expect(prompt).toContain('# Checkpoint: Expert Review');
    expect(prompt).toContain('execution pauses here for human input');
    expect(prompt).toContain('## Instructions');
    expect(prompt).toContain('Present analysis to the expert for review.');
    expect(prompt).toContain('## Files to Present');
    expect(prompt).toContain('analysis.json (from research)');
    expect(prompt).toContain('## Expected User Input');
    expect(prompt).toContain('decisions.json');
    expect(prompt).toContain('## Presentation');
    expect(prompt).toContain('**Title:** Analysis Complete');
    expect(prompt).toContain('findings, recommendations');
  });

  it('includes interrupt protocol when node has interrupts', () => {
    const node = makeNode({
      config: {
        inputs: [],
        outputs: [],
        skills: [],
        interrupts: [{ type: 'approval', mode: 'inline' }],
      },
    });
    const prompt = compilePhasePrompt(node, makeContext());

    expect(prompt).toContain('## Interrupt Protocol');
    expect(prompt).toContain('__INTERRUPT__');
    expect(prompt).toContain('__ANSWER__');
  });

  it('includes interrupt protocol when child has interrupts', () => {
    const node = makeNode({
      children: [
        {
          id: 'child',
          type: 'agent' as const,
          name: 'Child',
          instructions: 'Work and ask questions.',
          config: {
            inputs: [],
            outputs: ['result.json'],
            skills: [],
            interrupts: [{ type: 'qa' }],
          },
          children: [],
        },
      ],
    });
    const prompt = compilePhasePrompt(node, makeContext());
    expect(prompt).toContain('## Interrupt Protocol');
  });

  it('omits interrupt protocol when no interrupts configured', () => {
    const node = makeNode();
    const prompt = compilePhasePrompt(node, makeContext());
    expect(prompt).not.toContain('## Interrupt Protocol');
  });

  it('merges and deduplicates global + node skills', () => {
    const context = makeContext({ globalSkills: ['common-skill', 'shared-skill'] });
    const node = makeNode({
      config: {
        inputs: [],
        outputs: [],
        skills: ['shared-skill', 'node-specific'],
      },
    });
    const prompt = compilePhasePrompt(node, context);

    expect(prompt).toContain('## Skills Available');
    expect(prompt).toContain('common-skill');
    expect(prompt).toContain('shared-skill');
    expect(prompt).toContain('node-specific');
    // 'shared-skill' should only appear once in the skills list
    const skillMatches = prompt.match(/- shared-skill/g);
    expect(skillMatches).toHaveLength(1);
  });

  it('exports FORGEFLOW_PHASE_SYSTEM_PROMPT constant', () => {
    expect(FORGEFLOW_PHASE_SYSTEM_PROMPT).toContain('ForgeFlow workflow');
    expect(FORGEFLOW_PHASE_SYSTEM_PROMPT).toContain('output/ directory');
    expect(FORGEFLOW_PHASE_SYSTEM_PROMPT).toContain('input/ directory');
  });
});
