import type { FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

export function checkBudget(graph: FlowGraph): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const flow = graph.flow;

  let totalNodeTurns = 0;
  let totalNodeUsd = 0;
  let nodesWithBudget = 0;

  for (const [nodeId, sym] of graph.symbols) {
    const node = sym.node;

    if (node.config.budget) {
      totalNodeTurns += node.config.budget.maxTurns;
      totalNodeUsd += node.config.budget.maxBudgetUsd;
      nodesWithBudget++;
    } else if (node.type === 'agent') {
      diagnostics.push(
        createDiagnostic(
          'NO_NODE_BUDGET',
          'suggestion',
          `Node "${nodeId}" has no budget. Flow-level budget will apply.`,
          { nodeId, field: 'config.budget' },
          `Consider adding a per-node budget for cost predictability. Flow budget: $${flow.budget.maxBudgetUsd.toFixed(2)}, ${flow.budget.maxTurns} turns.`,
        ),
      );
    }

    // Check children budget sum vs parent budget
    if (sym.childIds.length > 0 && node.config.budget) {
      let childTurns = 0;
      let childUsd = 0;
      for (const childId of sym.childIds) {
        const childSym = graph.symbols.get(childId);
        if (childSym?.node.config.budget) {
          childTurns += childSym.node.config.budget.maxTurns;
          childUsd += childSym.node.config.budget.maxBudgetUsd;
        }
      }
      if (childTurns > node.config.budget.maxTurns) {
        diagnostics.push(
          createDiagnostic(
            'CHILDREN_BUDGET_EXCEEDS_PARENT',
            'warning',
            `Children of "${nodeId}" have a combined budget of ${childTurns} turns, which exceeds the parent's ${node.config.budget.maxTurns} turns.`,
            { nodeId, field: 'config.budget' },
            'Increase the parent budget or reduce children budgets.',
          ),
        );
      }
      if (childUsd > node.config.budget.maxBudgetUsd) {
        diagnostics.push(
          createDiagnostic(
            'CHILDREN_BUDGET_EXCEEDS_PARENT',
            'warning',
            `Children of "${nodeId}" have a combined budget of $${childUsd.toFixed(2)}, which exceeds the parent's $${node.config.budget.maxBudgetUsd.toFixed(2)}.`,
            { nodeId, field: 'config.budget' },
            'Increase the parent budget or reduce children budgets.',
          ),
        );
      }
    }
  }

  // Sum of node budgets vs flow budget
  if (nodesWithBudget > 0) {
    if (totalNodeTurns > flow.budget.maxTurns) {
      diagnostics.push(
        createDiagnostic(
          'BUDGET_SUM_EXCEEDS_FLOW',
          'warning',
          `Sum of node budgets (${totalNodeTurns} turns) exceeds flow budget (${flow.budget.maxTurns} turns).`,
          { field: 'budget' },
          'Increase the flow budget or reduce individual node budgets.',
        ),
      );
    }
    if (totalNodeUsd > flow.budget.maxBudgetUsd) {
      diagnostics.push(
        createDiagnostic(
          'BUDGET_SUM_EXCEEDS_FLOW',
          'warning',
          `Sum of node budgets ($${totalNodeUsd.toFixed(2)}) exceeds flow budget ($${flow.budget.maxBudgetUsd.toFixed(2)}).`,
          { field: 'budget' },
          'Increase the flow budget or reduce individual node budgets.',
        ),
      );
    }
  }

  return diagnostics;
}
