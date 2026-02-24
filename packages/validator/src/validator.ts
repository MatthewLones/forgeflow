import type { FlowDefinition, ValidationResult, ExecutionPlan, FlowDiagnostic } from '@forgeflow/types';
import { checkStructural } from './passes/structural.js';
import { checkOutputUniqueness } from './passes/output.js';
import { checkDependencies } from './passes/dependency.js';
import { checkBudget } from './passes/budget.js';
import { checkInterrupts } from './passes/interrupt.js';
import { buildExecutionPlan } from './execution-plan.js';

export interface ValidateOptions {
  /** Files the user will upload at runtime (first-node inputs). */
  userUploadFiles?: string[];
}

export function validateFlow(
  flow: FlowDefinition,
  options?: ValidateOptions,
): ValidationResult {
  const errors: FlowDiagnostic[] = [];
  const warnings: FlowDiagnostic[] = [];
  const suggestions: FlowDiagnostic[] = [];

  function collect(diagnostics: FlowDiagnostic[]) {
    for (const d of diagnostics) {
      if (d.severity === 'error') errors.push(d);
      else if (d.severity === 'warning') warnings.push(d);
      else suggestions.push(d);
    }
  }

  // Pass 1: Structural checks (DAG, IDs, edges, node rules)
  collect(checkStructural(flow));

  // Pass 2: Output uniqueness (must run before dependency check)
  collect(checkOutputUniqueness(flow));

  // Pass 3: Dependency resolution (every input traces to a source)
  // Only run if structural checks passed (need valid DAG for topological sort)
  if (errors.length === 0) {
    // If no user upload files specified, treat first node's inputs as implicitly available
    const userUploads = options?.userUploadFiles ?? inferUserUploads(flow);
    collect(checkDependencies(flow, userUploads));
  }

  // Pass 4: Budget checks
  collect(checkBudget(flow));

  // Pass 5: Interrupt validation
  collect(checkInterrupts(flow));

  // Build execution plan only if valid
  let executionPlan: ExecutionPlan | null = null;
  if (errors.length === 0) {
    executionPlan = buildExecutionPlan(flow);
  }

  return { valid: errors.length === 0, errors, warnings, suggestions, executionPlan };
}

/**
 * When no user upload files are specified, infer them from entry nodes only.
 * Entry nodes are those with no incoming edges — their unresolved inputs are user uploads.
 * Mid-flow nodes with unresolved inputs are real errors, not implicit uploads.
 */
function inferUserUploads(flow: FlowDefinition): string[] {
  // Find entry nodes (no incoming edges)
  const nodesWithIncoming = new Set(flow.edges.map((e) => e.to));
  const entryNodes = flow.nodes.filter((n) => !nodesWithIncoming.has(n.id));

  // Collect all outputs across all nodes
  const allOutputs = new Set<string>();
  function collectOutputs(nodes: import('@forgeflow/types').FlowNode[]) {
    for (const node of nodes) {
      for (const file of node.config.outputs) {
        allOutputs.add(file);
      }
      collectOutputs(node.children);
    }
  }
  collectOutputs(flow.nodes);

  // Only entry node inputs that aren't produced by any node are user uploads
  const userUploads: string[] = [];
  for (const node of entryNodes) {
    for (const file of node.config.inputs) {
      if (!allOutputs.has(file) && !userUploads.includes(file)) {
        userUploads.push(file);
      }
    }
  }

  return userUploads;
}
