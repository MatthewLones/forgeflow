import type { FlowDiagnostic, DiagnosticSeverity } from './errors.js';
import type { FlowGraph } from './flow-graph.js';
import type { ValidationResult } from './execution.js';

/** Unique identifier for a validation rule. Convention: "category/name" */
export type RuleId = string;

/** Categories for grouping rules in the UI */
export type RuleCategory =
  | 'structural'
  | 'type-system'
  | 'dataflow'
  | 'resource'
  | 'runtime'
  | 'style'
  | 'custom';

/** Metadata describing a validation rule */
export interface RuleDescriptor {
  /** Unique rule identifier, e.g., "structural/dag-acyclic" */
  id: RuleId;
  /** Human-readable name for UI display */
  name: string;
  /** One-line description of what the rule checks */
  description: string;
  /** Category for grouping in UI panels */
  category: RuleCategory;
  /** IDs of rules that must succeed before this rule runs */
  dependencies: RuleId[];
  /** Default severity for diagnostics this rule produces */
  defaultSeverity: DiagnosticSeverity;
  /** Whether this rule is enabled by default */
  enabledByDefault: boolean;
}

/** Options passed to the validation pipeline */
export interface ValidateOptions {
  /** Files the user will upload at runtime (overrides inference) */
  userUploadFiles?: string[];
  /** Rule IDs to disable */
  disabledRules?: RuleId[];
  /** Rule IDs to force-enable */
  enabledRules?: RuleId[];
  /** If true, run rules even if their dependencies produced errors */
  continueOnDependencyFailure?: boolean;
}

/** A validation rule: metadata + pure check function */
export interface ValidationRule {
  /** Rule metadata */
  descriptor: RuleDescriptor;
  /** Execute the rule against a flow graph */
  check(graph: FlowGraph, options?: ValidateOptions): FlowDiagnostic[];
}

/** Execution result for a single rule */
export interface RuleRunResult {
  ruleId: RuleId;
  ruleName: string;
  category: string;
  diagnostics: FlowDiagnostic[];
  skipped: boolean;
  skipReason?: string;
  durationMs: number;
}

/** Full pipeline result with introspection */
export interface ValidationPipelineResult {
  result: ValidationResult;
  ruleResults: RuleRunResult[];
  graph: FlowGraph;
  totalDurationMs: number;
}
