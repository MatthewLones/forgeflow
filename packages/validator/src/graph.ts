import type { FlowEdge } from '@forgeflow/types';

export interface TopologicalSortResult {
  sorted: string[];
  hasCycle: boolean;
  cycleNodes: string[];
}

/**
 * Topological sort using Kahn's algorithm (BFS).
 * Returns sorted order and detects cycles.
 */
export function topologicalSort(nodeIds: string[], edges: FlowEdge[]): TopologicalSortResult {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (adjacency.has(edge.from) && inDegree.has(edge.to)) {
      adjacency.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, inDegree.get(edge.to)! + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  const hasCycle = sorted.length !== nodeIds.length;
  const cycleNodes = hasCycle ? nodeIds.filter((id) => !sorted.includes(id)) : [];

  return { sorted, hasCycle, cycleNodes };
}

/**
 * Build adjacency map from edges for quick lookup.
 */
export function buildAdjacency(edges: FlowEdge[]): {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
} {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from)!.push(edge.to);

    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to)!.push(edge.from);
  }

  return { outgoing, incoming };
}
