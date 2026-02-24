import type { FlowDefinition, FlowNode, FlowDiagnostic } from '@flowforge/types';
import { createDiagnostic } from '../diagnostics.js';

export function checkInterrupts(flow: FlowDefinition): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];

  function checkNode(node: FlowNode, depth: number, parentNode?: FlowNode) {
    if (!node.config.interrupts || node.config.interrupts.length === 0) {
      // Check children
      for (const child of node.children) {
        checkNode(child, depth + 1, node);
      }
      return;
    }

    // Checkpoint nodes should not have interrupt configs
    if (node.type === 'checkpoint') {
      diagnostics.push(
        createDiagnostic(
          'CHECKPOINT_HAS_INTERRUPTS',
          'error',
          `Checkpoint node "${node.id}" has interrupt configs. Checkpoints are themselves a form of human-in-the-loop and should not declare interrupts.`,
          { nodeId: node.id, field: 'config.interrupts' },
          'Remove the interrupts config from this checkpoint node.',
        ),
      );
    }

    // Child node interrupt warnings — any nested node with interrupts should have parent awareness
    if (depth >= 1 && parentNode) {
      const parentMentionsInterrupts =
        parentNode.instructions.toLowerCase().includes('interrupt') ||
        parentNode.instructions.toLowerCase().includes('pause') ||
        parentNode.instructions.toLowerCase().includes('ask') ||
        parentNode.instructions.toLowerCase().includes('approval');

      if (!parentMentionsInterrupts) {
        diagnostics.push(
          createDiagnostic(
            'DEEP_INTERRUPT_NO_PARENT_HANDLING',
            'warning',
            `Node "${node.id}" at depth ${depth} has interrupt configs, but parent "${parentNode.id}" does not mention interrupt handling in its instructions.`,
            { nodeId: node.id, field: 'config.interrupts' },
            `Add interrupt handling instructions to parent node "${parentNode.id}".`,
          ),
        );
      }
    }

    // Check children
    for (const child of node.children) {
      checkNode(child, depth + 1, node);
    }
  }

  for (const node of flow.nodes) {
    checkNode(node, 0);
  }

  return diagnostics;
}
