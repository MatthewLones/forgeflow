import type { ArtifactSchema, NodeBudget, CheckpointPresentation } from './node.js';

/** Source attribution for an input file */
export interface InputFileEntry {
  /** Filename */
  file: string;
  /** Source: producerId or 'user_upload' */
  source: string;
  /** Human-readable label: 'user upload' or 'from {nodeId}' */
  sourceLabel: string;
  /** ArtifactSchema if available */
  schema?: ArtifactSchema;
}

/** An output file the node must produce */
export interface OutputFileEntry {
  /** Filename */
  file: string;
  /** ArtifactSchema if available */
  schema?: ArtifactSchema;
}

/** A skill available to the node */
export interface SkillEntry {
  /** Skill name */
  name: string;
  /** Directory path relative to workspace */
  path: string;
}

/** A child node reference for the subagent table */
export interface ChildReference {
  /** 1-based index */
  index: number;
  /** Child node ID */
  id: string;
  /** Child display name */
  name: string;
  /** Path to child's prompt file */
  promptFile: string;
  /** Expected output filenames */
  outputs: string[];
}

/** Whether interrupt protocol should be included */
export interface InterruptSection {
  enabled: boolean;
}

/** IR for a checkpoint node */
export interface CheckpointIR {
  kind: 'checkpoint';
  nodeId: string;
  name: string;
  instructions: string;
  filesToPresent: InputFileEntry[];
  expectedInputs: OutputFileEntry[];
  presentation?: CheckpointPresentation;
}

/** IR for an agent or merge node */
export interface AgentPhaseIR {
  kind: 'agent';
  nodeId: string;
  name: string;
  /** Whether this is a child subagent (vs top-level phase) */
  isChild: boolean;
  /** Flow name (for header) */
  flowName: string;
  /** Instructions text */
  instructions: string;
  /** Input files with source attribution */
  inputs: InputFileEntry[];
  /** Required output files */
  outputs: OutputFileEntry[];
  /** Available skills (global + node-specific, deduplicated) */
  skills: SkillEntry[];
  /** Budget constraints (always set for top-level; optional for children) */
  budget?: NodeBudget;
  /** Static rules text entries */
  rules: string[];
  /** Children (subagents) to launch concurrently */
  children: ChildReference[];
  /** Interrupt protocol */
  interrupt: InterruptSection;
}

/** The union IR type for a single compiled prompt */
export type PhaseIR = AgentPhaseIR | CheckpointIR;

/** IR for all child prompt files of a node */
export interface ChildPromptIR {
  /** filename (e.g., 'child_a.md') -> PhaseIR for the child */
  children: Map<string, PhaseIR>;
}
