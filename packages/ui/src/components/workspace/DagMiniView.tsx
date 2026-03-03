import { useState, useRef, useMemo, useCallback, useEffect, Fragment } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useReactFlow,
  applyNodeChanges,
  type NodeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
  type NodeChange,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowNode } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { useDag } from '../../context/DagContext';
import { useLayout } from '../../context/LayoutContext';
import { useRun } from '../../context/RunContext';
import {
  autoLayout,
  childrenLayout,
  flowNodesToReactFlow,
  flowEdgesToReactFlow,
} from '../../lib/flow-to-reactflow';
import {
  createDefaultNode,
  generateNodeId,
  collectAllNodeIds,
} from '../../context/FlowReducer';
import { AgentNode } from '../canvas/nodes/AgentNode';
import { CheckpointNode } from '../canvas/nodes/CheckpointNode';
import { FlowEdge } from '../canvas/edges/FlowEdge';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  checkpoint: CheckpointNode,
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

/** Expand icon (arrows pointing outward) */
function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9,1 13,1 13,5" />
      <polyline points="5,13 1,13 1,9" />
      <line x1="13" y1="1" x2="8" y2="6" />
      <line x1="1" y1="13" x2="6" y2="8" />
    </svg>
  );
}

/** Collapse icon (arrows pointing inward) */
function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,10 1,13" />
      <polyline points="10,4 13,1" />
      <polyline points="10,1 10,4 13,4" />
      <polyline points="4,13 4,10 1,10" />
    </svg>
  );
}

export function DagMiniView(props: { height?: number }) {
  const { state, selectNode, addNode, removeNode, addChild, addEdge, clearLayout, dispatch } = useFlow();
  const { dagBreadcrumb, dagDrillIn, dagDrillOut, dagDrillForward, dagDrillRoot, canGoForward } = useDag();
  const { activeTabId, selectAgent } = useLayout();
  const { run } = useRun();
  const [fullscreen, setFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fullscreen]);

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

  // Positions: use state.positions at root level, childrenLayout for drilled-in views
  const positions = useMemo(() => {
    if (displayData.isChildren) {
      return childrenLayout(displayData.nodes, state.positions);
    }
    // At root level, positions come from FlowReducer state (loaded from flow.layout or auto-computed)
    const result: Record<string, { x: number; y: number }> = {};
    for (const node of displayData.nodes) {
      result[node.id] = state.positions[node.id] ?? { x: 0, y: 0 };
    }
    return result;
  }, [displayData, state.positions]);

  // Manage nodes as state so React Flow can update positions during drag
  const [rfNodes, setRfNodes] = useState<Node[]>([]);

  // Sync rfNodes when source data changes
  useEffect(() => {
    const nodes = flowNodesToReactFlow(displayData.nodes, positions);
    setRfNodes(
      nodes.map((n) => ({
        ...n,
        selected: n.id === activeTabId,
        data: {
          ...n.data,
          runStatus: run.nodeStatuses[n.id] ?? 'idle',
        },
      })),
    );
  }, [displayData.nodes, positions, activeTabId, run.nodeStatuses]);

  // Apply node changes (drag, select) in real-time
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nds) => applyNodeChanges(changes, nds));
    },
    [],
  );

  const rfEdges = useMemo(
    () => {
      const edges = flowEdgesToReactFlow(displayData.edges);
      if (activeTabId) {
        return edges.map((e) => ({
          ...e,
          data: { ...e.data, selectedNodeId: activeTabId },
        }));
      }
      return edges;
    },
    [displayData.edges, activeTabId],
  );

  // Dismiss context menu on any interaction
  const dismissContextMenu = useCallback(() => setContextMenu(null), []);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      dismissContextMenu();
      const flowNode = findNode(state.flow.nodes, node.id);
      selectAgent(node.id, flowNode?.name);
      selectNode(node.id);
    },
    [selectAgent, selectNode, state.flow.nodes, dismissContextMenu],
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

  // Persist position on drag stop
  const handleNodeDragStop: NodeMouseHandler = useCallback(
    (_event, node) => {
      dispatch({
        type: 'MOVE_NODE',
        nodeId: node.id,
        position: node.position,
      });
    },
    [dispatch],
  );

  // Rich right-click context menu for nodes
  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      const flowNode = findNode(state.flow.nodes, node.id);
      if (!flowNode) return;

      const existingIds = collectAllNodeIds(state.flow.nodes);

      const items: ContextMenuEntry[] = [
        {
          label: 'Open',
          onClick: () => {
            selectAgent(node.id, flowNode.name);
            selectNode(node.id);
          },
        },
        { separator: true },
        {
          label: 'Add Agent After',
          onClick: () => {
            const id = generateNodeId('new_agent', existingIds);
            const newNode = createDefaultNode('agent', id);
            const pos = { x: node.position.x + 300, y: node.position.y };
            dispatch({ type: 'ADD_NODE', node: newNode, position: pos });
            dispatch({ type: 'ADD_EDGE', edge: { from: node.id, to: id } });
          },
        },
        {
          label: 'Add Checkpoint After',
          onClick: () => {
            const id = generateNodeId('new_checkpoint', existingIds);
            const newNode = createDefaultNode('checkpoint', id);
            const pos = { x: node.position.x + 300, y: node.position.y };
            dispatch({ type: 'ADD_NODE', node: newNode, position: pos });
            dispatch({ type: 'ADD_EDGE', edge: { from: node.id, to: id } });
          },
        },
      ];

      // Add Sub-Agent (only for agent nodes)
      if (flowNode.type === 'agent') {
        items.push({
          label: 'Add Sub-Agent',
          onClick: () => addChild(node.id, { x: 0, y: 0 }),
        });
      }

      items.push({ separator: true });

      // Duplicate
      items.push({
        label: 'Duplicate',
        onClick: () => {
          const id = generateNodeId(flowNode.id, existingIds);
          const clone = JSON.parse(JSON.stringify(flowNode)) as FlowNode;
          clone.id = id;
          clone.name = `${flowNode.name} (copy)`;
          const pos = { x: node.position.x + 40, y: node.position.y + 40 };
          dispatch({ type: 'ADD_NODE', node: clone, position: pos });
        },
      });

      items.push({ separator: true });

      // Drill In/Out
      if (flowNode.children.length > 0) {
        items.push({ label: 'Drill In', onClick: () => dagDrillIn(node.id) });
      }
      if (dagBreadcrumb.length > 0) {
        items.push({ label: 'Drill Out', onClick: dagDrillOut });
      }

      // Delete
      items.push({ separator: true });
      items.push({
        label: 'Delete',
        danger: true,
        onClick: () => removeNode(node.id),
      });

      setContextMenu({
        x: (event as unknown as React.MouseEvent).clientX,
        y: (event as unknown as React.MouseEvent).clientY,
        items,
      });
    },
    [state.flow.nodes, selectAgent, selectNode, addChild, removeNode, dagDrillIn, dagDrillOut, dagBreadcrumb, dispatch],
  );

  // Canvas-level right-click context menu
  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();

      const flowPos = rfInstance
        ? rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : { x: 0, y: 0 };

      const items: ContextMenuEntry[] = [
        {
          label: 'Add Agent Here',
          onClick: () => addNode('agent', flowPos),
        },
        {
          label: 'Add Checkpoint Here',
          onClick: () => addNode('checkpoint', flowPos),
        },
        { separator: true },
        {
          label: 'Auto-Layout',
          onClick: async () => {
            const newPositions = await autoLayout(
              displayData.nodes,
              displayData.edges,
            );
            // Clear saved layout first, then set new positions
            dispatch({ type: 'CLEAR_LAYOUT' });
            for (const [nodeId, pos] of Object.entries(newPositions)) {
              dispatch({ type: 'MOVE_NODE', nodeId, position: pos });
            }
          },
        },
        {
          label: 'Fit View',
          onClick: () => rfInstance?.fitView({ padding: 0.3, duration: 300 }),
        },
      ];

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items,
      });
    },
    [rfInstance, addNode, displayData, dispatch],
  );

  const breadcrumbNames = useMemo(() => {
    return dagBreadcrumb.map((id) => {
      const node = findNode(state.flow.nodes, id);
      return { id, name: node?.name ?? id };
    });
  }, [dagBreadcrumb, state.flow.nodes]);

  // Fullscreen uses larger controls
  const ctrlSize = fullscreen ? 'text-xs px-2.5 py-1' : 'text-[10px] px-1.5 py-0.5';
  const crumbSize = fullscreen ? 'text-xs' : 'text-[10px]';

  const containerClass = fullscreen
    ? 'fixed inset-0 z-50 bg-[var(--color-canvas-bg)]'
    : 'border-b border-[var(--color-border)] bg-[var(--color-canvas-bg)] relative';

  const containerStyle = fullscreen
    ? undefined
    : { height: props.height ?? 128 };

  return (
    <div ref={containerRef} className={containerClass} style={containerStyle}>
      {/* Breadcrumbs */}
      {dagBreadcrumb.length > 0 && (
        <div className={`absolute top-2 left-3 z-10 flex items-center gap-1 ${crumbSize} bg-white/80 backdrop-blur-sm rounded-md px-2 py-1 shadow-sm`}>
          <button
            type="button"
            onClick={dagDrillRoot}
            className="text-[var(--color-node-agent)] hover:underline font-medium"
          >
            Root
          </button>
          {breadcrumbNames.map((crumb, i) => (
            <Fragment key={crumb.id}>
              <span className="text-[var(--color-text-muted)]">/</span>
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

      {/* Top-right controls */}
      <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5">
        {dagBreadcrumb.length > 0 && (
          <button
            type="button"
            onClick={dagDrillOut}
            className={`${ctrlSize} text-[var(--color-text-muted)] hover:text-[var(--color-node-agent)] bg-white/80 backdrop-blur-sm rounded-md shadow-sm transition-colors`}
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={() => setFullscreen((f) => !f)}
          title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          className={`${ctrlSize} text-[var(--color-text-muted)] hover:text-[var(--color-node-agent)] bg-white/80 backdrop-blur-sm rounded-md shadow-sm transition-colors flex items-center gap-1`}
        >
          {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>

      <ReactFlow
        key={`${dagBreadcrumb.join('/')}:${fullscreen}`}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={setRfInstance}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={dismissContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onMoveStart={dismissContextMenu}
        fitView
        fitViewOptions={{ padding: fullscreen ? 0.4 : 0.3 }}
        panOnDrag
        zoomOnScroll
        zoomOnDoubleClick={false}
        zoomOnPinch
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        snapToGrid
        snapGrid={[20, 20]}
        minZoom={0.1}
        maxZoom={fullscreen ? 2 : 1}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--color-text-muted)" />
        <FitViewOnResize />
      </ReactFlow>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
