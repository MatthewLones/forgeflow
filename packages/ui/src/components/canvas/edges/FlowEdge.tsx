import { memo } from 'react';
import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

export const FlowEdge = memo(function FlowEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    data,
  } = props;

  const isAuto = (data as Record<string, unknown>)?.auto === true;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  return (
    <BaseEdge
      {...props}
      path={edgePath}
      style={{
        stroke: selected
          ? 'var(--color-border-selected)'
          : isAuto
            ? 'var(--color-node-agent)'
            : 'var(--color-text-muted)',
        strokeWidth: selected ? 2 : 1.5,
        strokeDasharray: isAuto ? '6 3' : undefined,
      }}
    />
  );
});
