import type { FlowDefinition, FlowNode, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

/**
 * Build a set of (parentId, childId) relationships for the entire flow tree.
 */
function buildParentChildPairs(nodes: FlowNode[]): Set<string> {
  const pairs = new Set<string>();
  function walk(node: FlowNode) {
    for (const child of node.children) {
      pairs.add(`${node.id}:${child.id}`);
      walk(child);
    }
  }
  for (const node of nodes) walk(node);
  return pairs;
}

/**
 * Collect all output file declarations across all nodes (including children at all depths).
 */
function collectAllOutputs(nodes: FlowNode[]): Array<{ file: string; nodeId: string }> {
  const result: Array<{ file: string; nodeId: string }> = [];
  for (const node of nodes) {
    for (const file of node.config.outputs) {
      result.push({ file, nodeId: node.id });
    }
    if (node.children.length > 0) {
      result.push(...collectAllOutputs(node.children));
    }
  }
  return result;
}

export function checkOutputUniqueness(flow: FlowDefinition): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const allOutputs = collectAllOutputs(flow.nodes);
  const parentChildPairs = buildParentChildPairs(flow.nodes);

  // Group by file name
  const fileToNodes = new Map<string, string[]>();
  for (const { file, nodeId } of allOutputs) {
    if (!fileToNodes.has(file)) fileToNodes.set(file, []);
    fileToNodes.get(file)!.push(nodeId);
  }

  for (const [file, nodeIds] of fileToNodes) {
    const unique = [...new Set(nodeIds)];
    if (unique.length <= 1) continue;

    // Allow parent + child to share an output (parent declares aggregated outputs,
    // child writes its portion). Only flag if there are unrelated nodes sharing.
    const isAllParentChild = unique.length === 2 && (
      parentChildPairs.has(`${unique[0]}:${unique[1]}`) ||
      parentChildPairs.has(`${unique[1]}:${unique[0]}`)
    );
    if (isAllParentChild) continue;

    // For >2 nodes, check if all pairs are parent-child
    if (unique.length > 2) {
      // Check if one node is the parent of all others
      const isOneParentOfRest = unique.some((candidate) =>
        unique.every(
          (other) => other === candidate || parentChildPairs.has(`${candidate}:${other}`),
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
