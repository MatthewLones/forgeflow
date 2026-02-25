/**
 * Reactive hook that auto-creates/removes DAG edges based on artifact dependencies.
 * When node A outputs artifact X and node B inputs @X, an auto-edge A→B is created.
 * Auto-edges are distinguished from manual edges via the `auto` flag on FlowEdge.
 */

import { useEffect, useRef } from 'react';
import type { FlowNode, FlowEdge, ArtifactSchema } from '@forgeflow/types';
import { useFlow } from '../context/FlowContext';

/** Map artifact name → top-level node ID that produces it */
function buildProducerMap(nodes: FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();

  function walkOutputs(node: FlowNode, topLevelId: string) {
    for (const out of node.config.outputs ?? []) {
      const name = typeof out === 'string' ? out : (out as ArtifactSchema).name;
      if (name) map.set(name, topLevelId);
    }
    for (const child of node.children) {
      walkOutputs(child, topLevelId);
    }
  }

  for (const node of nodes) {
    walkOutputs(node, node.id);
  }

  return map;
}

/** Map artifact name → set of top-level node IDs that consume it */
function buildConsumerMap(nodes: FlowNode[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  function walkInputs(node: FlowNode, topLevelId: string) {
    for (const inp of node.config.inputs ?? []) {
      const name = typeof inp === 'string' ? inp : (inp as ArtifactSchema).name;
      if (name) {
        if (!map.has(name)) map.set(name, new Set());
        map.get(name)!.add(topLevelId);
      }
    }
    for (const child of node.children) {
      walkInputs(child, topLevelId);
    }
  }

  for (const node of nodes) {
    walkInputs(node, node.id);
  }

  return map;
}

/** Compute the set of auto-edges that should exist based on artifact dependencies */
function computeAutoEdges(nodes: FlowNode[]): FlowEdge[] {
  const producers = buildProducerMap(nodes);
  const consumers = buildConsumerMap(nodes);
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();

  for (const [artifactName, producerId] of producers) {
    const consumerIds = consumers.get(artifactName);
    if (!consumerIds) continue;

    for (const consumerId of consumerIds) {
      // Skip self-edges
      if (producerId === consumerId) continue;
      const key = `${producerId}->${consumerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: producerId, to: consumerId, auto: true });
    }
  }

  return edges;
}

/**
 * Watches flow nodes for artifact dependency changes and reconciles auto-edges.
 * Adds missing auto-edges and removes stale ones without touching manual edges.
 */
export function useAutoEdges() {
  const { state, addEdge, removeAutoEdge } = useFlow();
  const prevAutoKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const desired = computeAutoEdges(state.flow.nodes);
    const desiredKeys = new Set(desired.map((e) => `${e.from}->${e.to}`));

    // Existing edges (both manual and auto)
    const existingKeys = new Set(state.flow.edges.map((e) => `${e.from}->${e.to}`));

    // Add missing auto-edges (only if no edge of any kind exists between those nodes)
    for (const edge of desired) {
      const key = `${edge.from}->${edge.to}`;
      if (!existingKeys.has(key)) {
        addEdge(edge);
      }
    }

    // Remove stale auto-edges (were auto before, no longer desired)
    for (const key of prevAutoKeysRef.current) {
      if (!desiredKeys.has(key)) {
        const [from, to] = key.split('->');
        removeAutoEdge(from, to);
      }
    }

    prevAutoKeysRef.current = desiredKeys;
  }, [state.flow.nodes]); // eslint-disable-line react-hooks/exhaustive-deps
}
