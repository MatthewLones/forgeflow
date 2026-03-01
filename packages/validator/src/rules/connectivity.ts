import type { ValidationRule, FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

export const connectivityRule: ValidationRule = {
  descriptor: {
    id: 'structural/connectivity',
    name: 'Node Connectivity',
    description: 'All non-terminal nodes must have edges connecting them to the flow',
    category: 'structural',
    dependencies: ['structural/dag-acyclic'],
    defaultSeverity: 'error',
    enabledByDefault: true,
  },
  check(graph: FlowGraph): FlowDiagnostic[] {
    const diagnostics: FlowDiagnostic[] = [];

    if (graph.hasCycle || graph.flow.nodes.length <= 1) return diagnostics;

    const firstNode = graph.topoOrder[0];
    const lastNode = graph.topoOrder[graph.topoOrder.length - 1];

    for (const node of graph.flow.nodes) {
      const sym = graph.symbols.get(node.id)!;

      if (node.id !== firstNode && sym.predecessors.length === 0) {
        diagnostics.push(
          createDiagnostic(
            'ORPHAN_NODE',
            'error',
            `Node "${node.id}" has no incoming edges but is not the first node in the flow.`,
            { nodeId: node.id },
            'Add an edge from a prior node, or reorder the flow.',
          ),
        );
      }
      if (node.id !== lastNode && sym.successors.length === 0) {
        diagnostics.push(
          createDiagnostic(
            'DEAD_END_NODE',
            'error',
            `Node "${node.id}" has no outgoing edges but is not the last node in the flow.`,
            { nodeId: node.id },
            'Add an edge to a subsequent node, or remove this node.',
          ),
        );
      }
    }

    return diagnostics;
  },
};
