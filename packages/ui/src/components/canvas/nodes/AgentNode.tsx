import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '../../../types/canvas';

type AgentNodeType = Node<FlowNodeData, 'agent'>;

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const { node } = data;
  const inputCount = node.config.inputs.length;
  const outputCount = node.config.outputs.length;
  const hasChildren = node.children.length > 0;

  return (
    <div
      className={`
        min-w-[220px] rounded-lg bg-white shadow-sm border-2 transition-colors
        ${selected ? 'border-[var(--color-border-selected)] shadow-md' : 'border-[var(--color-border)]'}
      `}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-t-md bg-[var(--color-node-agent-bg)] border-b border-[var(--color-border)]">
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-node-agent)]" />
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {node.name}
        </span>
        {hasChildren && (
          <span className="ml-auto text-[10px] font-medium text-[var(--color-node-agent)] bg-[var(--color-node-agent)]/10 px-1.5 py-0.5 rounded">
            {node.children.length} sub
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
        {inputCount > 0 && (
          <span>{inputCount} input{inputCount !== 1 ? 's' : ''}</span>
        )}
        {outputCount > 0 && (
          <span>{outputCount} output{outputCount !== 1 ? 's' : ''}</span>
        )}
        {node.config.skills.length > 0 && (
          <span className="text-[var(--color-text-muted)]">
            {node.config.skills.length} skill{node.config.skills.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-[var(--color-node-agent)] !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-[var(--color-node-agent)] !border-2 !border-white" />
    </div>
  );
});
