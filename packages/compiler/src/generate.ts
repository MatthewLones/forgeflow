import type {
  PhaseIR,
  AgentPhaseIR,
  CheckpointIR,
  ChildReference,
  ArtifactSchema,
} from '@forgeflow/types';

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

  // Inputs
  if (ir.inputs.length > 0) {
    sections.push('');
    sections.push('## Inputs');
    for (const input of ir.inputs) {
      if (ir.isChild) {
        sections.push(`- input/${input.file}`);
      } else {
        sections.push(`- input/${input.file} (${input.sourceLabel})`);
      }
      if (input.schema) {
        appendSchemaDetail(sections, input.schema);
      }
    }
  }

  // Required Outputs
  if (ir.outputs.length > 0) {
    sections.push('');
    sections.push('## Required Outputs');
    for (const output of ir.outputs) {
      sections.push(`- output/${output.file}`);
      if (output.schema) {
        appendSchemaDetail(sections, output.schema);
      }
    }
  }

  // Skills
  if (ir.skills.length > 0) {
    sections.push('');
    sections.push('## Skills — REQUIRED');
    sections.push('You MUST read each skill\'s SKILL.md and apply its methodology to your work.');
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

  // Subagents reference
  if (ir.children.length > 0) {
    sections.push('');
    generateChildrenReferenceSection(sections, ir.children);
  }

  // Interrupt protocol note (details are in the system prompt)
  if (ir.interrupt.enabled) {
    sections.push('');
    sections.push('## Interrupts — MANDATORY');
    sections.push('');
    sections.push('This phase REQUIRES interrupts. You MUST use the interrupt protocol described in the system prompt to pause for human input when needed. Skipping any required interrupt means the phase is INCOMPLETE. Write interrupt requests to `output/__INTERRUPT__{id}.json` and poll for answers at `output/__ANSWER__{id}.json`.');
  }

  return sections.join('\n');
}

/**
 * Append compact schema detail lines under a file entry.
 * Format + description on one line, fields as compact list.
 */
function appendSchemaDetail(sections: string[], schema: ArtifactSchema): void {
  const parts: string[] = [];
  if (schema.format) parts.push(`Format: ${schema.format}`);
  if (schema.description) parts.push(schema.description);
  if (parts.length > 0) {
    sections.push(`  ${parts.join(' — ')}`);
  }
  if (schema.fields && schema.fields.length > 0) {
    const fieldDescriptions = schema.fields.map((f) => {
      const opt = f.required === false ? '?' : '';
      return `${f.key} (${f.type}${opt})`;
    });
    sections.push(`  Fields: ${fieldDescriptions.join(', ')}`);
  }
}

function generateChildrenReferenceSection(
  sections: string[],
  children: ChildReference[],
): void {
  // Group children by wave
  const maxWave = Math.max(...children.map((c) => c.wave));
  const isSingleWave = maxWave === 0;

  if (isSingleWave) {
    sections.push(`## Subagents — Launch All ${children.length} Concurrently`);
  } else {
    sections.push(`## Subagents — ${maxWave + 1} Waves`);
  }

  sections.push('');
  sections.push('Each subagent\'s full instructions are in a separate prompt file.');

  if (isSingleWave) {
    sections.push('');
    sections.push('| # | Name | ID | Prompt File |');
    sections.push('|---|------|----|-------------|');
    for (const child of children) {
      sections.push(`| ${child.index} | ${child.name} | ${child.id} | ${child.promptFile} |`);
    }
  } else {
    for (let wave = 0; wave <= maxWave; wave++) {
      const waveChildren = children.filter((c) => c.wave === wave);
      if (waveChildren.length === 0) continue;

      sections.push('');
      if (wave === 0) {
        sections.push(`### Wave ${wave + 1} — Launch Concurrently`);
      } else {
        sections.push(`### Wave ${wave + 1} — Launch After Wave ${wave} Completes`);
      }
      sections.push('');
      sections.push('| # | Name | ID | Prompt File |');
      sections.push('|---|------|----|-------------|');
      for (const child of waveChildren) {
        sections.push(`| ${child.index} | ${child.name} | ${child.id} | ${child.promptFile} |`);
      }

      if (wave < maxWave) {
        sections.push('');
        sections.push(`**Wait for ALL Wave ${wave + 1} subagents to complete before proceeding to Wave ${wave + 2}.**`);
      }
    }
  }

  // Compact progress tracking — template instead of per-child echo commands
  sections.push('');
  sections.push('**Progress tracking:** For each subagent, write marker files:');
  sections.push('- Before launch: `echo \'{"childId":"ID","childName":"NAME"}\' > output/__CHILD_START__ID.json`');
  sections.push('- After completion: `echo \'{"childId":"ID","childName":"NAME","outputFiles":[...]}\' > output/__CHILD_DONE__ID.json`');

  sections.push('');
  if (isSingleWave) {
    sections.push(
      'Launch all subagents concurrently using the Task tool. Read each subagent\'s prompt file from the prompts/ directory and pass it as the task instructions.',
    );
  } else {
    sections.push(
      'Launch each wave\'s subagents concurrently using the Task tool. Read each subagent\'s prompt file from the prompts/ directory and pass it as the task instructions.',
    );
    sections.push('**IMPORTANT:** Wait for each wave to fully complete before launching the next wave.');
  }
  sections.push('**FAILURE TO LAUNCH ALL SUBAGENTS MEANS THIS PHASE IS INCOMPLETE AND FAILED.**');
  sections.push('');
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
      if (entry.schema) {
        appendSchemaDetail(sections, entry.schema);
      }
    }
  }

  if (ir.expectedInputs.length > 0) {
    sections.push('');
    sections.push('## Expected User Input');
    for (const entry of ir.expectedInputs) {
      sections.push(`- ${entry.file}`);
      if (entry.schema) {
        appendSchemaDetail(sections, entry.schema);
      }
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
