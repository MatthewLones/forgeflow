import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowNode, FlowEdge as FlowEdgeType } from '@forgeflow/types';
import type { NodeRunStatus } from '../../context/RunContext';
import {
  autoLayout,
  flowNodesToReactFlow,
  flowEdgesToReactFlow,
} from '../../lib/flow-to-reactflow';
import { AgentNode } from '../canvas/nodes/AgentNode';
import { CheckpointNode } from '../canvas/nodes/CheckpointNode';
import { FlowEdge } from '../canvas/edges/FlowEdge';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  checkpoint: CheckpointNode,
};

const edgeTypes: EdgeTypes = {
  flow: FlowEdge,
};

export function DashboardDAG({
  nodes,
  edges,
  nodeStatuses,
  selectedNodeId,
  onNodeClick,
  onNodeDoubleClick,
}: {
  nodes: FlowNode[];
  edges: FlowEdgeType[];
  nodeStatuses: Record<string, NodeRunStatus>;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string | null) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
}) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [rfNodes, setRfNodes] = useState<Node[]>([]);

  useEffect(() => {
    let cancelled = false;
    autoLayout(nodes, edges).then((pos) => {
      if (!cancelled) setPositions(pos);
    });
    return () => { cancelled = true; };
  }, [nodes, edges]);

  // Rebuild nodes when data changes (positions, statuses, selection)
  useEffect(() => {
    const n = flowNodesToReactFlow(nodes, positions);
    setRfNodes(n.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        runStatus: nodeStatuses[node.id] ?? 'idle',
      },
    })));
  }, [nodes, positions, nodeStatuses, selectedNodeId]);

  // Apply node changes (drag, select) in real-time
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nds) => applyNodeChanges(changes, nds));
    },
    [],
  );

  const rfEdges = useMemo(
    () => flowEdgesToReactFlow(edges),
    [edges],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => {
      onNodeClick(node.id === selectedNodeId ? null : node.id);
    },
    [onNodeClick, selectedNodeId],
  );

  const handleNodeDblClick: NodeMouseHandler = useCallback(
    (_e, node) => { onNodeDoubleClick?.(node.id); },
    [onNodeDoubleClick],
  );

  const handlePaneClick = useCallback(() => {
    onNodeClick(null);
  }, [onNodeClick]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDblClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag
        zoomOnScroll
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={0.5} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
