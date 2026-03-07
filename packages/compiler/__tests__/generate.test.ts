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
    expect(md).toContain('## Inputs');
    expect(md).toContain('input/doc.pdf (user upload)');
    expect(md).toContain('## Required Outputs');
    expect(md).toContain('output/result.json');
    expect(md).toContain('## Skills');
    expect(md).toContain('my-skill (in skills/my-skill/)');
    expect(md).toContain('## Budget');
    expect(md).toContain('Max turns: 25');
    expect(md).toContain('$3.00');
    // Rules are now in system prompt only, not in per-phase markdown
    expect(md).not.toContain('## Rules');
    expect(md).not.toContain('## Interrupts — MANDATORY');
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

    expect(md).toContain('## Interrupts — MANDATORY');
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

  it('includes subagent reference table with progress tracking template', () => {
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
    // Progress markers are now template-based
    expect(md).toContain('__CHILD_START__ID.json');
    expect(md).toContain('__CHILD_DONE__ID.json');
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

  it('renders artifact schema for inputs with format and fields', () => {
    const ir = makeAgentIR({
      inputs: [{
        file: 'company_profile',
        source: 'ingest_materials',
        sourceLabel: 'from ingest_materials',
        schema: {
          name: 'company_profile',
          format: 'json',
          description: 'Company overview: founders, product, traction',
          fields: [
            { key: 'company_name', type: 'string', description: 'Company legal name' },
            { key: 'sector', type: 'string', description: 'Industry sector' },
            { key: 'founded_year', type: 'number', description: 'Year founded' },
          ],
        },
      }],
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('Format: json — Company overview: founders, product, traction');
    expect(md).toContain('Fields: company_name (string), sector (string), founded_year (number)');
  });

  it('renders artifact schema for outputs with format only (no fields)', () => {
    const ir = makeAgentIR({
      outputs: [{
        file: 'investment_memo',
        schema: {
          name: 'investment_memo',
          format: 'markdown',
          description: 'Final investment recommendation',
        },
      }],
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('output/investment_memo');
    expect(md).toContain('Format: markdown — Final investment recommendation');
    expect(md).not.toContain('Fields:');
  });

  it('renders no schema detail when schema is undefined', () => {
    const ir = makeAgentIR({
      outputs: [{ file: 'result.json' }],
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('output/result.json');
    expect(md).not.toContain('Format:');
  });

  it('marks optional fields in schema', () => {
    const ir = makeAgentIR({
      inputs: [{
        file: 'data.json',
        source: 'user_upload',
        sourceLabel: 'user upload',
        schema: {
          name: 'data',
          format: 'json',
          description: 'Test data',
          fields: [
            { key: 'required_field', type: 'string', description: 'Required' },
            { key: 'optional_field', type: 'number', description: 'Optional', required: false },
          ],
        },
      }],
    });
    const md = generateMarkdown(ir);

    expect(md).toContain('required_field (string)');
    expect(md).toContain('optional_field (number?)');
  });

  it('renders schema in checkpoint filesToPresent', () => {
    const ir: CheckpointIR = {
      kind: 'checkpoint',
      nodeId: 'review',
      name: 'Review',
      instructions: 'Review.',
      filesToPresent: [{
        file: 'risk_matrix',
        source: 'assessment',
        sourceLabel: 'from assessment',
        schema: {
          name: 'risk_matrix',
          format: 'json',
          description: 'Risk scores',
          fields: [
            { key: 'financial_risk', type: 'number', description: 'Risk 1-5' },
          ],
        },
      }],
      expectedInputs: [],
    };
    const md = generateMarkdown(ir);

    expect(md).toContain('Format: json — Risk scores');
    expect(md).toContain('Fields: financial_risk (number)');
  });
});
