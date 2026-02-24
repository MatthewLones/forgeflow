import type { FlowNode, FlowBudget } from '@forgeflow/types';

export interface CompileContext {
  /** Flow name for the prompt header */
  flowName: string;
  /** Global skills available to all nodes */
  globalSkills: string[];
  /** Map of input file → producing node ID or 'user_upload' */
  inputSources: Map<string, string>;
  /** Flow-level budget (fallback when node has no budget) */
  flowBudget: FlowBudget;
}

/**
 * System prompt appendix for all ForgeFlow phase agents.
 */
export const FORGEFLOW_PHASE_SYSTEM_PROMPT = `You are executing one phase of a ForgeFlow workflow inside an isolated sandbox.

RULES:
- Write all output files to the output/ directory
- Read input files from the input/ directory
- Skills are available in skills/ (loaded into the sandbox for this phase)
- For parallel subagents: use the Task tool to spawn concurrent agents
- Verify each output file exists before finishing
- Stay within the budget constraints listed in the prompt
- You are executing ONE phase — do not attempt to run subsequent phases
- If you have children (subagents), launch them all concurrently and wait for completion`;

/**
 * Compile a per-phase markdown prompt for a single FlowNode.
 * This is a pure function — no side effects, easy to test.
 */
export function compilePhasePrompt(node: FlowNode, context: CompileContext): string {
  if (node.type === 'checkpoint') {
    return compileCheckpointPrompt(node, context);
  }

  const sections: string[] = [];

  // Header
  sections.push(`# Phase: ${node.name}`);
  sections.push('');
  sections.push(`You are executing one phase of the "${context.flowName}" workflow.`);

  // Task
  sections.push('');
  sections.push('## Your Task');
  sections.push(node.instructions);

  // Input Files
  if (node.config.inputs.length > 0) {
    sections.push('');
    sections.push('## Input Files');
    for (const file of node.config.inputs) {
      const source = context.inputSources.get(file) ?? 'unknown';
      const sourceLabel = source === 'user_upload' ? 'user upload' : `from ${source}`;
      sections.push(`- input/${file} (${sourceLabel})`);
    }
  }

  // Output Files
  if (node.config.outputs.length > 0) {
    sections.push('');
    sections.push('## Output Files (you MUST produce these)');
    for (const file of node.config.outputs) {
      sections.push(`- output/${file}`);
    }
  }

  // Skills
  const allSkills = mergeSkills(context.globalSkills, node.config.skills);
  if (allSkills.length > 0) {
    sections.push('');
    sections.push('## Skills Available');
    for (const skill of allSkills) {
      sections.push(`- ${skill} (in skills/${skill}/)`);
    }
  }

  // Budget
  const budget = node.config.budget ?? {
    maxTurns: context.flowBudget.maxTurns,
    maxBudgetUsd: context.flowBudget.maxBudgetUsd,
  };
  sections.push('');
  sections.push('## Budget');
  sections.push(`- Max turns: ${budget.maxTurns}`);
  sections.push(`- Max cost: $${budget.maxBudgetUsd.toFixed(2)}`);

  // Rules
  sections.push('');
  sections.push('## Rules');
  sections.push('- Write all output files to the output/ directory');
  sections.push('- Read input files from the input/ directory');
  sections.push('- Verify each output file exists before finishing');
  sections.push('- Stay within budget constraints');

  // Subagents (children)
  if (node.children.length > 0) {
    sections.push('');
    sections.push(`## Subagents — Launch All ${node.children.length} Concurrently`);
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      sections.push('');
      sections.push(`### Subagent ${i + 1}: ${child.name}`);

      const childSkills = mergeSkills(context.globalSkills, child.config.skills);
      if (childSkills.length > 0) {
        sections.push(`**Skills:** ${childSkills.join(', ')}`);
      }
      if (child.config.inputs.length > 0) {
        sections.push(`**Inputs:** ${child.config.inputs.map((f) => `output/${f}`).join(', ')}`);
      }
      if (child.config.outputs.length > 0) {
        sections.push(`**Outputs:** ${child.config.outputs.map((f) => `output/${f}`).join(', ')}`);
      }
      if (child.config.budget) {
        sections.push(
          `**Budget:** ${child.config.budget.maxTurns} turns, $${child.config.budget.maxBudgetUsd.toFixed(2)}`,
        );
      }
      sections.push('');
      sections.push(child.instructions);
    }
    sections.push('');
    sections.push(
      'Launch all subagents concurrently using the Task tool. Each writes its own output file.',
    );
    sections.push('After all complete, verify all output files exist.');
  }

  // Interrupt Protocol (only if node or children have interrupts)
  if (hasInterrupts(node)) {
    sections.push('');
    sections.push('## Interrupt Protocol');
    sections.push('');
    sections.push('If you need human input during execution:');
    sections.push('');
    sections.push('1. Write your interrupt to output/__INTERRUPT__{your_id}.json');
    sections.push('   Follow the interrupt schema (type, title, context, questions/items/etc.)');
    sections.push('');
    sections.push('2. After writing the interrupt file, poll for the answer:');
    sections.push('   - Check for output/__ANSWER__{your_id}.json every 5 seconds');
    sections.push('   - When the file appears, read it and continue your work');
    sections.push('');
    sections.push('3. While polling, do NOT proceed with work that depends on the answer.');
    sections.push('   You MAY continue work on independent tasks if applicable.');
  }

  return sections.join('\n');
}

/**
 * Compile a checkpoint prompt — no agent run needed, just metadata.
 */
function compileCheckpointPrompt(node: FlowNode, context: CompileContext): string {
  const sections: string[] = [];

  sections.push(`# Checkpoint: ${node.name}`);
  sections.push('');
  sections.push('This is a checkpoint node — execution pauses here for human input.');
  sections.push('');
  sections.push('## Instructions');
  sections.push(node.instructions);

  if (node.config.inputs.length > 0) {
    sections.push('');
    sections.push('## Files to Present');
    for (const file of node.config.inputs) {
      const source = context.inputSources.get(file) ?? 'unknown';
      const sourceLabel = source === 'user_upload' ? 'user upload' : `from ${source}`;
      sections.push(`- ${file} (${sourceLabel})`);
    }
  }

  if (node.config.outputs.length > 0) {
    sections.push('');
    sections.push('## Expected User Input');
    for (const file of node.config.outputs) {
      sections.push(`- ${file}`);
    }
  }

  if (node.config.presentation) {
    sections.push('');
    sections.push('## Presentation');
    sections.push(`**Title:** ${node.config.presentation.title}`);
    sections.push(`**Sections:** ${node.config.presentation.sections.join(', ')}`);
  }

  return sections.join('\n');
}

/**
 * Merge global skills with node-specific skills, deduplicated.
 */
function mergeSkills(globalSkills: string[], nodeSkills: string[]): string[] {
  return [...new Set([...globalSkills, ...nodeSkills])];
}

/**
 * Check if a node or any of its children have interrupt configs.
 */
function hasInterrupts(node: FlowNode): boolean {
  if (node.config.interrupts && node.config.interrupts.length > 0) return true;
  return node.children.some(hasInterrupts);
}
