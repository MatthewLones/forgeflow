import type { FlowNode, ExecutionPlan, PhaseInfo, FlowGraph } from '@forgeflow/types';
import { artifactName } from '@forgeflow/types';

/**
 * Build PhaseInfo entries for child nodes using FlowGraph symbols.
 */
function buildChildPhases(children: FlowNode[], globalSkills: string[], graph: FlowGraph): PhaseInfo[] {
  return children.map((child, index) => {
    const sym = graph.symbols.get(child.id)!;
    return {
      nodeId: child.id,
      order: index,
      inputsFrom: sym.declaredInputs.map((file) => ({
        file,
        source: 'parent' as const,
      })),
      skills: [...new Set([...globalSkills, ...child.config.skills])],
      estimatedCost: {
        turns: child.config.budget?.maxTurns ?? 0,
        usd: child.config.budget?.maxBudgetUsd ?? 0,
      },
      interruptCapable: sym.interruptCapable,
      children:
        child.children.length > 0 ? buildChildPhases(child.children, globalSkills, graph) : undefined,
    };
  });
}

/**
 * Compute the critical path through the DAG (longest path by estimated cost in USD).
 */
function computeCriticalPath(graph: FlowGraph): string[] {
  // Dynamic programming: longest path to each node
  const longestCost = new Map<string, number>();
  const predecessor = new Map<string, string | null>();

  for (const nodeId of graph.topoOrder) {
    const sym = graph.symbols.get(nodeId)!;
    const nodeCost = sym.node.config.budget?.maxBudgetUsd ?? 0;

    let maxPriorCost = 0;
    let bestPred: string | null = null;

    const incomingNodes = graph.incoming.get(nodeId) ?? [];
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
  let endNode = graph.topoOrder[0];
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
 * Build the ExecutionPlan from a FlowGraph.
 */
export function buildExecutionPlan(graph: FlowGraph): ExecutionPlan {
  const phases: PhaseInfo[] = graph.topoOrder.map((nodeId, index) => {
    const sym = graph.symbols.get(nodeId)!;
    const node = sym.node;
    return {
      nodeId,
      order: index,
      inputsFrom: sym.declaredInputs.map((file) => {
        const artifact = graph.artifacts.get(file);
        return {
          file,
          source: artifact ? artifact.producerId : ('user_upload' as const),
        };
      }),
      skills: [...new Set([...graph.flow.skills, ...node.config.skills])],
      estimatedCost: {
        turns: node.config.budget?.maxTurns ?? 0,
        usd: node.config.budget?.maxBudgetUsd ?? 0,
      },
      interruptCapable: sym.interruptCapable,
      children:
        node.children.length > 0 ? buildChildPhases(node.children, graph.flow.skills, graph) : undefined,
    };
  });

  const totalEstimatedCost = phases.reduce(
    (acc, p) => ({
      turns: acc.turns + p.estimatedCost.turns,
      usd: acc.usd + p.estimatedCost.usd,
    }),
    { turns: 0, usd: 0 },
  );

  const criticalPath = computeCriticalPath(graph);

  return { phases, totalEstimatedCost, criticalPath };
}
