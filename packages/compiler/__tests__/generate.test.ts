import { describe, it, expect } from 'vitest';
import { generateMarkdown } from '../src/generate.js';
import type { AgentPhaseIR, CheckpointIR } from '@forgeflow/types';

function makeAgentIR(overrides: Partial<AgentPhaseIR> = {}): AgentPhaseIR {
  return {
    kind: 'agent',
    nodeId: 'test',
    name: 'Test Phase',
    isChild: false,
    flowName: 'Test Flow',
    instructions: 'Do the work.',
    inputs: [],
    outputs: [],
    skills: [],
    budget: { maxTurns: 100, maxBudgetUsd: 10 },
    rules: [
      'Write all output files to the output/ directory',
      'Read input files from the input/ directory',
      'Verify each output file exists before finishing',
      'Stay within budget constraints',
    ],
    children: [],
    interrupt: { enabled: false },
    ...overrides,
  };
}

describe('generateMarkdown', () => {
  it('generates agent markdown with all sections', () => {
    const ir = makeAgentIR({
      name: 'Parse Document',
      inputs: [{ file: 'doc.pdf', source: 'user_upload', sourceLabel: 'user upload' }],
      outputs: [{ file: 'result.json' }],
      skills: [{ name: 'my-skill', path: 'skills/my-skill/' }],
      budget: { maxTurns: 25, maxBudgetUsd: 3.0 },
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('# Phase: Parse Document');
    expect(md).toContain('You are executing one phase of the "Test Flow" workflow.');
    expect(md).toContain('## Your Task');
    expect(md).toContain('## Input Files');
    expect(md).toContain('input/doc.pdf (user upload)');
    expect(md).toContain('## Output Files (you MUST produce these)');
    expect(md).toContain('output/result.json');
    expect(md).toContain('## Skills Available');
    expect(md).toContain('my-skill (in skills/my-skill/)');
    expect(md).toContain('## Budget');
    expect(md).toContain('Max turns: 25');
    expect(md).toContain('$3.00');
    expect(md).toContain('## Rules');
    expect(md).not.toContain('## Interrupt Protocol');
  });

  it('generates child markdown with Subagent header', () => {
    const ir = makeAgentIR({
      isChild: true,
      name: 'Researcher A',
      budget: { maxTurns: 30, maxBudgetUsd: 4 },
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('# Subagent: Researcher A');
    expect(md).not.toContain('You are executing one phase of');
  });

  it('omits source attribution in child input files', () => {
    const ir = makeAgentIR({
      isChild: true,
      inputs: [{ file: 'data.json', source: 'producer', sourceLabel: 'from producer' }],
      budget: { maxTurns: 30, maxBudgetUsd: 4 },
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('- input/data.json');
    expect(md).not.toContain('(from producer)');
  });

  it('generates checkpoint markdown', () => {
    const ir: CheckpointIR = {
      kind: 'checkpoint',
      nodeId: 'review',
      name: 'Expert Review',
      instructions: 'Review the analysis.',
      filesToPresent: [{ file: 'analysis.json', source: 'research', sourceLabel: 'from research' }],
      expectedInputs: [{ file: 'decisions.json' }],
      presentation: { title: 'Analysis Complete', sections: ['findings', 'recommendations'] },
    };
    const md = generateMarkdown(ir);

    expect(md).toContain('# Checkpoint: Expert Review');
    expect(md).toContain('execution pauses here for human input');
    expect(md).toContain('## Files to Present');
    expect(md).toContain('analysis.json (from research)');
    expect(md).toContain('## Expected User Input');
    expect(md).toContain('decisions.json');
    expect(md).toContain('**Title:** Analysis Complete');
    expect(md).toContain('findings, recommendations');
  });

  it('includes interrupt protocol when enabled', () => {
    const ir = makeAgentIR({ interrupt: { enabled: true } });
    const md = generateMarkdown(ir);

    expect(md).toContain('## Interrupt Protocol');
    expect(md).toContain('__INTERRUPT__');
    expect(md).toContain('__ANSWER__');
  });

  it('omits budget section for child without budget', () => {
    const ir = makeAgentIR({ isChild: true, budget: undefined });
    const md = generateMarkdown(ir);

    expect(md).not.toContain('## Budget');
  });

  it('includes budget section for child with explicit budget', () => {
    const ir = makeAgentIR({
      isChild: true,
      budget: { maxTurns: 30, maxBudgetUsd: 4 },
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('## Budget');
    expect(md).toContain('Max turns: 30');
    expect(md).toContain('$4.00');
  });

  it('includes subagent reference table with progress markers', () => {
    const ir = makeAgentIR({
      children: [
        { index: 1, id: 'child_a', name: 'Researcher A', promptFile: 'prompts/child_a.md', outputs: ['a.json'], wave: 0 },
        { index: 2, id: 'child_b', name: 'Researcher B', promptFile: 'prompts/child_b.md', outputs: ['b.json'], wave: 0 },
      ],
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('## Subagents — Launch All 2 Concurrently');
    expect(md).toContain('| 1 | Researcher A | child_a | prompts/child_a.md |');
    expect(md).toContain('| 2 | Researcher B | child_b | prompts/child_b.md |');
    expect(md).toContain('__CHILD_START__child_a.json');
    expect(md).toContain('__CHILD_DONE__child_a.json');
    expect(md).toContain('__CHILD_START__child_b.json');
    expect(md).toContain('__CHILD_DONE__child_b.json');
  });

  it('generates wave-structured prompt for multi-wave children', () => {
    const ir = makeAgentIR({
      children: [
        { index: 1, id: 'analyzer', name: 'Analyzer', promptFile: 'prompts/analyzer.md', outputs: ['analysis.json'], wave: 0 },
        { index: 2, id: 'validator', name: 'Validator', promptFile: 'prompts/validator.md', outputs: ['valid.json'], wave: 0 },
        { index: 3, id: 'synthesizer', name: 'Synthesizer', promptFile: 'prompts/synthesizer.md', outputs: ['synthesis.json'], wave: 1 },
      ],
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('## Subagents — 2 Waves');
    expect(md).toContain('### Wave 1 — Launch Concurrently');
    expect(md).toContain('### Wave 2 — Launch After Wave 1 Completes');
    expect(md).toContain('Wait for ALL Wave 1 subagents to complete before proceeding to Wave 2.');
    expect(md).toContain('| 1 | Analyzer | analyzer |');
    expect(md).toContain('| 2 | Validator | validator |');
    expect(md).toContain('| 3 | Synthesizer | synthesizer |');
    expect(md).toContain('IMPORTANT:** Wait for each wave to fully complete');
  });
});
