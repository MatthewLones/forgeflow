export type NodeType = 'agent' | 'checkpoint';

export type InterruptType = 'approval' | 'qa' | 'selection' | 'review' | 'escalation';

export type InterruptMode = 'inline' | 'checkpoint';

// --- Artifact types ---

export type ArtifactFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/** A field definition within a JSON artifact schema */
export interface ArtifactField {
  /** Field key name, e.g., "clause_id" */
  key: string;
  /** Field type */
  type: ArtifactFieldType;
  /** Human-readable description */
  description: string;
  /** Whether this field is required (default: true) */
  required?: boolean;
}

/** Supported artifact file formats */
export type ArtifactFormat = 'json' | 'markdown' | 'text' | 'csv' | 'pdf' | 'image' | 'binary';

/** Full artifact schema describing a file's structure and purpose */
export interface ArtifactSchema {
  /** Filename, e.g., "clauses_parsed.json" */
  name: string;
  /** File format */
  format: ArtifactFormat;
  /** Human-readable description of what this file contains */
  description: string;
  /** Top-level field definitions (only for format='json') */
  fields?: ArtifactField[];
}

/** Normalize a string or ArtifactSchema to just the filename */
export function artifactName(artifact: string | ArtifactSchema): string {
  return typeof artifact === 'string' ? artifact : artifact.name;
}

export interface NodeBudget {
  /** Max API round-trips for this node */
  maxTurns: number;
  /** Max dollar cost for this node */
  maxBudgetUsd: number;
}

export interface CheckpointPresentation {
  /** Header shown to user at checkpoint */
  title: string;
  /** Named sections to render (e.g., "questions", "auto_fixable") */
  sections: string[];
}

export interface InterruptConfig {
  type: InterruptType;
  /** Default: 'inline' with auto-escalate */
  mode?: InterruptMode;
  /** Auto-escalate timeout (default: 300000 = 5min) */
  timeoutMs?: number;
}

/** An input or output entry: either a plain filename or a full artifact schema */
export type ArtifactRef = string | ArtifactSchema;

export interface NodeConfig {
  /** Files this node reads (relative to workspace) */
  inputs: ArtifactRef[];
  /** Files this node produces (relative to output/) */
  outputs: ArtifactRef[];
  /** Skill names to load for this node */
  skills: string[];
  /** Per-node budget (optional if using flow-level budget) */
  budget?: NodeBudget;
  /** Human-readable estimate: "30s", "2min", "5min" */
  estimatedDuration?: string;
  /** Only for checkpoint nodes */
  presentation?: CheckpointPresentation;
  /** Interrupt types this node may fire (optional) */
  interrupts?: InterruptConfig[];
}

export interface FlowNode {
  /** Unique identifier (snake_case: [a-z][a-z0-9_]*) */
  id: string;
  /** "agent" or "checkpoint" */
  type: NodeType;
  /** Display name on canvas */
  name: string;
  /** Free-text: what the agent should do */
  instructions: string;
  /** Structured configuration */
  config: NodeConfig;
  /** Sub-nodes (run in parallel inside this node) */
  children: FlowNode[];
}
