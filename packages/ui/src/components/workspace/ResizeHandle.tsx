import { useCallback, useState, useRef } from 'react';
import type { SplitDirection } from '../../lib/layout-tree';

interface ResizeHandleProps {
  direction: SplitDirection;
  onResizeStart: () => number[];  // returns initial sizes snapshot
  onResizeMove: (initialSizes: number[], delta: number) => void;
  onResizeEnd: () => void;
}

export function ResizeHandle({ direction, onResizeStart, onResizeMove, onResizeEnd }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const isHorizontal = direction === 'horizontal';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startPos = isHorizontal ? e.clientX : e.clientY;
      const initialSizes = onResizeStart();

      const onMove = (ev: MouseEvent) => {
        const currentPos = isHorizontal ? ev.clientX : ev.clientY;
        const delta = currentPos - startPos;
        onResizeMove(initialSizes, delta);
      };

      const onUp = () => {
        setIsDragging(false);
        onResizeEnd();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [isHorizontal, onResizeStart, onResizeMove, onResizeEnd],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`shrink-0 transition-colors ${
        isHorizontal
          ? `w-1 cursor-col-resize hover:bg-[var(--color-node-agent)]/30 ${isDragging ? 'bg-[var(--color-node-agent)]/40' : ''}`
          : `h-1 cursor-row-resize hover:bg-[var(--color-node-agent)]/30 ${isDragging ? 'bg-[var(--color-node-agent)]/40' : ''}`
      }`}
    />
  );
}
