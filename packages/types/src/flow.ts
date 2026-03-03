import type { FlowNode, ArtifactSchema } from './node.js';

export interface FlowEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** True if this edge was auto-created from artifact dependencies */
  auto?: boolean;
}

export interface FlowBudget {
  /** Total max turns for the entire flow */
  maxTurns: number;
  /** Total max cost for the entire flow */
  maxBudgetUsd: number;
  /** Wall-clock timeout in milliseconds */
  timeoutMs: number;
}

export interface FlowDefinition {
  /** Unique flow identifier */
  id: string;
  /** Display name */
  name: string;
  /** Semver string */
  version: string;
  /** One-line description */
  description: string;
  /** Global skills (available to all nodes) */
  skills: string[];
  /** Flow-level budget constraints */
  budget: FlowBudget;
  /** All top-level nodes */
  nodes: FlowNode[];
  /** Connections between top-level nodes */
  edges: FlowEdge[];
  /** Flow-level artifact registry (keyed by artifact name) */
  artifacts?: Record<string, ArtifactSchema>;
  /** Saved node positions from manual layout (keyed by node ID) */
  layout?: Record<string, { x: number; y: number }>;
}
