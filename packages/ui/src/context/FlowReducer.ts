import type {
  FlowDefinition,
  FlowNode,
  FlowEdge,
  NodeConfig,
  FlowBudget,
  NodeType,
} from '@forgeflow/types';

export type FlowAction =
  | { type: 'SET_FLOW'; flow: FlowDefinition }
  | { type: 'SELECT_NODE'; nodeId: string | null }
  | { type: 'ADD_NODE'; node: FlowNode; position: { x: number; y: number } }
  | { type: 'REMOVE_NODE'; nodeId: string }
  | { type: 'UPDATE_NODE'; nodeId: string; updates: Partial<Pick<FlowNode, 'name' | 'instructions' | 'type'>> }
  | { type: 'UPDATE_NODE_CONFIG'; nodeId: string; config: Partial<NodeConfig> }
  | { type: 'ADD_EDGE'; edge: FlowEdge }
  | { type: 'REMOVE_EDGE'; from: string; to: string }
  | { type: 'UPDATE_FLOW_METADATA'; updates: Partial<Pick<FlowDefinition, 'name' | 'description' | 'version' | 'skills' | 'budget'>> }
  | { type: 'SET_NODE_CHILDREN'; nodeId: string; children: FlowNode[] }
  | { type: 'ADD_CHILD'; parentId: string; child: FlowNode; position: { x: number; y: number } }
  | { type: 'MOVE_NODE'; nodeId: string; position: { x: number; y: number } }
  | { type: 'CREATE_AGENT_FROM_SLASH'; name: string; parentId?: string }
  | { type: 'MARK_CLEAN' };

export interface FlowState {
  flow: FlowDefinition;
  positions: Record<string, { x: number; y: number }>;
  selectedNodeId: string | null;
  dirty: boolean;
}

/** Create a default new node of given type */
export function createDefaultNode(type: NodeType, id: string): FlowNode {
  const base: FlowNode = {
    id,
    type,
    name: type === 'agent' ? 'New Agent' : type === 'checkpoint' ? 'New Checkpoint' : 'New Merge',
    instructions: '',
    config: {
      inputs: [],
      outputs: [],
      skills: [],
    },
    children: [],
  };

  if (type === 'checkpoint') {
    base.config.presentation = { title: '', sections: [] };
  }

  return base;
}

/** Generate a unique snake_case ID */
export function generateNodeId(name: string, existingIds: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]/, 'n');

  if (!base) base = 'node';

  let id = base;
  let counter = 1;
  while (existingIds.has(id)) {
    id = `${base}_${counter}`;
    counter++;
  }
  return id;
}

/** Collect all node IDs including nested children */
export function collectAllNodeIds(nodes: FlowNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: FlowNode[]) {
    for (const node of list) {
      ids.add(node.id);
      walk(node.children);
    }
  }
  walk(nodes);
  return ids;
}

/** Remove a node by ID (searches recursively in children) */
function removeNodeRecursive(nodes: FlowNode[], nodeId: string): { nodes: FlowNode[]; found: boolean } {
  // Try removing at this level first
  const filtered = nodes.filter((n) => n.id !== nodeId);
  if (filtered.length < nodes.length) {
    return { nodes: filtered, found: true };
  }

  // Not at this level — search children
  let found = false;
  const mapped = nodes.map((node) => {
    if (found || node.children.length === 0) return node;
    const result = removeNodeRecursive(node.children, nodeId);
    if (result.found) {
      found = true;
      return { ...node, children: result.nodes };
    }
    return node;
  });

  return { nodes: mapped, found };
}

/** Find and update a node by ID (searches recursively in children) */
function updateNodeInList(nodes: FlowNode[], nodeId: string, updater: (node: FlowNode) => FlowNode): FlowNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return updater(node);
    }
    if (node.children.length > 0) {
      const updatedChildren = updateNodeInList(node.children, nodeId, updater);
      if (updatedChildren !== node.children) {
        return { ...node, children: updatedChildren };
      }
    }
    return node;
  });
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'SET_FLOW':
      return {
        ...state,
        flow: action.flow,
        dirty: false,
      };

    case 'SELECT_NODE':
      return {
        ...state,
        selectedNodeId: action.nodeId,
      };

    case 'ADD_NODE': {
      return {
        ...state,
        flow: {
          ...state.flow,
          nodes: [...state.flow.nodes, action.node],
        },
        positions: {
          ...state.positions,
          [action.node.id]: action.position,
        },
        dirty: true,
      };
    }

    case 'REMOVE_NODE': {
      const { nodes: updatedNodes } = removeNodeRecursive(state.flow.nodes, action.nodeId);
      return {
        ...state,
        flow: {
          ...state.flow,
          nodes: updatedNodes,
          // Remove edges connected to this node (only relevant for top-level)
          edges: state.flow.edges.filter(
            (e) => e.from !== action.nodeId && e.to !== action.nodeId,
          ),
        },
        positions: Object.fromEntries(
          Object.entries(state.positions).filter(([id]) => id !== action.nodeId),
        ),
        selectedNodeId: state.selectedNodeId === action.nodeId ? null : state.selectedNodeId,
        dirty: true,
      };
    }

    case 'UPDATE_NODE': {
      const updatedNodes = updateNodeInList(state.flow.nodes, action.nodeId, (node) => ({
        ...node,
        ...action.updates,
        // If type changed, reset type-specific config
        ...(action.updates.type && action.updates.type !== node.type
          ? {
              config: {
                ...node.config,
                presentation: action.updates.type === 'checkpoint'
                  ? { title: '', sections: [] }
                  : undefined,
                interrupts: action.updates.type === 'checkpoint' ? undefined : node.config.interrupts,
              },
              children: action.updates.type !== 'agent' ? [] : node.children,
            }
          : {}),
      }));
      return {
        ...state,
        flow: { ...state.flow, nodes: updatedNodes },
        dirty: true,
      };
    }

    case 'UPDATE_NODE_CONFIG': {
      const updatedNodes = updateNodeInList(state.flow.nodes, action.nodeId, (node) => ({
        ...node,
        config: { ...node.config, ...action.config },
      }));
      return {
        ...state,
        flow: { ...state.flow, nodes: updatedNodes },
        dirty: true,
      };
    }

    case 'ADD_EDGE': {
      // Prevent duplicate edges
      const exists = state.flow.edges.some(
        (e) => e.from === action.edge.from && e.to === action.edge.to,
      );
      if (exists) return state;

      return {
        ...state,
        flow: {
          ...state.flow,
          edges: [...state.flow.edges, action.edge],
        },
        dirty: true,
      };
    }

    case 'REMOVE_EDGE': {
      return {
        ...state,
        flow: {
          ...state.flow,
          edges: state.flow.edges.filter(
            (e) => !(e.from === action.from && e.to === action.to),
          ),
        },
        dirty: true,
      };
    }

    case 'UPDATE_FLOW_METADATA': {
      return {
        ...state,
        flow: { ...state.flow, ...action.updates },
        dirty: true,
      };
    }

    case 'SET_NODE_CHILDREN': {
      const updatedNodes = updateNodeInList(state.flow.nodes, action.nodeId, (node) => ({
        ...node,
        children: action.children,
      }));
      return {
        ...state,
        flow: { ...state.flow, nodes: updatedNodes },
        dirty: true,
      };
    }

    case 'ADD_CHILD': {
      const updatedNodes = updateNodeInList(state.flow.nodes, action.parentId, (parent) => ({
        ...parent,
        children: [...parent.children, action.child],
      }));
      return {
        ...state,
        flow: { ...state.flow, nodes: updatedNodes },
        positions: {
          ...state.positions,
          [action.child.id]: action.position,
        },
        dirty: true,
      };
    }

    case 'MOVE_NODE': {
      return {
        ...state,
        positions: {
          ...state.positions,
          [action.nodeId]: action.position,
        },
      };
    }

    case 'MARK_CLEAN':
      return { ...state, dirty: false };

    case 'CREATE_AGENT_FROM_SLASH': {
      const existingIds = collectAllNodeIds(state.flow.nodes);
      const id = generateNodeId(action.name, existingIds);
      const node = createDefaultNode('agent', id);
      node.name = action.name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

      if (action.parentId) {
        const updatedNodes = updateNodeInList(state.flow.nodes, action.parentId, (parent) => ({
          ...parent,
          children: [...parent.children, node],
        }));
        return {
          ...state,
          flow: { ...state.flow, nodes: updatedNodes },
          dirty: true,
        };
      }

      return {
        ...state,
        flow: {
          ...state.flow,
          nodes: [...state.flow.nodes, node],
        },
        dirty: true,
      };
    }

    default:
      return state;
  }
}
