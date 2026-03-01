import type { PhaseIR, AgentPhaseIR, CheckpointIR, ChildReference } from '@forgeflow/types';

/**
 * Generate markdown from a PhaseIR.
 * Pure function: PhaseIR -> string.
 */
export function generateMarkdown(ir: PhaseIR): string {
  switch (ir.kind) {
    case 'checkpoint':
      return generateCheckpointMarkdown(ir);
    case 'agent':
      return generateAgentMarkdown(ir);
  }
}

function generateAgentMarkdown(ir: AgentPhaseIR): string {
  const sections: string[] = [];

  // Header
  if (ir.isChild) {
    sections.push(`# Subagent: ${ir.name}`);
  } else {
    sections.push(`# Phase: ${ir.name}`);
    sections.push('');
    sections.push(`You are executing one phase of the "${ir.flowName}" workflow.`);
  }

  // Task
  sections.push('');
  sections.push('## Your Task');
  sections.push(ir.instructions);

  // Input Files
  if (ir.inputs.length > 0) {
    sections.push('');
    sections.push('## Input Files');
    for (const input of ir.inputs) {
      if (ir.isChild) {
        sections.push(`- input/${input.file}`);
      } else {
        sections.push(`- input/${input.file} (${input.sourceLabel})`);
      }
    }
  }

  // Output Files
  if (ir.outputs.length > 0) {
    sections.push('');
    sections.push('## Output Files (you MUST produce these)');
    for (const output of ir.outputs) {
      sections.push(`- output/${output.file}`);
    }
  }

  // Skills
  if (ir.skills.length > 0) {
    sections.push('');
    sections.push('## Skills Available');
    for (const skill of ir.skills) {
      sections.push(`- ${skill.name} (in ${skill.path})`);
    }
  }

  // Budget (top-level always; child only if budget is defined)
  if (ir.budget) {
    sections.push('');
    sections.push('## Budget');
    sections.push(`- Max turns: ${ir.budget.maxTurns}`);
    sections.push(`- Max cost: $${ir.budget.maxBudgetUsd.toFixed(2)}`);
  }

  // Rules
  sections.push('');
  sections.push('## Rules');
  for (const rule of ir.rules) {
    sections.push(`- ${rule}`);
  }

  // Subagents reference table
  if (ir.children.length > 0) {
    sections.push('');
    generateChildrenReferenceSection(sections, ir.children);
  }

  // Interrupt Protocol
  if (ir.interrupt.enabled) {
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

function generateChildrenReferenceSection(
  sections: string[],
  children: ChildReference[],
): void {
  sections.push(`## Subagents — Launch All ${children.length} Concurrently`);
  sections.push('');
  sections.push('Each subagent\'s full instructions are in a separate prompt file:');
  sections.push('');
  sections.push('| # | Name | ID | Prompt File |');
  sections.push('|---|------|----|-------------|');
  for (const child of children) {
    sections.push(`| ${child.index} | ${child.name} | ${child.id} | ${child.promptFile} |`);
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
    const outputs = child.outputs.map((o) => `"${o}"`).join(',');
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

function generateCheckpointMarkdown(ir: CheckpointIR): string {
  const sections: string[] = [];

  sections.push(`# Checkpoint: ${ir.name}`);
  sections.push('');
  sections.push('This is a checkpoint node — execution pauses here for human input.');
  sections.push('');
  sections.push('## Instructions');
  sections.push(ir.instructions);

  if (ir.filesToPresent.length > 0) {
    sections.push('');
    sections.push('## Files to Present');
    for (const entry of ir.filesToPresent) {
      sections.push(`- ${entry.file} (${entry.sourceLabel})`);
    }
  }

  if (ir.expectedInputs.length > 0) {
    sections.push('');
    sections.push('## Expected User Input');
    for (const entry of ir.expectedInputs) {
      sections.push(`- ${entry.file}`);
    }
  }

  if (ir.presentation) {
    sections.push('');
    sections.push('## Presentation');
    sections.push(`**Title:** ${ir.presentation.title}`);
    sections.push(`**Sections:** ${ir.presentation.sections.join(', ')}`);
  }

  return sections.join('\n');
}
