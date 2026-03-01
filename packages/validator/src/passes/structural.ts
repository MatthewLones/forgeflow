import type { FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

const NODE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export function checkStructural(graph: FlowGraph): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const flow = graph.flow;
  const topLevelIds = new Set(flow.nodes.map((n) => n.id));

  // 1. Node ID format
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

  // 2. Node ID uniqueness — FlowGraph enforces unique IDs in the Map, but the same ID
  // appearing at different depths would overwrite. Detect by walking the original flow.
  const idCounts = new Map<string, string[]>();
  function countIds(nodes: typeof flow.nodes) {
    for (const node of nodes) {
      if (!idCounts.has(node.id)) idCounts.set(node.id, []);
      idCounts.get(node.id)!.push(node.name);
      if (node.children.length > 0) countIds(node.children);
    }
  }
  countIds(flow.nodes);

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

  // 4. DAG validation — no cycles (from FlowGraph)
  if (graph.hasCycle) {
    diagnostics.push(
      createDiagnostic(
        'CYCLE_DETECTED',
        'error',
        `Edges form a cycle involving nodes: ${graph.cycleNodes.map((n) => `"${n}"`).join(', ')}.`,
        {},
        'Remove or reorder edges to eliminate the cycle. Flows must be directed acyclic graphs (DAGs).',
        [...graph.cycleNodes],
      ),
    );
  }

  // 5. Connectivity — orphan/dead-end checks
  if (!graph.hasCycle && flow.nodes.length > 1) {
    const firstNode = graph.topoOrder[0];
    const lastNode = graph.topoOrder[graph.topoOrder.length - 1];

    for (const node of flow.nodes) {
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
  }

  // 6. Node type rules
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
  }

  return diagnostics;
}
