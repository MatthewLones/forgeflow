import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '../../../types/canvas';

type AgentNodeType = Node<FlowNodeData, 'agent'>;

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  const { node } = data;
  const runStatus = data.runStatus ?? 'idle';
  const inputCount = node.config.inputs.length;
  const outputCount = node.config.outputs.length;
  const hasChildren = node.children.length > 0;

  const borderClass = runStatus === 'running'
    ? 'border-blue-500 node-running-glow'
    : runStatus === 'completed'
    ? 'border-emerald-500'
    : runStatus === 'failed'
    ? 'border-red-500'
    : selected
    ? 'border-[var(--color-border-selected)] shadow-md'
    : 'border-[var(--color-border)]';

  const dotClass = runStatus === 'running'
    ? 'bg-blue-500 animate-pulse'
    : runStatus === 'completed'
    ? 'bg-emerald-500'
    : runStatus === 'failed'
    ? 'bg-red-500'
    : 'bg-[var(--color-node-agent)]';

  return (
    <div
      className={`min-w-[220px] rounded-lg shadow-sm border-2 transition-all ${borderClass}`}
      style={{ background: 'linear-gradient(180deg, var(--color-node-agent-bg) 0%, #ffffff 100%)' }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-t-md border-b border-[var(--color-border)]/40">
        <div className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />
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
