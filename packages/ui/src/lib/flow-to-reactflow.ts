import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type { FlowDefinition, FlowNode, FlowEdge } from '@forgeflow/types';
import type { FlowNodeData } from '../types/canvas';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 80;

/**
 * Auto-layout nodes using dagre when no saved positions exist.
 */
export function autoLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 100, nodesep: 60 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    const pos = g.node(node.id);
    positions[node.id] = {
      x: pos.x - NODE_WIDTH / 2,
      y: pos.y - NODE_HEIGHT / 2,
    };
  }
  return positions;
}

/**
 * Horizontal layout for child nodes (no edges, parallel execution).
 * Only assigns positions for nodes that don't already have saved positions.
 */
export function childrenLayout(
  children: FlowNode[],
  savedPositions: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const gap = NODE_WIDTH + 80;
  children.forEach((child, i) => {
    positions[child.id] = savedPositions[child.id] ?? { x: i * gap, y: 0 };
  });
  return positions;
}

/**
 * Convert FlowDefinition nodes to React Flow nodes.
 */
export function flowNodesToReactFlow(
  nodes: FlowNode[],
  positions: Record<string, { x: number; y: number }>,
): Node[] {
  return nodes.map((node, i) => ({
    id: node.id,
    type: node.type,
    position: positions[node.id] ?? { x: 300 * i, y: 100 },
    data: { node } satisfies FlowNodeData,
  }));
}

/**
 * Convert FlowDefinition edges to React Flow edges.
 */
export function flowEdgesToReactFlow(edges: FlowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'flow',
    data: { auto: edge.auto ?? false },
  }));
}

/**
 * Convert an entire FlowDefinition to React Flow nodes + edges,
 * with auto-layout if no saved positions are provided.
 */
export function flowToReactFlow(
  flow: FlowDefinition,
  savedPositions?: Record<string, { x: number; y: number }>,
): { nodes: Node[]; edges: Edge[] } {
  const positions = savedPositions ?? autoLayout(flow.nodes, flow.edges);
  return {
    nodes: flowNodesToReactFlow(flow.nodes, positions),
    edges: flowEdgesToReactFlow(flow.edges),
  };
}
