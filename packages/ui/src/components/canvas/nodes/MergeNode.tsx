import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '../../../types/canvas';

type MergeNodeType = Node<FlowNodeData, 'merge'>;

export const MergeNode = memo(function MergeNode({ data, selected }: NodeProps<MergeNodeType>) {
  const { node } = data;

  return (
    <div
      className={`
        min-w-[220px] rounded-lg shadow-sm border-2 transition-all
        ${selected ? 'border-[var(--color-border-selected)] shadow-md' : 'border-[var(--color-border)]'}
      `}
      style={{ background: 'linear-gradient(180deg, var(--color-node-merge-bg) 0%, #ffffff 100%)' }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-t-md border-b border-[var(--color-border)]/40">
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-node-merge)] flex items-center justify-center">
          <div className="w-1.5 h-0.5 bg-white rounded-full" />
        </div>
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {node.name}
        </span>
        <span className="ml-auto text-[10px] font-medium text-[var(--color-node-merge)] bg-[var(--color-node-merge)]/10 px-1.5 py-0.5 rounded">
          merge
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
        {node.config.inputs.length > 0 && (
          <span>Collects {node.config.inputs.length} input{node.config.inputs.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-[var(--color-node-merge)] !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-[var(--color-node-merge)] !border-2 !border-white" />
    </div>
  );
});
