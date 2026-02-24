export type NodeType = 'agent' | 'checkpoint' | 'merge';

export type InterruptType = 'approval' | 'qa' | 'selection' | 'review' | 'escalation';

export type InterruptMode = 'inline' | 'checkpoint';

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

export interface NodeConfig {
  /** Files this node reads (relative to workspace) */
  inputs: string[];
  /** Files this node produces (relative to output/) */
  outputs: string[];
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
  /** "agent", "checkpoint", or "merge" */
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
