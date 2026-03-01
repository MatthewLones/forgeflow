import type { FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

export function checkInterrupts(graph: FlowGraph): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];

  for (const [nodeId, sym] of graph.symbols) {
    const node = sym.node;

    if (!node.config.interrupts || node.config.interrupts.length === 0) {
      continue;
    }

    // Checkpoint nodes should not have interrupt configs
    if (node.type === 'checkpoint') {
      diagnostics.push(
        createDiagnostic(
          'CHECKPOINT_HAS_INTERRUPTS',
          'error',
          `Checkpoint node "${nodeId}" has interrupt configs. Checkpoints are themselves a form of human-in-the-loop and should not declare interrupts.`,
          { nodeId, field: 'config.interrupts' },
          'Remove the interrupts config from this checkpoint node.',
        ),
      );
    }

    // Child node interrupt warnings — any nested node with interrupts should have parent awareness
    if (sym.depth >= 1 && sym.parentId) {
      const parentSym = graph.symbols.get(sym.parentId);
      if (parentSym) {
        const parentInstructions = parentSym.node.instructions.toLowerCase();
        const parentMentionsInterrupts =
          parentInstructions.includes('interrupt') ||
          parentInstructions.includes('pause') ||
          parentInstructions.includes('ask') ||
          parentInstructions.includes('approval');

        if (!parentMentionsInterrupts) {
          diagnostics.push(
            createDiagnostic(
              'DEEP_INTERRUPT_NO_PARENT_HANDLING',
              'warning',
              `Node "${nodeId}" at depth ${sym.depth} has interrupt configs, but parent "${sym.parentId}" does not mention interrupt handling in its instructions.`,
              { nodeId, field: 'config.interrupts' },
              `Add interrupt handling instructions to parent node "${sym.parentId}".`,
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}
