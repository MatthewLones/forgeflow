import type { FlowDefinition, FlowNode, ExecutionPlan, PhaseInfo } from '@flowforge/types';
import { topologicalSort, buildAdjacency } from './graph.js';

/**
 * Build a map of output file -> producing node ID.
 */
function buildOutputMap(nodes: FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    for (const file of node.config.outputs) {
      map.set(file, node.id);
    }
  }
  return map;
}

/**
 * Check if a node (or any of its children) has interrupt configs.
 */
function hasInterrupts(node: FlowNode): boolean {
  if (node.config.interrupts && node.config.interrupts.length > 0) return true;
  return node.children.some(hasInterrupts);
}

/**
 * Build PhaseInfo entries for child nodes.
 */
function buildChildPhases(children: FlowNode[], globalSkills: string[]): PhaseInfo[] {
  return children.map((child, index) => ({
    nodeId: child.id,
    order: index,
    inputsFrom: child.config.inputs.map((file) => ({
      file,
      source: 'parent' as const,
    })),
    skills: [...new Set([...globalSkills, ...child.config.skills])],
    estimatedCost: {
      turns: child.config.budget?.maxTurns ?? 0,
      usd: child.config.budget?.maxBudgetUsd ?? 0,
    },
    interruptCapable: hasInterrupts(child),
    children:
      child.children.length > 0 ? buildChildPhases(child.children, globalSkills) : undefined,
  }));
}

/**
 * Compute the critical path through the DAG (longest path by estimated cost in USD).
 */
function computeCriticalPath(flow: FlowDefinition): string[] {
  const { sorted } = topologicalSort(
    flow.nodes.map((n) => n.id),
    flow.edges,
  );
  const nodeMap = new Map(flow.nodes.map((n) => [n.id, n]));
  const { incoming } = buildAdjacency(flow.edges);

  // Dynamic programming: longest path to each node
  const longestCost = new Map<string, number>();
  const predecessor = new Map<string, string | null>();

  for (const nodeId of sorted) {
    const node = nodeMap.get(nodeId)!;
    const nodeCost = node.config.budget?.maxBudgetUsd ?? 0;

    let maxPriorCost = 0;
    let bestPred: string | null = null;

    const incomingNodes = incoming.get(nodeId) ?? [];
    for (const predId of incomingNodes) {
      const predCost = longestCost.get(predId) ?? 0;
      if (predCost > maxPriorCost) {
        maxPriorCost = predCost;
        bestPred = predId;
      }
    }

    longestCost.set(nodeId, maxPriorCost + nodeCost);
    predecessor.set(nodeId, bestPred);
  }

  // Find the endpoint with the highest cost
  let endNode = sorted[0];
  let maxCost = 0;
  for (const [nodeId, cost] of longestCost) {
    if (cost > maxCost) {
      maxCost = cost;
      endNode = nodeId;
    }
  }

  // Trace back the critical path
  const path: string[] = [];
  let current: string | null = endNode;
  while (current !== null) {
    path.unshift(current);
    current = predecessor.get(current) ?? null;
  }

  return path;
}

/**
 * Build the ExecutionPlan from a validated flow.
 */
export function buildExecutionPlan(flow: FlowDefinition): ExecutionPlan {
  const { sorted } = topologicalSort(
    flow.nodes.map((n) => n.id),
    flow.edges,
  );

  const nodeMap = new Map(flow.nodes.map((n) => [n.id, n]));
  const outputMap = buildOutputMap(flow.nodes);

  const phases: PhaseInfo[] = sorted.map((nodeId, index) => {
    const node = nodeMap.get(nodeId)!;
    return {
      nodeId,
      order: index,
      inputsFrom: node.config.inputs.map((file) => ({
        file,
        source: outputMap.has(file) ? outputMap.get(file)! : ('user_upload' as const),
      })),
      skills: [...new Set([...flow.skills, ...node.config.skills])],
      estimatedCost: {
        turns: node.config.budget?.maxTurns ?? 0,
        usd: node.config.budget?.maxBudgetUsd ?? 0,
      },
      interruptCapable: hasInterrupts(node),
      children:
        node.children.length > 0 ? buildChildPhases(node.children, flow.skills) : undefined,
    };
  });

  const totalEstimatedCost = phases.reduce(
    (acc, p) => ({
      turns: acc.turns + p.estimatedCost.turns,
      usd: acc.usd + p.estimatedCost.usd,
    }),
    { turns: 0, usd: 0 },
  );

  const criticalPath = computeCriticalPath(flow);

  return { phases, totalEstimatedCost, criticalPath };
}
