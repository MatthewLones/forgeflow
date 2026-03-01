import type { FlowDefinition, ValidationResult, ValidateOptions } from '@forgeflow/types';
import { buildFlowGraph } from './flow-graph.js';
import { createDefaultRegistry } from './rule-registry.js';
import { runValidationPipeline } from './rule-runner.js';

// Re-export ValidateOptions from types (was previously defined here)
export type { ValidateOptions } from '@forgeflow/types';

/**
 * Validate a flow definition.
 *
 * Backwards-compatible: same signature, same return type.
 * Internally delegates to the pluggable pipeline.
 */
export function validateFlow(
  flow: FlowDefinition,
  options?: ValidateOptions,
): ValidationResult {
  const graph = buildFlowGraph(flow);
  const rules = createDefaultRegistry();
  const { result } = runValidationPipeline(graph, rules, options);
  return result;
}

/**
 * Validate with full pipeline introspection.
 * Returns per-rule results, the flow graph, and timing data.
 */
export function validateFlowDetailed(
  flow: FlowDefinition,
  options?: ValidateOptions,
) {
  const graph = buildFlowGraph(flow);
  const rules = createDefaultRegistry();
  return runValidationPipeline(graph, rules, options);
}
