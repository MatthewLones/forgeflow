import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
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
}: {
  nodes: FlowNode[];
  edges: FlowEdgeType[];
  nodeStatuses: Record<string, NodeRunStatus>;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string | null) => void;
}) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    let cancelled = false;
    autoLayout(nodes, edges).then((pos) => {
      if (!cancelled) setPositions(pos);
    });
    return () => { cancelled = true; };
  }, [nodes, edges]);

  const rfNodes = useMemo(
    () => {
      const n = flowNodesToReactFlow(nodes, positions);
      return n.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          runStatus: nodeStatuses[node.id] ?? 'idle',
        },
      }));
    },
    [nodes, positions, nodeStatuses, selectedNodeId],
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

  const handlePaneClick = useCallback(() => {
    onNodeClick(null);
  }, [onNodeClick]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      nodesDraggable={false}
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
  );
}
