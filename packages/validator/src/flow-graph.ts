import type {
  FlowDefinition,
  FlowNode,
  FlowGraph,
  FlowSymbol,
  ArtifactEntry,
  ArtifactSchema,
} from '@forgeflow/types';
import { artifactName } from '@forgeflow/types';
import { topologicalSort, buildAdjacency } from './graph.js';

/**
 * Build a FlowGraph (symbol table) from a FlowDefinition.
 *
 * This is the single source of truth for all semantic analysis.
 * Built once, consumed by all validation rules and the compiler.
 *
 * Complexity: O(N + E) where N = total nodes (including children) and E = edges.
 */
export function buildFlowGraph(flow: FlowDefinition): FlowGraph {
  const symbols = new Map<string, FlowSymbol>();

  // --- Step 1: Walk all nodes recursively, building FlowSymbol entries ---
  function walkNodes(
    nodes: FlowNode[],
    depth: number,
    parentId: string | null,
  ): void {
    for (const node of nodes) {
      const childIds = node.children.map((c) => c.id);
      const descendantIds = collectDescendantIds(node);

      // Normalize inputs/outputs to string filenames
      const declaredInputs = node.config.inputs.map(artifactName);
      const declaredOutputs = node.config.outputs.map(artifactName);

      // Extract schemas from inline ArtifactSchema objects
      const outputSchemas = new Map<string, ArtifactSchema>();
      const inputSchemas = new Map<string, ArtifactSchema>();

      for (const ref of node.config.outputs) {
        if (typeof ref !== 'string') {
          outputSchemas.set(ref.name, ref);
        }
      }
      for (const ref of node.config.inputs) {
        if (typeof ref !== 'string') {
          inputSchemas.set(ref.name, ref);
        }
      }

      // Also pull schemas from flow.artifacts registry
      if (flow.artifacts) {
        for (const name of declaredOutputs) {
          if (!outputSchemas.has(name) && flow.artifacts[name]) {
            outputSchemas.set(name, flow.artifacts[name]);
          }
        }
        for (const name of declaredInputs) {
          if (!inputSchemas.has(name) && flow.artifacts[name]) {
            inputSchemas.set(name, flow.artifacts[name]);
          }
        }
      }

      const symbol: FlowSymbol = {
        node,
        depth,
        parentId,
        childIds,
        descendantIds,
        topoIndex: -1, // set later for top-level nodes
        predecessors: [],
        successors: [],
        interruptCapable: checkInterruptCapable(node),
        declaredOutputs,
        declaredInputs,
        outputSchemas,
        inputSchemas,
      };

      symbols.set(node.id, symbol);

      if (node.children.length > 0) {
        walkNodes(node.children, depth + 1, node.id);
      }
    }
  }

  walkNodes(flow.nodes, 0, null);

  // --- Step 2: Topological sort on top-level nodes ---
  const topoResult = topologicalSort(
    flow.nodes.map((n) => n.id),
    flow.edges,
  );

  // Set topoIndex on top-level symbols
  for (let i = 0; i < topoResult.sorted.length; i++) {
    const sym = symbols.get(topoResult.sorted[i]);
    if (sym) {
      (sym as { topoIndex: number }).topoIndex = i;
    }
  }

  // --- Step 3: Build adjacency maps ---
  const adj = buildAdjacency(flow.edges);

  // Set predecessors/successors on top-level symbols
  for (const node of flow.nodes) {
    const sym = symbols.get(node.id);
    if (!sym) continue;
    (sym as { predecessors: string[] }).predecessors = adj.incoming.get(node.id) ?? [];
    (sym as { successors: string[] }).successors = adj.outgoing.get(node.id) ?? [];
  }

  // --- Step 4: Build artifact registry ---
  const artifacts = new Map<string, ArtifactEntry>();

  // Register all outputs (producers)
  for (const [nodeId, sym] of symbols) {
    for (const filename of sym.declaredOutputs) {
      if (!artifacts.has(filename)) {
        artifacts.set(filename, {
          name: filename,
          producerId: nodeId,
          schema: sym.outputSchemas.get(filename),
          consumerIds: new Set(),
        });
      }
      // If a parent-child pair both declare the same output, keep the first (parent)
    }
  }

  // Register all inputs (consumers)
  for (const [nodeId, sym] of symbols) {
    for (const filename of sym.declaredInputs) {
      const entry = artifacts.get(filename);
      if (entry) {
        entry.consumerIds.add(nodeId);
      }
      // If no producer exists, the consumer still references it (caught by dependency check)
    }
  }

  // --- Step 5: Compute availableAtPhase ---
  const userUploadFiles = inferUserUploads(flow, symbols, artifacts);
  const availableAtPhase = new Map<string, ReadonlySet<string>>();

  const accumulated = new Set<string>(userUploadFiles);
  for (const nodeId of topoResult.sorted) {
    // Files available BEFORE this node executes
    availableAtPhase.set(nodeId, new Set(accumulated));

    // After this node completes, its outputs become available
    const sym = symbols.get(nodeId);
    if (sym) {
      for (const output of sym.declaredOutputs) {
        accumulated.add(output);
      }
    }
  }

  return {
    flow,
    symbols,
    topoOrder: topoResult.sorted,
    hasCycle: topoResult.hasCycle,
    cycleNodes: topoResult.cycleNodes,
    artifacts,
    userUploadFiles,
    availableAtPhase,
    outgoing: adj.outgoing,
    incoming: adj.incoming,
  };
}

/** Recursively collect all descendant IDs (does not include the node itself) */
function collectDescendantIds(node: FlowNode): string[] {
  const ids: string[] = [];
  function walk(children: FlowNode[]) {
    for (const child of children) {
      ids.push(child.id);
      walk(child.children);
    }
  }
  walk(node.children);
  return ids;
}

/** Check if a node or any of its descendants have interrupt configs */
function checkInterruptCapable(node: FlowNode): boolean {
  if (node.config.interrupts && node.config.interrupts.length > 0) return true;
  return node.children.some(checkInterruptCapable);
}

/**
 * Infer user upload files from entry nodes.
 * Entry nodes are those with no incoming edges.
 * Their inputs that aren't produced by any node are user uploads.
 */
function inferUserUploads(
  flow: FlowDefinition,
  symbols: Map<string, FlowSymbol>,
  artifacts: Map<string, ArtifactEntry>,
): string[] {
  const nodesWithIncoming = new Set(flow.edges.map((e) => e.to));
  const entryNodeIds = flow.nodes
    .filter((n) => !nodesWithIncoming.has(n.id))
    .map((n) => n.id);

  const uploads: string[] = [];
  for (const nodeId of entryNodeIds) {
    const sym = symbols.get(nodeId);
    if (!sym) continue;
    for (const input of sym.declaredInputs) {
      if (!artifacts.has(input) && !uploads.includes(input)) {
        uploads.push(input);
      }
    }
  }

  return uploads;
}
