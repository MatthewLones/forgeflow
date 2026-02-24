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

  // Subagents (children) — reference to prompt files
  if (node.children.length > 0) {
    sections.push('');
    compileChildrenReferenceSection(sections, node.children);
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
 * Compile self-contained prompt files for all descendants of a node.
 * Returns Map<filename, content> where filename is `{childId}.md`.
 * Each child gets its own prompt file; if the child has children, its prompt
 * references their prompt files (not inline), keeping each file O(n) for
 * its direct children instead of O(n^depth).
 */
export function compileChildPromptFiles(
  node: FlowNode,
  context: CompileContext,
): Map<string, string> {
  const prompts = new Map<string, string>();
  collectChildPrompts(node.children, context, prompts);
  return prompts;
}

function collectChildPrompts(
  children: FlowNode[],
  context: CompileContext,
  prompts: Map<string, string>,
): void {
  for (const child of children) {
    prompts.set(`${child.id}.md`, compileChildPromptFile(child, context));
    if (child.children.length > 0) {
      collectChildPrompts(child.children, context, prompts);
    }
  }
}

/**
 * Generate a self-contained prompt file for a single child agent.
 */
function compileChildPromptFile(child: FlowNode, context: CompileContext): string {
  const sections: string[] = [];

  sections.push(`# Subagent: ${child.name}`);
  sections.push('');
  sections.push('## Your Task');
  sections.push(child.instructions);

  if (child.config.inputs.length > 0) {
    sections.push('');
    sections.push('## Input Files');
    for (const file of child.config.inputs) {
      sections.push(`- input/${file}`);
    }
  }

  if (child.config.outputs.length > 0) {
    sections.push('');
    sections.push('## Output Files (you MUST produce these)');
    for (const file of child.config.outputs) {
      sections.push(`- output/${file}`);
    }
  }

  const childSkills = mergeSkills(context.globalSkills, child.config.skills);
  if (childSkills.length > 0) {
    sections.push('');
    sections.push('## Skills Available');
    for (const skill of childSkills) {
      sections.push(`- ${skill} (in skills/${skill}/)`);
    }
  }

  if (child.config.budget) {
    sections.push('');
    sections.push('## Budget');
    sections.push(`- Max turns: ${child.config.budget.maxTurns}`);
    sections.push(`- Max cost: $${child.config.budget.maxBudgetUsd.toFixed(2)}`);
  }

  sections.push('');
  sections.push('## Rules');
  sections.push('- Write all output files to the output/ directory');
  sections.push('- Read input files from the input/ directory');
  sections.push('- Verify each output file exists before finishing');
  sections.push('- Stay within budget constraints');

  if (child.children.length > 0) {
    sections.push('');
    compileChildrenReferenceSection(sections, child.children);
  }

  if (hasInterrupts(child)) {
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
 * Compile a children reference section for the parent prompt.
 * Instead of inlining all child instructions, outputs a metadata table
 * pointing to separate prompt files in prompts/.
 */
function compileChildrenReferenceSection(
  sections: string[],
  children: FlowNode[],
): void {
  sections.push(`## Subagents — Launch All ${children.length} Concurrently`);
  sections.push('');
  sections.push('Each subagent\'s full instructions are in a separate prompt file:');
  sections.push('');
  sections.push('| # | Name | ID | Prompt File |');
  sections.push('|---|------|----|-------------|');
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    sections.push(`| ${i + 1} | ${child.name} | ${child.id} | prompts/${child.id}.md |`);
  }

  sections.push('');
  sections.push('**Progress tracking:** Before launching each subagent, write a marker file:');
  sections.push('```');
  for (const child of children) {
    sections.push(
      `echo '{"childId":"${child.id}","childName":"${child.name}","parentPath":[]}' > output/__CHILD_START__${child.id}.json`,
    );
  }
  sections.push('```');
  sections.push('After each subagent completes, write:');
  sections.push('```');
  for (const child of children) {
    const outputs = child.config.outputs.map((f) => `"${f}"`).join(',');
    sections.push(
      `echo '{"childId":"${child.id}","childName":"${child.name}","outputFiles":[${outputs}]}' > output/__CHILD_DONE__${child.id}.json`,
    );
  }
  sections.push('```');

  sections.push('');
  sections.push(
    'Launch all subagents concurrently using the Task tool. Read each subagent\'s prompt file from the prompts/ directory and pass it as the task instructions.',
  );
  sections.push('After all complete, verify all output files exist.');
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
