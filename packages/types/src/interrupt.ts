import type { InterruptType, InterruptMode, ArtifactFormat } from './node.js';

export interface InterruptSource {
  /** Path in the node tree, e.g., ["research", "law_agent"] */
  agentPath: string[];
  /** How deep in the recursion */
  depth: number;
}

export interface InterruptBase {
  /** Unique ID: "int_{nodeId}_{sequence}" */
  interrupt_id: string;
  type: InterruptType;
  source: InterruptSource;
  /** inline (sandbox stays alive) or checkpoint (serialize + teardown) */
  mode: InterruptMode;
  /** Auto-escalate from inline -> checkpoint after this */
  timeoutMs?: number;
  title: string;
  /** Why this interrupt is happening */
  context: string;
  /** Optional file attachments to present alongside the interrupt form */
  attachments?: Array<{ fileName: string; label?: string; format?: ArtifactFormat }>;
}

// --- Approval ---

export interface ApprovalInterrupt extends InterruptBase {
  type: 'approval';
  proposal: string;
  evidence?: string[];
  options: ('approve' | 'reject' | 'modify')[];
}

export interface ApprovalAnswer {
  decision: 'approve' | 'reject' | 'modify';
  modifications?: string;
}

// --- Q&A ---

export interface QAQuestion {
  id: string;
  label: string;
  context: string;
  inputType: 'text' | 'number' | 'choice' | 'boolean';
  options?: string[];
  required: boolean;
  defaultValue?: string | number | boolean;
}

export interface QAInterrupt extends InterruptBase {
  type: 'qa';
  questions: QAQuestion[];
}

export interface QAAnswer {
  answers: Record<string, string | number | boolean>;
}

// --- Selection ---

export interface SelectionItem {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
  file?: string;
}

export interface SelectionInterrupt extends InterruptBase {
  type: 'selection';
  items: SelectionItem[];
  minSelect?: number;
  /** null = unlimited */
  maxSelect?: number | null;
}

export interface SelectionAnswer {
  selected: string[];
}

// --- Review & Edit ---

export interface ReviewInterrupt extends InterruptBase {
  type: 'review';
  draftFile: string;
  format: 'markdown' | 'json' | 'text';
  instructions: string;
}

export interface ReviewAnswer {
  accepted: boolean;
  /** Only if accepted=false */
  editedContent?: string;
}

// --- Escalation ---

export interface EscalationInterrupt extends InterruptBase {
  type: 'escalation';
  severity: 'info' | 'warning' | 'critical';
  finding: string;
  evidence: string[];
  suggestedAction: string;
  routeTo?: string;
}

export interface EscalationAnswer {
  action: 'acknowledge' | 'override' | 'route';
  notes?: string;
  routedTo?: string;
}

// --- Escalated (auto-escalate timeout) ---

export interface EscalatedAnswer {
  decision: 'escalated';
  originalInterruptId: string;
  reason: 'timeout';
}

// --- Union types ---

export type Interrupt =
  | ApprovalInterrupt
  | QAInterrupt
  | SelectionInterrupt
  | ReviewInterrupt
  | EscalationInterrupt;

export type InterruptAnswer =
  | ApprovalAnswer
  | QAAnswer
  | SelectionAnswer
  | ReviewAnswer
  | EscalationAnswer
  | EscalatedAnswer;
