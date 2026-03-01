import type { ValidationRule, RuleId } from '@forgeflow/types';
import { checkOutputUniqueness } from './passes/output.js';
import { checkDependencies } from './passes/dependency.js';
import { checkBudget } from './passes/budget.js';
import { checkInterrupts } from './passes/interrupt.js';
import { checkSchemaCompat } from './passes/schema-compat.js';
import { nodeIdFormatRule } from './rules/node-id-format.js';
import { nodeIdUniqueRule } from './rules/node-id-unique.js';
import { edgeValidityRule } from './rules/edge-validity.js';
import { dagAcyclicRule } from './rules/dag-acyclic.js';
import { connectivityRule } from './rules/connectivity.js';
import { nodeTypeRulesRule } from './rules/node-type-rules.js';

/**
 * Non-structural rules that delegate to pass functions.
 */

const outputUniquenessRule: ValidationRule = {
  descriptor: {
    id: 'type-system/output-uniqueness',
    name: 'Output Uniqueness',
    description: 'Each output filename must be unique across the flow',
    category: 'type-system',
    dependencies: [],
    defaultSeverity: 'error',
    enabledByDefault: true,
  },
  check(graph) {
    return checkOutputUniqueness(graph);
  },
};

const dependencyResolutionRule: ValidationRule = {
  descriptor: {
    id: 'dataflow/dependency-resolution',
    name: 'Dependency Resolution',
    description: 'Every input traces to a user upload or prior node output',
    category: 'dataflow',
    dependencies: [
      'structural/dag-acyclic',
      'structural/connectivity',
      'type-system/output-uniqueness',
    ],
    defaultSeverity: 'error',
    enabledByDefault: true,
  },
  check(graph, options) {
    const userUploads = options?.userUploadFiles ?? [...graph.userUploadFiles];
    return checkDependencies(graph, userUploads);
  },
};

const budgetCheckRule: ValidationRule = {
  descriptor: {
    id: 'resource/budget-check',
    name: 'Budget Check',
    description: 'Node and flow budget constraints are reasonable',
    category: 'resource',
    dependencies: [],
    defaultSeverity: 'warning',
    enabledByDefault: true,
  },
  check(graph) {
    return checkBudget(graph);
  },
};

const interruptValidityRule: ValidationRule = {
  descriptor: {
    id: 'runtime/interrupt-validity',
    name: 'Interrupt Validity',
    description: 'Interrupt configs are valid for their node types',
    category: 'runtime',
    dependencies: [],
    defaultSeverity: 'warning',
    enabledByDefault: true,
  },
  check(graph) {
    return checkInterrupts(graph);
  },
};

const schemaCompatibilityRule: ValidationRule = {
  descriptor: {
    id: 'type-system/schema-compatibility',
    name: 'Schema Compatibility',
    description: 'Producer and consumer artifact schemas are compatible',
    category: 'type-system',
    dependencies: ['type-system/output-uniqueness'],
    defaultSeverity: 'warning',
    enabledByDefault: true,
  },
  check(graph) {
    return checkSchemaCompat(graph);
  },
};

/**
 * Create the default rule registry with all 11 rules.
 * Returns a new array each time (safe to modify).
 */
export function createDefaultRegistry(): ValidationRule[] {
  return [
    // Structural rules (6, split from monolithic pass)
    nodeIdFormatRule,
    nodeIdUniqueRule,
    edgeValidityRule,
    dagAcyclicRule,
    connectivityRule,
    nodeTypeRulesRule,
    // Type-system rules
    outputUniquenessRule,
    schemaCompatibilityRule,
    // Dataflow rules
    dependencyResolutionRule,
    // Resource rules
    budgetCheckRule,
    // Runtime rules
    interruptValidityRule,
  ];
}

/**
 * Compose a custom registry from a base, with additions and removals.
 */
export function createRegistry(
  base: ValidationRule[],
  options?: {
    additions?: ValidationRule[];
    removals?: RuleId[];
  },
): ValidationRule[] {
  const removalSet = new Set(options?.removals ?? []);
  const filtered = base.filter((r) => !removalSet.has(r.descriptor.id));
  return [...filtered, ...(options?.additions ?? [])];
}
