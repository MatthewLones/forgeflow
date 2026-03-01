import type { ValidationRule, FlowGraph, FlowDiagnostic, FlowNode } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

export const nodeIdUniqueRule: ValidationRule = {
  descriptor: {
    id: 'structural/node-id-unique',
    name: 'Node ID Uniqueness',
    description: 'Each node must have a unique ID across all nesting depths',
    category: 'structural',
    dependencies: [],
    defaultSeverity: 'error',
    enabledByDefault: true,
  },
  check(graph: FlowGraph): FlowDiagnostic[] {
    const diagnostics: FlowDiagnostic[] = [];

    // FlowGraph's Map deduplicates — walk the original flow to detect duplicates
    const idCounts = new Map<string, string[]>();
    function countIds(nodes: FlowNode[]) {
      for (const node of nodes) {
        if (!idCounts.has(node.id)) idCounts.set(node.id, []);
        idCounts.get(node.id)!.push(node.name);
        if (node.children.length > 0) countIds(node.children);
      }
    }
    countIds(graph.flow.nodes);

    for (const [id, names] of idCounts) {
      if (names.length > 1) {
        diagnostics.push(
          createDiagnostic(
            'DUPLICATE_NODE_ID',
            'error',
            `Node ID "${id}" is used ${names.length} times: ${names.map((n) => `"${n}"`).join(', ')}.`,
            { nodeId: id },
            'Each node must have a unique ID across all depths.',
          ),
        );
      }
    }

    return diagnostics;
  },
};
