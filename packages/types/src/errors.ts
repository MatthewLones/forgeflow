export type DiagnosticSeverity = 'error' | 'warning' | 'suggestion';

export interface DiagnosticLocation {
  /** The node ID where the issue occurs */
  nodeId?: string;
  /** The field path within the node (e.g., "config.inputs[0]") */
  field?: string;
  /** The edge index if the issue is on an edge */
  edgeIndex?: number;
}

export interface FlowDiagnostic {
  /** Unique diagnostic code (e.g., "CYCLE_DETECTED", "UNRESOLVED_INPUT") */
  code: string;
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Human-readable error message */
  message: string;
  /** Where in the flow the issue occurs */
  location: DiagnosticLocation;
  /** Actionable suggestion for fixing the issue */
  suggestion?: string;
  /** Related node IDs or files for context */
  related?: string[];
}
