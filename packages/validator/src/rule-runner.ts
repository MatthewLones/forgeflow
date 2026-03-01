import type {
  FlowDiagnostic,
  ExecutionPlan,
  ValidationRule,
  ValidateOptions,
  RuleId,
  RuleRunResult,
  ValidationPipelineResult,
  FlowGraph,
} from '@forgeflow/types';
import { buildExecutionPlan } from './execution-plan.js';

/**
 * Execute a set of validation rules against a flow graph.
 *
 * Algorithm:
 * 1. Filter rules by enabled/disabled options
 * 2. Topologically sort rules by their dependency declarations
 * 3. Run each rule in order, tracking which produced errors
 * 4. Skip rules whose dependencies produced errors (unless overridden)
 * 5. Collect all diagnostics into the standard ValidationResult
 * 6. Build execution plan if no errors
 */
export function runValidationPipeline(
  graph: FlowGraph,
  rules: ValidationRule[],
  options?: ValidateOptions,
): ValidationPipelineResult {
  const startTime = performance.now();
  const ruleResults: RuleRunResult[] = [];
  const allDiagnostics: FlowDiagnostic[] = [];
  const rulesWithErrors = new Set<RuleId>();

  // Determine which rules are enabled
  const disabledSet = new Set(options?.disabledRules ?? []);
  const enabledSet = new Set(options?.enabledRules ?? []);

  const enabledRules = rules.filter((rule) => {
    if (disabledSet.has(rule.descriptor.id)) return false;
    if (enabledSet.has(rule.descriptor.id)) return true;
    return rule.descriptor.enabledByDefault;
  });

  // Topologically sort rules by dependencies
  const orderedRules = topologicalSortRules(enabledRules);

  for (const rule of orderedRules) {
    // Check if all dependencies succeeded
    const failedDeps = rule.descriptor.dependencies.filter((depId) =>
      rulesWithErrors.has(depId),
    );

    if (failedDeps.length > 0 && !options?.continueOnDependencyFailure) {
      ruleResults.push({
        ruleId: rule.descriptor.id,
        ruleName: rule.descriptor.name,
        category: rule.descriptor.category,
        diagnostics: [],
        skipped: true,
        skipReason: `Skipped: depends on failed rule(s) ${failedDeps.join(', ')}`,
        durationMs: 0,
      });
      continue;
    }

    // Run the rule
    const ruleStart = performance.now();
    const diagnostics = rule.check(graph, options);
    const ruleEnd = performance.now();

    // Track if this rule produced errors
    if (diagnostics.some((d) => d.severity === 'error')) {
      rulesWithErrors.add(rule.descriptor.id);
    }

    allDiagnostics.push(...diagnostics);
    ruleResults.push({
      ruleId: rule.descriptor.id,
      ruleName: rule.descriptor.name,
      category: rule.descriptor.category,
      diagnostics,
      skipped: false,
      durationMs: ruleEnd - ruleStart,
    });
  }

  // Separate by severity
  const errors = allDiagnostics.filter((d) => d.severity === 'error');
  const warnings = allDiagnostics.filter((d) => d.severity === 'warning');
  const suggestions = allDiagnostics.filter((d) => d.severity === 'suggestion');

  // Build execution plan if no errors
  let executionPlan: ExecutionPlan | null = null;
  if (errors.length === 0) {
    executionPlan = buildExecutionPlan(graph);
  }

  return {
    result: {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
      executionPlan,
    },
    ruleResults,
    graph,
    totalDurationMs: performance.now() - startTime,
  };
}

/**
 * Topologically sort rules by their dependency declarations.
 * Uses Kahn's algorithm. Falls back to input order for independent rules.
 */
function topologicalSortRules(rules: ValidationRule[]): ValidationRule[] {
  const ruleMap = new Map(rules.map((r) => [r.descriptor.id, r]));
  const inDegree = new Map<RuleId, number>();
  const adjacency = new Map<RuleId, RuleId[]>();

  for (const rule of rules) {
    const id = rule.descriptor.id;
    if (!inDegree.has(id)) inDegree.set(id, 0);
    if (!adjacency.has(id)) adjacency.set(id, []);

    for (const depId of rule.descriptor.dependencies) {
      if (ruleMap.has(depId)) {
        if (!adjacency.has(depId)) adjacency.set(depId, []);
        adjacency.get(depId)!.push(id);
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }
  }

  const queue: RuleId[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: ValidationRule[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const rule = ruleMap.get(id);
    if (rule) sorted.push(rule);
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}
