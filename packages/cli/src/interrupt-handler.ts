import { createInterface } from 'node:readline';
import type { Interrupt, InterruptAnswer } from '@forgeflow/types';
import type { InterruptHandler } from '@forgeflow/engine';

/**
 * Create an interrupt handler that prompts the user via stdin.
 */
export function createCliInterruptHandler(): InterruptHandler {
  return async (interrupt: Interrupt): Promise<InterruptAnswer> => {
    console.log(`\n=== INTERRUPT: ${interrupt.title} ===`);
    console.log(`Type: ${interrupt.type}`);
    console.log(`Context: ${interrupt.context}`);

    switch (interrupt.type) {
      case 'approval':
        return handleApproval(interrupt);
      case 'qa':
        return handleQA(interrupt);
      case 'selection':
        return handleSelection(interrupt);
      case 'review':
        return handleReview(interrupt);
      case 'escalation':
        return handleEscalation(interrupt);
    }
  };
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function handleApproval(interrupt: Extract<Interrupt, { type: 'approval' }>): Promise<InterruptAnswer> {
  console.log(`\nProposal: ${interrupt.proposal}`);
  if (interrupt.evidence?.length) {
    console.log(`Evidence: ${interrupt.evidence.join(', ')}`);
  }
  console.log(`Options: ${interrupt.options.join(', ')}`);

  const answer = await prompt('Decision [approve/reject/modify]: ');
  const decision = (['approve', 'reject', 'modify'] as const).find(
    (d) => d.startsWith(answer.toLowerCase()),
  ) ?? 'approve';

  let modifications: string | undefined;
  if (decision === 'modify') {
    modifications = await prompt('Modifications: ');
  }

  return { decision, modifications };
}

async function handleQA(interrupt: Extract<Interrupt, { type: 'qa' }>): Promise<InterruptAnswer> {
  const answers: Record<string, string | number | boolean> = {};

  for (const q of interrupt.questions) {
    console.log(`\n  ${q.label}`);
    if (q.context) console.log(`  Context: ${q.context}`);

    if (q.inputType === 'boolean') {
      const answer = await prompt(`  [y/n]${q.defaultValue !== undefined ? ` (default: ${q.defaultValue})` : ''}: `);
      answers[q.id] = answer.toLowerCase().startsWith('y');
    } else if (q.inputType === 'choice' && q.options) {
      q.options.forEach((opt, i) => console.log(`    ${i + 1}. ${opt}`));
      const answer = await prompt('  Choice: ');
      const idx = parseInt(answer) - 1;
      answers[q.id] = q.options[idx] ?? q.options[0];
    } else if (q.inputType === 'number') {
      const answer = await prompt(`  Value${q.defaultValue !== undefined ? ` (default: ${q.defaultValue})` : ''}: `);
      answers[q.id] = answer ? parseFloat(answer) : (q.defaultValue as number ?? 0);
    } else {
      const answer = await prompt(`  Answer${q.defaultValue !== undefined ? ` (default: ${q.defaultValue})` : ''}: `);
      answers[q.id] = answer || (q.defaultValue as string ?? '');
    }
  }

  return { answers };
}

async function handleSelection(interrupt: Extract<Interrupt, { type: 'selection' }>): Promise<InterruptAnswer> {
  console.log('\nOptions:');
  for (let i = 0; i < interrupt.items.length; i++) {
    const item = interrupt.items[i];
    const rec = item.recommended ? ' (recommended)' : '';
    console.log(`  ${i + 1}. ${item.label}${rec}`);
    console.log(`     ${item.description}`);
  }

  const min = interrupt.minSelect ?? 1;
  const max = interrupt.maxSelect ?? interrupt.items.length;
  const answer = await prompt(`Select ${min}-${max} (comma-separated numbers): `);

  const indices = answer.split(',').map((s) => parseInt(s.trim()) - 1);
  const selected = indices
    .filter((i) => i >= 0 && i < interrupt.items.length)
    .map((i) => interrupt.items[i].id);

  return { selected };
}

async function handleReview(interrupt: Extract<Interrupt, { type: 'review' }>): Promise<InterruptAnswer> {
  console.log(`\nDraft file: ${interrupt.draftFile}`);
  console.log(`Format: ${interrupt.format}`);
  console.log(`Instructions: ${interrupt.instructions}`);

  const answer = await prompt('Accept? [y/n]: ');
  const accepted = answer.toLowerCase().startsWith('y');

  let editedContent: string | undefined;
  if (!accepted) {
    editedContent = await prompt('Enter edited content (or press enter to skip): ');
  }

  return { accepted, editedContent: editedContent || undefined };
}

async function handleEscalation(interrupt: Extract<Interrupt, { type: 'escalation' }>): Promise<InterruptAnswer> {
  console.log(`\nSeverity: ${interrupt.severity}`);
  console.log(`Finding: ${interrupt.finding}`);
  console.log(`Evidence: ${interrupt.evidence.join(', ')}`);
  console.log(`Suggested action: ${interrupt.suggestedAction}`);
  if (interrupt.routeTo) console.log(`Route to: ${interrupt.routeTo}`);

  const answer = await prompt('Action [acknowledge/override/route]: ');
  const action = (['acknowledge', 'override', 'route'] as const).find(
    (a) => a.startsWith(answer.toLowerCase()),
  ) ?? 'acknowledge';

  let notes: string | undefined;
  let routedTo: string | undefined;

  if (action === 'route') {
    routedTo = await prompt('Route to: ');
  }
  notes = await prompt('Notes (optional): ');

  return { action, notes: notes || undefined, routedTo };
}
