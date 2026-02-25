import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { FlowDefinition, FlowNode, FlowEdge, NodeConfig, NodeType, ArtifactSchema } from '@forgeflow/types';
import {
  flowReducer,
  createDefaultNode,
  generateNodeId,
  type FlowState,
  type FlowAction,
} from './FlowReducer';

interface FlowContextValue {
  state: FlowState;
  dispatch: Dispatch<FlowAction>;

  selectedNode: FlowNode | null;
  selectNode: (nodeId: string | null) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (nodeId: string, updates: Partial<Pick<FlowNode, 'name' | 'instructions' | 'type'>>) => void;
  updateNodeConfig: (nodeId: string, config: Partial<NodeConfig>) => void;
  addEdge: (edge: FlowEdge) => void;
  removeEdge: (from: string, to: string) => void;
  removeAutoEdge: (from: string, to: string) => void;
  addChild: (parentId: string, position: { x: number; y: number }) => void;
  createAgentByName: (name: string, parentId?: string) => void;
  addArtifact: (artifact: ArtifactSchema) => void;
  updateArtifact: (name: string, updates: Partial<ArtifactSchema>) => void;
  removeArtifact: (name: string) => void;
}

const FlowContext = createContext<FlowContextValue | null>(null);

interface FlowProviderProps {
  flow: FlowDefinition;
  positions: Record<string, { x: number; y: number }>;
  children: ReactNode;
}

/** Find a node by ID (searches recursively in children) */
function findNodeById(nodes: FlowNode[], id: string): FlowNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Collect all node IDs including nested children */
function collectAllIds(nodes: FlowNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: FlowNode[]) {
    for (const n of list) {
      ids.add(n.id);
      walk(n.children);
    }
  }
  walk(nodes);
  return ids;
}

export function FlowProvider({ flow, positions, children }: FlowProviderProps) {
  const [state, dispatch] = useReducer(flowReducer, {
    flow,
    positions,
    selectedNodeId: null,
    dirty: false,
  });

  const selectedNode = state.selectedNodeId
    ? findNodeById(state.flow.nodes, state.selectedNodeId)
    : null;

  const selectNode = useCallback(
    (nodeId: string | null) => dispatch({ type: 'SELECT_NODE', nodeId }),
    [],
  );

  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const existingIds = collectAllIds(state.flow.nodes);
      const id = generateNodeId(
        type === 'agent' ? 'new_agent' : type === 'checkpoint' ? 'new_checkpoint' : 'new_merge',
        existingIds,
      );
      const node = createDefaultNode(type, id);
      dispatch({ type: 'ADD_NODE', node, position });
    },
    [state.flow.nodes],
  );

  const removeNode = useCallback(
    (nodeId: string) => dispatch({ type: 'REMOVE_NODE', nodeId }),
    [],
  );

  const updateNode = useCallback(
    (nodeId: string, updates: Partial<Pick<FlowNode, 'name' | 'instructions' | 'type'>>) =>
      dispatch({ type: 'UPDATE_NODE', nodeId, updates }),
    [],
  );

  const updateNodeConfig = useCallback(
    (nodeId: string, config: Partial<NodeConfig>) =>
      dispatch({ type: 'UPDATE_NODE_CONFIG', nodeId, config }),
    [],
  );

  const addEdge = useCallback(
    (edge: FlowEdge) => dispatch({ type: 'ADD_EDGE', edge }),
    [],
  );

  const removeEdge = useCallback(
    (from: string, to: string) => dispatch({ type: 'REMOVE_EDGE', from, to }),
    [],
  );

  const removeAutoEdge = useCallback(
    (from: string, to: string) => dispatch({ type: 'REMOVE_AUTO_EDGE', from, to }),
    [],
  );

  const addChild = useCallback(
    (parentId: string, position: { x: number; y: number }) => {
      const existingIds = collectAllIds(state.flow.nodes);
      const id = generateNodeId('sub_agent', existingIds);
      const child = createDefaultNode('agent', id);
      dispatch({ type: 'ADD_CHILD', parentId, child, position });
    },
    [state.flow.nodes],
  );

  const createAgentByName = useCallback(
    (name: string, parentId?: string) => {
      dispatch({ type: 'CREATE_AGENT_FROM_SLASH', name, parentId });
    },
    [],
  );

  const addArtifact = useCallback(
    (artifact: ArtifactSchema) => dispatch({ type: 'ADD_ARTIFACT', artifact }),
    [],
  );

  const updateArtifact = useCallback(
    (name: string, updates: Partial<ArtifactSchema>) =>
      dispatch({ type: 'UPDATE_ARTIFACT', name, updates }),
    [],
  );

  const removeArtifact = useCallback(
    (name: string) => dispatch({ type: 'REMOVE_ARTIFACT', name }),
    [],
  );

  return (
    <FlowContext.Provider
      value={{
        state,
        dispatch,
        selectedNode,
        selectNode,
        addNode,
        removeNode,
        updateNode,
        updateNodeConfig,
        addEdge,
        removeEdge,
        removeAutoEdge,
        addChild,
        createAgentByName,
        addArtifact,
        updateArtifact,
        removeArtifact,
      }}
    >
      {children}
    </FlowContext.Provider>
  );
}

export function useFlow(): FlowContextValue {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error('useFlow must be used within FlowProvider');
  return ctx;
}
