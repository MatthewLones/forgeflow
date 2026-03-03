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
    sections.push('When you need human input during execution, write an interrupt file and poll for the answer.');
    sections.push('');
    sections.push('### Steps');
    sections.push('1. Write your interrupt JSON to `output/__INTERRUPT__{your_id}.json` (use a unique ID like `int_001`)');
    sections.push('2. Poll `output/__ANSWER__{your_id}.json` every 5 seconds until it appears');
    sections.push('3. Read the answer and continue. Do NOT proceed with dependent work while polling.');
    sections.push('');
    sections.push('### Interrupt Schemas');
    sections.push('');
    sections.push('**approval** — Before destructive or expensive operations:');
    sections.push('```json');
    sections.push('{');
    sections.push('  "interrupt_id": "int_001",');
    sections.push('  "type": "approval",');
    sections.push('  "mode": "inline",');
    sections.push('  "title": "Approve action",');
    sections.push('  "context": "Why this needs approval",');
    sections.push('  "source": { "agentPath": [], "depth": 0 },');
    sections.push('  "proposal": "What you want to do",');
    sections.push('  "evidence": ["supporting fact 1", "supporting fact 2"],');
    sections.push('  "options": ["approve", "reject", "modify"]');
    sections.push('}');
    sections.push('```');
    sections.push('Answer: `{ "decision": "approve" | "reject" | "modify", "modifications": "..." }`');
    sections.push('');
    sections.push('**qa** — When you need answers to specific questions:');
    sections.push('```json');
    sections.push('{');
    sections.push('  "interrupt_id": "int_002",');
    sections.push('  "type": "qa",');
    sections.push('  "mode": "inline",');
    sections.push('  "title": "Questions for user",');
    sections.push('  "context": "Why you need this information",');
    sections.push('  "source": { "agentPath": [], "depth": 0 },');
    sections.push('  "questions": [');
    sections.push('    { "id": "q1", "label": "Your question?", "context": "Why this matters", "inputType": "text", "required": true },');
    sections.push('    { "id": "q2", "label": "Pick one", "context": "", "inputType": "choice", "options": ["A", "B", "C"], "required": true }');
    sections.push('  ]');
    sections.push('}');
    sections.push('```');
    sections.push('Answer: `{ "answers": { "q1": "user response", "q2": "B" } }`');
    sections.push('');
    sections.push('**selection** — When the user must choose from a list:');
    sections.push('```json');
    sections.push('{');
    sections.push('  "interrupt_id": "int_003",');
    sections.push('  "type": "selection",');
    sections.push('  "mode": "inline",');
    sections.push('  "title": "Select items",');
    sections.push('  "context": "What this selection is for",');
    sections.push('  "source": { "agentPath": [], "depth": 0 },');
    sections.push('  "items": [');
    sections.push('    { "id": "a", "label": "Option A", "description": "Details", "recommended": true },');
    sections.push('    { "id": "b", "label": "Option B", "description": "Details", "recommended": false }');
    sections.push('  ],');
    sections.push('  "minSelect": 1,');
    sections.push('  "maxSelect": null');
    sections.push('}');
    sections.push('```');
    sections.push('Answer: `{ "selected": ["a"] }`');
    sections.push('');
    sections.push('**review** — When the user should review a draft:');
    sections.push('```json');
    sections.push('{');
    sections.push('  "interrupt_id": "int_004",');
    sections.push('  "type": "review",');
    sections.push('  "mode": "inline",');
    sections.push('  "title": "Review draft",');
    sections.push('  "context": "What to look for",');
    sections.push('  "source": { "agentPath": [], "depth": 0 },');
    sections.push('  "draftFile": "output/draft_report.md",');
    sections.push('  "format": "markdown",');
    sections.push('  "instructions": "Check for accuracy and completeness"');
    sections.push('}');
    sections.push('```');
    sections.push('Answer: `{ "accepted": true }` or `{ "accepted": false, "editedContent": "..." }`');
  }

  return sections.join('\n');
}

function generateChildrenReferenceSection(
  sections: string[],
  children: ChildReference[],
): void {
  // Group children by wave
  const maxWave = Math.max(...children.map((c) => c.wave));
  const isSingleWave = maxWave === 0;

  if (isSingleWave) {
    // All children are independent — use original concurrent format
    sections.push(`## Subagents — Launch All ${children.length} Concurrently`);
  } else {
    sections.push(`## Subagents — ${maxWave + 1} Waves`);
  }

  sections.push('');
  sections.push('Each subagent\'s full instructions are in a separate prompt file.');

  if (isSingleWave) {
    // Single wave — flat table
    sections.push('');
    sections.push('| # | Name | ID | Prompt File |');
    sections.push('|---|------|----|-------------|');
    for (const child of children) {
      sections.push(`| ${child.index} | ${child.name} | ${child.id} | ${child.promptFile} |`);
    }
  } else {
    // Multiple waves — grouped tables
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

  // Progress tracking markers (same for all waves)
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
