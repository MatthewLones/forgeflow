import type { FlowNode, ArtifactSchema } from './node.js';
import type { FlowDefinition } from './flow.js';

/** A node in the analyzed flow graph, enriched with derived data */
export interface FlowSymbol {
  /** The original FlowNode */
  node: FlowNode;
  /** Depth in the tree (0 = top-level) */
  depth: number;
  /** Parent node ID, or null for top-level nodes */
  parentId: string | null;
  /** IDs of direct children */
  childIds: string[];
  /** All descendant node IDs (recursive) */
  descendantIds: string[];
  /** Topological order index for top-level nodes; -1 for children */
  topoIndex: number;
  /** IDs of nodes that must complete before this one (top-level only) */
  predecessors: string[];
  /** IDs of nodes that depend on this one (top-level only) */
  successors: string[];
  /** Whether this node or any descendant has interrupt configs */
  interruptCapable: boolean;
  /** All output filenames declared by this node (normalized to strings) */
  declaredOutputs: string[];
  /** All input filenames required by this node (normalized to strings) */
  declaredInputs: string[];
  /** Artifact schemas for outputs (keyed by filename) */
  outputSchemas: ReadonlyMap<string, ArtifactSchema>;
  /** Artifact schemas for inputs (keyed by filename) */
  inputSchemas: ReadonlyMap<string, ArtifactSchema>;
}

/** Maps an artifact filename to its production/consumption metadata */
export interface ArtifactEntry {
  /** The artifact filename */
  name: string;
  /** ID of the node that produces this artifact */
  producerId: string;
  /** ArtifactSchema if the producer declared one */
  schema?: ArtifactSchema;
  /** Node IDs that consume this artifact as an input */
  consumerIds: Set<string>;
}

/** The complete semantic analysis of a flow, built once, used by all passes */
export interface FlowGraph {
  /** The original flow definition (immutable reference) */
  flow: FlowDefinition;
  /** All symbols indexed by node ID (includes all depths) */
  symbols: ReadonlyMap<string, FlowSymbol>;
  /** Top-level node IDs in topological order (partial if cycle exists) */
  topoOrder: readonly string[];
  /** Whether the graph contains a cycle */
  hasCycle: boolean;
  /** Node IDs involved in cycles (empty if acyclic) */
  cycleNodes: readonly string[];
  /** Artifact registry: filename -> production metadata */
  artifacts: ReadonlyMap<string, ArtifactEntry>;
  /** Files inferred as user uploads (entry-node inputs not produced by any node) */
  userUploadFiles: readonly string[];
  /** Files available before each top-level node executes */
  availableAtPhase: ReadonlyMap<string, ReadonlySet<string>>;
  /** Adjacency: top-level node ID -> successor node IDs */
  outgoing: ReadonlyMap<string, readonly string[]>;
  /** Adjacency: top-level node ID -> predecessor node IDs */
  incoming: ReadonlyMap<string, readonly string[]>;
}
