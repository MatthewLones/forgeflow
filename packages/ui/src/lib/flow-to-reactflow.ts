import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';
import type { FlowDefinition, FlowNode, FlowEdge } from '@forgeflow/types';
import type { FlowNodeData } from '../types/canvas';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 80;

const elk = new ELK();

const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  // Spacing — compact but readable
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.nodeNode': '40',
  'elk.spacing.edgeNode': '25',
  'elk.spacing.edgeEdge': '15',
  'elk.layered.spacing.edgeNodeBetweenLayers': '25',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '15',
  // Crossing minimization
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  // Node placement — NETWORK_SIMPLEX minimizes edge lengths for compact layouts
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // Model order
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  // Edge routing
  'elk.edgeRouting': 'SPLINES',
  // Post-processing compaction to pull nodes closer
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.layered.compaction.connectedComponents': 'true',
  // Thoroughness (higher = better layout, slightly slower)
  'elk.layered.thoroughness': '10',
};

/**
 * Auto-layout nodes using ELK.js (async — uses WASM worker).
 * Produces significantly better layouts than dagre: proper edge
 * crossing minimization, layered node placement, and smart spacing.
 */
export async function autoLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
): Promise<Record<string, { x: number; y: number }>> {
  if (nodes.length === 0) return {};

  const nodeIds = new Set(nodes.map((n) => n.id));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    // Filter out edges referencing nonexistent nodes — ELK throws on these
    edges: edges
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      .map((edge, i) => ({
        id: `e${i}`,
        sources: [edge.from],
        targets: [edge.to],
      })),
  };

  try {
    const laid = await elk.layout(graph);
    const positions: Record<string, { x: number; y: number }> = {};
    for (const child of laid.children ?? []) {
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
    }
    return positions;
  } catch {
    // Fallback: simple grid layout if ELK fails for any reason
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((node, i) => {
      positions[node.id] = { x: (i % 4) * (NODE_WIDTH + 80), y: Math.floor(i / 4) * (NODE_HEIGHT + 60) };
    });
    return positions;
  }
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
export async function flowToReactFlow(
  flow: FlowDefinition,
  savedPositions?: Record<string, { x: number; y: number }>,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const positions = savedPositions ?? await autoLayout(flow.nodes, flow.edges);
  return {
    nodes: flowNodesToReactFlow(flow.nodes, positions),
    edges: flowEdgesToReactFlow(flow.edges),
  };
}
