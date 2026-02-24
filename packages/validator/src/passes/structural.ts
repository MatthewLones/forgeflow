import type { FlowDefinition, FlowNode, FlowDiagnostic } from '@flowforge/types';
import { topologicalSort, buildAdjacency } from '../graph.js';
import { createDiagnostic } from '../diagnostics.js';

const NODE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Collect all node IDs at all depths (top-level + children recursively).
 */
function collectAllNodes(nodes: FlowNode[], depth = 0): Array<{ node: FlowNode; depth: number }> {
  const result: Array<{ node: FlowNode; depth: number }> = [];
  for (const node of nodes) {
    result.push({ node, depth });
    if (node.children.length > 0) {
      result.push(...collectAllNodes(node.children, depth + 1));
    }
  }
  return result;
}

export function checkStructural(flow: FlowDefinition): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const allNodes = collectAllNodes(flow.nodes);
  const topLevelIds = new Set(flow.nodes.map((n) => n.id));

  // 1. Node ID format
  for (const { node } of allNodes) {
    if (!NODE_ID_PATTERN.test(node.id)) {
      diagnostics.push(
        createDiagnostic(
          'INVALID_NODE_ID',
          'error',
          `Node ID "${node.id}" is invalid. Must match [a-z][a-z0-9_]* (snake_case).`,
          { nodeId: node.id },
          'Use lowercase letters, digits, and underscores. Must start with a letter.',
        ),
      );
    }
  }

  // 2. Node ID uniqueness
  const idCounts = new Map<string, string[]>();
  for (const { node } of allNodes) {
    if (!idCounts.has(node.id)) idCounts.set(node.id, []);
    idCounts.get(node.id)!.push(node.name);
  }
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

  // 3. Edge validity — from/to must reference top-level node IDs
  for (let i = 0; i < flow.edges.length; i++) {
    const edge = flow.edges[i];
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

  // 4. DAG validation — no cycles
  const { hasCycle, cycleNodes } = topologicalSort(
    flow.nodes.map((n) => n.id),
    flow.edges,
  );
  if (hasCycle) {
    diagnostics.push(
      createDiagnostic(
        'CYCLE_DETECTED',
        'error',
        `Edges form a cycle involving nodes: ${cycleNodes.map((n) => `"${n}"`).join(', ')}.`,
        {},
        'Remove or reorder edges to eliminate the cycle. Flows must be directed acyclic graphs (DAGs).',
        cycleNodes,
      ),
    );
  }

  // 5. Connectivity — orphan/dead-end checks
  if (!hasCycle && flow.nodes.length > 1) {
    const { outgoing, incoming } = buildAdjacency(flow.edges);
    const { sorted } = topologicalSort(
      flow.nodes.map((n) => n.id),
      flow.edges,
    );
    const firstNode = sorted[0];
    const lastNode = sorted[sorted.length - 1];

    for (const node of flow.nodes) {
      if (node.id !== firstNode && (!incoming.has(node.id) || incoming.get(node.id)!.length === 0)) {
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
      if (node.id !== lastNode && (!outgoing.has(node.id) || outgoing.get(node.id)!.length === 0)) {
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
  }

  // 6. Node type rules
  for (const { node } of allNodes) {
    // Only agent nodes may have children
    if (node.type !== 'agent' && node.children.length > 0) {
      diagnostics.push(
        createDiagnostic(
          'NON_AGENT_HAS_CHILDREN',
          'error',
          `${node.type} node "${node.id}" has children. Only agent nodes may have children.`,
          { nodeId: node.id },
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
          `Checkpoint node "${node.id}" is missing a presentation config.`,
          { nodeId: node.id, field: 'config.presentation' },
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
          `${node.type} node "${node.id}" has empty instructions.`,
          { nodeId: node.id, field: 'instructions' },
          'Provide instructions describing what this node should do.',
        ),
      );
    }
  }

  return diagnostics;
}
