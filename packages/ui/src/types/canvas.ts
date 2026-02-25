import type { FlowNode } from '@forgeflow/types';
import type { Node } from '@xyflow/react';

/** Data attached to each React Flow node */
export type FlowNodeData = {
  node: FlowNode;
  [key: string]: unknown;
};

/** Typed React Flow node for our flow nodes */
export type FlowReactNode = Node<FlowNodeData>;

/** Node positions stored separately from FlowDefinition */
export interface CanvasState {
  nodePositions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number };
}
