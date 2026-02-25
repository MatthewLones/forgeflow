import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '../../../types/canvas';

type CheckpointNodeType = Node<FlowNodeData, 'checkpoint'>;

export const CheckpointNode = memo(function CheckpointNode({ data, selected }: NodeProps<CheckpointNodeType>) {
  const { node } = data;
  const title = node.config.presentation?.title;

  return (
    <div
      className={`
        min-w-[220px] rounded-lg bg-white shadow-sm border-2 transition-colors
        ${selected ? 'border-[var(--color-border-selected)] shadow-md' : 'border-[var(--color-border)]'}
      `}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-t-md bg-[var(--color-node-checkpoint-bg)] border-b border-[var(--color-border)]">
        <div className="w-2.5 h-2.5 rounded-sm bg-[var(--color-node-checkpoint)]" />
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {node.name}
        </span>
        <span className="ml-auto text-[10px] font-medium text-[var(--color-node-checkpoint)] bg-[var(--color-node-checkpoint)]/10 px-1.5 py-0.5 rounded">
          pause
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
        {title && <div className="truncate">{title}</div>}
        {!title && <div className="text-[var(--color-text-muted)] italic">Human review point</div>}
      </div>

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-[var(--color-node-checkpoint)] !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-[var(--color-node-checkpoint)] !border-2 !border-white" />
    </div>
  );
});
