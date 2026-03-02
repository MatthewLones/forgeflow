import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '../../../types/canvas';

type CheckpointNodeType = Node<FlowNodeData, 'checkpoint'>;

export const CheckpointNode = memo(function CheckpointNode({ data, selected }: NodeProps<CheckpointNodeType>) {
  const { node } = data;
  const runStatus = data.runStatus ?? 'idle';
  const title = node.config.presentation?.title;

  const borderClass = runStatus === 'waiting'
    ? 'border-amber-500 node-waiting-glow'
    : runStatus === 'completed'
    ? 'border-emerald-500'
    : runStatus === 'failed'
    ? 'border-red-500'
    : selected
    ? 'border-[var(--color-border-selected)] shadow-md'
    : 'border-[var(--color-border)]';

  const dotClass = runStatus === 'waiting'
    ? 'bg-amber-500 animate-pulse'
    : runStatus === 'completed'
    ? 'bg-emerald-500'
    : runStatus === 'failed'
    ? 'bg-red-500'
    : 'bg-[var(--color-node-checkpoint)]';

  const badgeLabel = runStatus === 'waiting' ? 'awaiting input' : 'pause';
  const badgeColor = runStatus === 'waiting'
    ? 'text-amber-600 bg-amber-100'
    : 'text-[var(--color-node-checkpoint)] bg-[var(--color-node-checkpoint)]/10';

  return (
    <div
      className={`min-w-[220px] rounded-lg shadow-sm border-2 transition-all ${borderClass}`}
      style={{ background: 'linear-gradient(180deg, var(--color-node-checkpoint-bg) 0%, #ffffff 100%)' }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-t-md border-b border-[var(--color-border)]/40">
        <div className={`w-2.5 h-2.5 rounded-sm ${dotClass}`} />
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {node.name}
        </span>
        <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded ${badgeColor}`}>
          {badgeLabel}
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
