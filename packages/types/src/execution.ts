import type { FlowDiagnostic } from './errors.js';

/** A resolved phase in the execution plan */
export interface PhaseInfo {
  nodeId: string;
  order: number;
  inputsFrom: Array<{ file: string; source: 'user_upload' | string }>;
  skills: string[];
  estimatedCost: { turns: number; usd: number };
  interruptCapable: boolean;
  children?: PhaseInfo[];
}

/** The resolved execution plan produced on successful validation */
export interface ExecutionPlan {
  phases: PhaseInfo[];
  totalEstimatedCost: { turns: number; usd: number };
  criticalPath: string[];
}

/** Complete validation result */
export interface ValidationResult {
  valid: boolean;
  errors: FlowDiagnostic[];
  warnings: FlowDiagnostic[];
  suggestions: FlowDiagnostic[];
  executionPlan: ExecutionPlan | null;
}
