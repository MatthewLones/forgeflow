import type { FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

export function checkOutputUniqueness(graph: FlowGraph): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];

  // Collect all output file declarations across all nodes
  const fileToNodes = new Map<string, string[]>();
  for (const [nodeId, sym] of graph.symbols) {
    for (const file of sym.declaredOutputs) {
      if (!fileToNodes.has(file)) fileToNodes.set(file, []);
      fileToNodes.get(file)!.push(nodeId);
    }
  }

  for (const [file, nodeIds] of fileToNodes) {
    const unique = [...new Set(nodeIds)];
    if (unique.length <= 1) continue;

    // Allow parent + child to share an output (parent declares aggregated outputs,
    // child writes its portion). Only flag if there are unrelated nodes sharing.
    const isAllParentChild = unique.length === 2 && (
      isAncestor(graph, unique[0], unique[1]) ||
      isAncestor(graph, unique[1], unique[0])
    );
    if (isAllParentChild) continue;

    // For >2 nodes, check if one node is the ancestor of all others
    if (unique.length > 2) {
      const isOneParentOfRest = unique.some((candidate) =>
        unique.every(
          (other) => other === candidate || isAncestor(graph, candidate, other),
        ),
      );
      if (isOneParentOfRest) continue;
    }

    diagnostics.push(
      createDiagnostic(
        'DUPLICATE_OUTPUT',
        'error',
        `Output file "${file}" is declared by multiple unrelated nodes: ${unique.map((n) => `"${n}"`).join(', ')}.`,
        { field: 'config.outputs' },
        'Each output file must be unique across the entire flow (parent-child sharing is allowed).',
        unique,
      ),
    );
  }

  return diagnostics;
}

/** Check if candidateParent is an ancestor of candidateChild using FlowGraph symbols */
function isAncestor(graph: FlowGraph, candidateParent: string, candidateChild: string): boolean {
  const sym = graph.symbols.get(candidateParent);
  return sym ? sym.descendantIds.includes(candidateChild) : false;
}
