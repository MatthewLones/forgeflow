import type { ValidationRule, FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

const NODE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export const nodeIdFormatRule: ValidationRule = {
  descriptor: {
    id: 'structural/node-id-format',
    name: 'Node ID Format',
    description: 'Node IDs must be snake_case (lowercase letters, digits, underscores)',
    category: 'structural',
    dependencies: [],
    defaultSeverity: 'error',
    enabledByDefault: true,
  },
  check(graph: FlowGraph): FlowDiagnostic[] {
    const diagnostics: FlowDiagnostic[] = [];

    for (const [nodeId] of graph.symbols) {
      if (!NODE_ID_PATTERN.test(nodeId)) {
        diagnostics.push(
          createDiagnostic(
            'INVALID_NODE_ID',
            'error',
            `Node ID "${nodeId}" is invalid. Must match [a-z][a-z0-9_]* (snake_case).`,
            { nodeId },
            'Use lowercase letters, digits, and underscores. Must start with a letter.',
          ),
        );
      }
    }

    return diagnostics;
  },
};
