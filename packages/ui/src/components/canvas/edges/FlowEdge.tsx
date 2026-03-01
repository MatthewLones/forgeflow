import { memo } from 'react';
import { BaseEdge, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

export const FlowEdge = memo(function FlowEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    source,
    target,
    selected,
    data,
  } = props;

  const edgeData = data as Record<string, unknown> | undefined;
  const isAuto = edgeData?.auto === true;
  const selectedNodeId = edgeData?.selectedNodeId as string | undefined;

  const isIncoming = selectedNodeId != null && target === selectedNodeId;
  const isOutgoing = selectedNodeId != null && source === selectedNodeId;

  let stroke = 'var(--color-text-muted)';
  let strokeWidth = 1.5;

  if (selected) {
    stroke = 'var(--color-border-selected)';
    strokeWidth = 2;
  } else if (isIncoming) {
    stroke = '#6366f1';
    strokeWidth = 2;
  } else if (isOutgoing) {
    stroke = '#10b981';
    strokeWidth = 2;
  }

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <BaseEdge
      {...props}
      path={edgePath}
      style={{
        stroke,
        strokeWidth,
        strokeDasharray: isAuto ? '6 3' : undefined,
      }}
    />
  );
});
