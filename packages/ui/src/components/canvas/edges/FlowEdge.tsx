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
  } = props;

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
        stroke: selected ? 'var(--color-border-selected)' : 'var(--color-text-muted)',
        strokeWidth: selected ? 2 : 1.5,
      }}
    />
  );
});
