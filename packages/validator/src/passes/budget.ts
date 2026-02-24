import type { FlowDefinition, FlowNode, FlowDiagnostic } from '@flowforge/types';
import { createDiagnostic } from '../diagnostics.js';

export function checkBudget(flow: FlowDefinition): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];

  let totalNodeTurns = 0;
  let totalNodeUsd = 0;
  let nodesWithBudget = 0;

  function checkNode(node: FlowNode) {
    if (node.config.budget) {
      totalNodeTurns += node.config.budget.maxTurns;
      totalNodeUsd += node.config.budget.maxBudgetUsd;
      nodesWithBudget++;
    } else if (node.type === 'agent') {
      diagnostics.push(
        createDiagnostic(
          'NO_NODE_BUDGET',
          'suggestion',
          `Node "${node.id}" has no budget. Flow-level budget will apply.`,
          { nodeId: node.id, field: 'config.budget' },
          `Consider adding a per-node budget for cost predictability. Flow budget: $${flow.budget.maxBudgetUsd.toFixed(2)}, ${flow.budget.maxTurns} turns.`,
        ),
      );
    }

    // Check children budget sum vs parent budget
    if (node.children.length > 0 && node.config.budget) {
      let childTurns = 0;
      let childUsd = 0;
      for (const child of node.children) {
        if (child.config.budget) {
          childTurns += child.config.budget.maxTurns;
          childUsd += child.config.budget.maxBudgetUsd;
        }
      }
      if (childTurns > node.config.budget.maxTurns) {
        diagnostics.push(
          createDiagnostic(
            'CHILDREN_BUDGET_EXCEEDS_PARENT',
            'warning',
            `Children of "${node.id}" have a combined budget of ${childTurns} turns, which exceeds the parent's ${node.config.budget.maxTurns} turns.`,
            { nodeId: node.id, field: 'config.budget' },
            'Increase the parent budget or reduce children budgets.',
          ),
        );
      }
      if (childUsd > node.config.budget.maxBudgetUsd) {
        diagnostics.push(
          createDiagnostic(
            'CHILDREN_BUDGET_EXCEEDS_PARENT',
            'warning',
            `Children of "${node.id}" have a combined budget of $${childUsd.toFixed(2)}, which exceeds the parent's $${node.config.budget.maxBudgetUsd.toFixed(2)}.`,
            { nodeId: node.id, field: 'config.budget' },
            'Increase the parent budget or reduce children budgets.',
          ),
        );
      }
    }
  }

  for (const node of flow.nodes) {
    checkNode(node);
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
