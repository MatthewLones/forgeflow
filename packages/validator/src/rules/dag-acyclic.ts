import type { ValidationRule, FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

export const dagAcyclicRule: ValidationRule = {
  descriptor: {
    id: 'structural/dag-acyclic',
    name: 'DAG Acyclicity',
    description: 'Flow edges must not form cycles',
    category: 'structural',
    dependencies: [],
    defaultSeverity: 'error',
    enabledByDefault: true,
  },
  check(graph: FlowGraph): FlowDiagnostic[] {
    if (!graph.hasCycle) return [];

    return [
      createDiagnostic(
        'CYCLE_DETECTED',
        'error',
        `Edges form a cycle involving nodes: ${graph.cycleNodes.map((n) => `"${n}"`).join(', ')}.`,
        {},
        'Remove or reorder edges to eliminate the cycle. Flows must be directed acyclic graphs (DAGs).',
        [...graph.cycleNodes],
      ),
    ];
  },
};
