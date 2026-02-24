import { describe, it, expect } from 'vitest';
import { compilePhasePrompt, compileChildPromptFiles, FORGEFLOW_PHASE_SYSTEM_PROMPT } from '../src/compiler.js';
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

  it('includes subagent reference table for nodes with children', () => {
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

    // Parent prompt has reference table, NOT inline instructions
    expect(prompt).toContain('## Subagents — Launch All 2 Concurrently');
    expect(prompt).toContain('prompts/child_a.md');
    expect(prompt).toContain('prompts/child_b.md');
    expect(prompt).toContain('| 1 | Researcher A | child_a |');
    expect(prompt).toContain('| 2 | Researcher B | child_b |');
    expect(prompt).toContain('Launch all subagents concurrently');

    // Progress markers still present in parent prompt
    expect(prompt).toContain('__CHILD_START__child_a.json');
    expect(prompt).toContain('__CHILD_DONE__child_a.json');
    expect(prompt).toContain('__CHILD_START__child_b.json');
    expect(prompt).toContain('__CHILD_DONE__child_b.json');

    // Child instructions NOT inlined in parent prompt
    expect(prompt).not.toContain('Analyze liability.');
    expect(prompt).not.toContain('Analyze IP.');
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

  it('parent prompt only references children, not grandchildren', () => {
    const node = makeNode({
      name: 'Research Phase',
      instructions: 'Coordinate research.',
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
          name: 'Parent Child',
          instructions: 'Delegate to sub-researchers.',
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
              instructions: 'Analyze subsection X.',
              config: {
                inputs: [],
                outputs: ['gc_x_out.json'],
                skills: ['analysis-skill'],
                budget: { maxTurns: 20, maxBudgetUsd: 2 },
              },
              children: [],
            },
            {
              id: 'grandchild_y',
              type: 'agent' as const,
              name: 'Grandchild Y',
              instructions: 'Analyze subsection Y.',
              config: {
                inputs: [],
                outputs: ['gc_y_out.json'],
                skills: [],
              },
              children: [],
            },
          ],
        },
      ],
    });
    const prompt = compilePhasePrompt(node, makeContext());

    // Parent prompt references child_a via table
    expect(prompt).toContain('## Subagents — Launch All 1 Concurrently');
    expect(prompt).toContain('prompts/child_a.md');
    expect(prompt).toContain('__CHILD_START__child_a.json');

    // Parent prompt does NOT contain grandchild details (those are in child_a.md)
    expect(prompt).not.toContain('grandchild_x');
    expect(prompt).not.toContain('grandchild_y');
    expect(prompt).not.toContain('Analyze subsection X.');
    expect(prompt).not.toContain('Analyze subsection Y.');
  });

  it('exports FORGEFLOW_PHASE_SYSTEM_PROMPT constant', () => {
    expect(FORGEFLOW_PHASE_SYSTEM_PROMPT).toContain('ForgeFlow workflow');
    expect(FORGEFLOW_PHASE_SYSTEM_PROMPT).toContain('output/ directory');
    expect(FORGEFLOW_PHASE_SYSTEM_PROMPT).toContain('input/ directory');
  });
});

describe('compileChildPromptFiles', () => {
  it('generates prompt files for direct children', () => {
    const node = makeNode({
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
          },
          children: [],
        },
      ],
    });
    const files = compileChildPromptFiles(node, makeContext());

    expect(files.size).toBe(2);
    expect(files.has('child_a.md')).toBe(true);
    expect(files.has('child_b.md')).toBe(true);

    const promptA = files.get('child_a.md')!;
    expect(promptA).toContain('# Subagent: Researcher A');
    expect(promptA).toContain('Analyze liability.');
    expect(promptA).toContain('input/data.json');
    expect(promptA).toContain('output/findings_a.json');
    expect(promptA).toContain('legal-basics');
    expect(promptA).toContain('Max turns: 30');
    expect(promptA).toContain('$4.00');

    const promptB = files.get('child_b.md')!;
    expect(promptB).toContain('# Subagent: Researcher B');
    expect(promptB).toContain('Analyze IP.');
  });

  it('generates prompt files for all descendants recursively', () => {
    const node = makeNode({
      children: [
        {
          id: 'child_a',
          type: 'agent' as const,
          name: 'Parent Child',
          instructions: 'Delegate to sub-researchers.',
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
              instructions: 'Analyze subsection X.',
              config: {
                inputs: [],
                outputs: ['gc_x_out.json'],
                skills: ['analysis-skill'],
                budget: { maxTurns: 20, maxBudgetUsd: 2 },
              },
              children: [],
            },
            {
              id: 'grandchild_y',
              type: 'agent' as const,
              name: 'Grandchild Y',
              instructions: 'Analyze subsection Y.',
              config: {
                inputs: [],
                outputs: ['gc_y_out.json'],
                skills: [],
              },
              children: [],
            },
          ],
        },
      ],
    });
    const files = compileChildPromptFiles(node, makeContext());

    // 3 prompt files: child + 2 grandchildren
    expect(files.size).toBe(3);
    expect(files.has('child_a.md')).toBe(true);
    expect(files.has('grandchild_x.md')).toBe(true);
    expect(files.has('grandchild_y.md')).toBe(true);

    // Child's prompt references grandchildren via table
    const childPrompt = files.get('child_a.md')!;
    expect(childPrompt).toContain('## Subagents — Launch All 2 Concurrently');
    expect(childPrompt).toContain('prompts/grandchild_x.md');
    expect(childPrompt).toContain('prompts/grandchild_y.md');
    expect(childPrompt).toContain('__CHILD_START__grandchild_x.json');
    expect(childPrompt).toContain('__CHILD_DONE__grandchild_y.json');
    // Child's prompt does NOT inline grandchild instructions
    expect(childPrompt).not.toContain('Analyze subsection X.');
    expect(childPrompt).not.toContain('Analyze subsection Y.');

    // Grandchild prompts are self-contained
    const gcX = files.get('grandchild_x.md')!;
    expect(gcX).toContain('# Subagent: Grandchild X');
    expect(gcX).toContain('Analyze subsection X.');
    expect(gcX).toContain('analysis-skill');
    expect(gcX).toContain('Max turns: 20');
    expect(gcX).toContain('$2.00');
    expect(gcX).not.toContain('## Subagents'); // no children of its own
  });

  it('returns empty map for nodes with no children', () => {
    const node = makeNode();
    const files = compileChildPromptFiles(node, makeContext());
    expect(files.size).toBe(0);
  });
});
