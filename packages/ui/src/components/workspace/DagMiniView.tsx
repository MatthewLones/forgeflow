import { useMemo, useCallback, useEffect, Fragment } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowNode } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { useDag } from '../../context/DagContext';
import { useLayout } from '../../context/LayoutContext';
import {
  autoLayout,
  childrenLayout,
  flowNodesToReactFlow,
  flowEdgesToReactFlow,
} from '../../lib/flow-to-reactflow';
import { AgentNode } from '../canvas/nodes/AgentNode';
import { CheckpointNode } from '../canvas/nodes/CheckpointNode';
import { MergeNode } from '../canvas/nodes/MergeNode';
import { FlowEdge } from '../canvas/edges/FlowEdge';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  checkpoint: CheckpointNode,
  merge: MergeNode,
};

const edgeTypes: EdgeTypes = {
  flow: FlowEdge,
};

/** Find a node by ID in a recursive tree */
function findNode(nodes: FlowNode[], id: string): FlowNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Re-fits the viewport whenever the ReactFlow container resizes */
function FitViewOnResize() {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const container = document.querySelector('.react-flow') as HTMLElement | null;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      fitView({ padding: 0.3, duration: 150 });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitView]);

  return null;
}

export function DagMiniView(props: { height?: number }) {
  const { state, selectNode } = useFlow();
  const { dagBreadcrumb, dagDrillIn, dagDrillOut, dagDrillRoot } = useDag();
  const { activeTabId, selectAgent } = useLayout();

  // Resolve which nodes/edges to display based on breadcrumb
  const displayData = useMemo(() => {
    if (dagBreadcrumb.length === 0) {
      return { nodes: state.flow.nodes, edges: state.flow.edges, isChildren: false };
    }
    let current = state.flow.nodes;
    let targetNode: FlowNode | null = null;
    for (const id of dagBreadcrumb) {
      targetNode = current.find((n) => n.id === id) ?? null;
      if (!targetNode) break;
      current = targetNode.children;
    }
    if (targetNode && targetNode.children.length > 0) {
      return { nodes: targetNode.children, edges: [], isChildren: true };
    }
    return { nodes: state.flow.nodes, edges: state.flow.edges, isChildren: false };
  }, [state.flow.nodes, state.flow.edges, dagBreadcrumb]);

  const positions = useMemo(() => {
    if (displayData.isChildren) {
      return childrenLayout(displayData.nodes, {});
    }
    return autoLayout(displayData.nodes, displayData.edges);
  }, [displayData]);

  const rfNodes = useMemo(
    () => {
      const nodes = flowNodesToReactFlow(displayData.nodes, positions);
      if (activeTabId) {
        return nodes.map((n) => ({ ...n, selected: n.id === activeTabId }));
      }
      return nodes;
    },
    [displayData.nodes, positions, activeTabId],
  );

  const rfEdges = useMemo(
    () => flowEdgesToReactFlow(displayData.edges),
    [displayData.edges],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const flowNode = findNode(state.flow.nodes, node.id);
      selectAgent(node.id, flowNode?.name);
      selectNode(node.id);
    },
    [selectAgent, selectNode, state.flow.nodes],
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const flowNode = findNode(state.flow.nodes, node.id);
      if (flowNode && flowNode.children.length > 0) {
        dagDrillIn(node.id);
      }
    },
    [dagDrillIn, state.flow.nodes],
  );

  const breadcrumbNames = useMemo(() => {
    return dagBreadcrumb.map((id) => {
      const node = findNode(state.flow.nodes, id);
      return { id, name: node?.name ?? id };
    });
  }, [dagBreadcrumb, state.flow.nodes]);

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-canvas-bg)] relative" style={{ height: props.height ?? 128 }}>
      {dagBreadcrumb.length > 0 && (
        <div className="absolute top-1 left-2 z-10 flex items-center gap-1 text-[10px] bg-white/80 backdrop-blur-sm rounded px-1.5 py-0.5">
          <button
            type="button"
            onClick={dagDrillRoot}
            className="text-[var(--color-node-agent)] hover:underline font-medium"
          >
            Root
          </button>
          {breadcrumbNames.map((crumb, i) => (
            <Fragment key={crumb.id}>
              <span className="text-[var(--color-text-muted)]">&gt;</span>
              {i === breadcrumbNames.length - 1 ? (
                <span className="text-[var(--color-text-primary)] font-medium">{crumb.name}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    dagDrillRoot();
                    for (let j = 0; j <= i; j++) {
                      dagDrillIn(dagBreadcrumb[j]);
                    }
                  }}
                  className="text-[var(--color-node-agent)] hover:underline font-medium"
                >
                  {crumb.name}
                </button>
              )}
            </Fragment>
          ))}
        </div>
      )}

      {dagBreadcrumb.length > 0 && (
        <button
          type="button"
          onClick={dagDrillOut}
          className="absolute top-1 right-2 z-10 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-node-agent)] bg-white/80 backdrop-blur-sm rounded px-1.5 py-0.5 transition-colors"
        >
          Back
        </button>
      )}

      <ReactFlow
        key={dagBreadcrumb.join('/')}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        panOnDrag
        zoomOnScroll
        zoomOnDoubleClick={false}
        zoomOnPinch
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.1}
        maxZoom={1}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={0.5} />
        <FitViewOnResize />
      </ReactFlow>
    </div>
  );
}
