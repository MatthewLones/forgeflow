import type { ValidationRule, FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

export const nodeTypeRulesRule: ValidationRule = {
  descriptor: {
    id: 'structural/node-type-rules',
    name: 'Node Type Rules',
    description: 'Node type constraints: children, presentation, and instructions',
    category: 'structural',
    dependencies: [],
    defaultSeverity: 'error',
    enabledByDefault: true,
  },
  check(graph: FlowGraph): FlowDiagnostic[] {
    const diagnostics: FlowDiagnostic[] = [];

    for (const [nodeId, sym] of graph.symbols) {
      const node = sym.node;

      // Only agent nodes may have children
      if (node.type !== 'agent' && node.children.length > 0) {
        diagnostics.push(
          createDiagnostic(
            'NON_AGENT_HAS_CHILDREN',
            'error',
            `${node.type} node "${nodeId}" has children. Only agent nodes may have children.`,
            { nodeId },
            `Change the node type to "agent" or remove the children.`,
          ),
        );
      }

      // Checkpoint nodes must have presentation
      if (node.type === 'checkpoint' && !node.config.presentation) {
        diagnostics.push(
          createDiagnostic(
            'CHECKPOINT_NO_PRESENTATION',
            'error',
            `Checkpoint node "${nodeId}" is missing a presentation config.`,
            { nodeId, field: 'config.presentation' },
            'Add a presentation object with title and sections.',
          ),
        );
      }

      // Agent and checkpoint nodes must have non-empty instructions
      if ((node.type === 'agent' || node.type === 'checkpoint') && !node.instructions.trim()) {
        diagnostics.push(
          createDiagnostic(
            'EMPTY_INSTRUCTIONS',
            'error',
            `${node.type} node "${nodeId}" has empty instructions.`,
            { nodeId, field: 'instructions' },
            'Provide instructions describing what this node should do.',
          ),
        );
      }

      // Checkpoint-specific warnings
      if (node.type === 'checkpoint') {
        // Checkpoints must expect at least one file from the user
        if (sym.declaredOutputs.length === 0) {
          diagnostics.push(
            createDiagnostic(
              'CHECKPOINT_NO_OUTPUTS',
              'warning',
              `Checkpoint "${nodeId}" has no expected outputs. It should expect at least one file from the user.`,
              { nodeId, field: 'config.outputs' },
              'Add outputs that the user must provide at this checkpoint.',
            ),
          );
        }

        // Checkpoints should not have interrupts (they ARE the human interaction)
        if (node.config.interrupts?.length) {
          diagnostics.push(
            createDiagnostic(
              'CHECKPOINT_HAS_INTERRUPTS',
              'warning',
              `Checkpoint "${nodeId}" has interrupt configs. Checkpoints are already human interaction points.`,
              { nodeId, field: 'config.interrupts' },
              'Remove interrupt configs from checkpoint nodes.',
            ),
          );
        }
      }
    }

    return diagnostics;
  },
};
