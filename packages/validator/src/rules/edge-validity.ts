import type { ValidationRule, FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

export const edgeValidityRule: ValidationRule = {
  descriptor: {
    id: 'structural/edge-validity',
    name: 'Edge Validity',
    description: 'Edges must reference existing top-level node IDs',
    category: 'structural',
    dependencies: [],
    defaultSeverity: 'error',
    enabledByDefault: true,
  },
  check(graph: FlowGraph): FlowDiagnostic[] {
    const diagnostics: FlowDiagnostic[] = [];
    const topLevelIds = new Set(graph.flow.nodes.map((n) => n.id));

    for (let i = 0; i < graph.flow.edges.length; i++) {
      const edge = graph.flow.edges[i];
      if (!topLevelIds.has(edge.from)) {
        diagnostics.push(
          createDiagnostic(
            'INVALID_EDGE_REF',
            'error',
            `Edge[${i}] "from" references node "${edge.from}" which does not exist as a top-level node.`,
            { edgeIndex: i },
            'Edges can only connect top-level nodes.',
          ),
        );
      }
      if (!topLevelIds.has(edge.to)) {
        diagnostics.push(
          createDiagnostic(
            'INVALID_EDGE_REF',
            'error',
            `Edge[${i}] "to" references node "${edge.to}" which does not exist as a top-level node.`,
            { edgeIndex: i },
            'Edges can only connect top-level nodes.',
          ),
        );
      }
    }

    return diagnostics;
  },
};
