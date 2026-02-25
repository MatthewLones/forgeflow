import { useCallback, useRef } from 'react';
import type { LayoutSplit, LayoutNode } from '../../lib/layout-tree';
import { ResizeHandle } from './ResizeHandle';

interface SplitContainerProps {
  node: LayoutSplit;
  path: number[];
  onResize: (path: number[], sizes: number[]) => void;
  renderNode: (node: LayoutNode, path: number[]) => React.ReactNode;
}

export function SplitContainer({ node, path, onResize, renderNode }: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isHorizontal = node.direction === 'horizontal';

  const makeResizeStartHandler = useCallback(
    (handleIndex: number) => () => {
      // Snapshot the current sizes at drag start
      return [...node.sizes];
    },
    [node.sizes],
  );

  const makeResizeMoveHandler = useCallback(
    (handleIndex: number) => (initialSizes: number[], delta: number) => {
      const container = containerRef.current;
      if (!container) return;

      const containerSize = isHorizontal
        ? container.offsetWidth
        : container.offsetHeight;
      if (containerSize === 0) return;

      const deltaFraction = delta / containerSize;
      const sizes = [...initialSizes];
      const minSize = 0.1;

      const newLeft = sizes[handleIndex] + deltaFraction;
      const newRight = sizes[handleIndex + 1] - deltaFraction;

      if (newLeft < minSize || newRight < minSize) return;

      sizes[handleIndex] = newLeft;
      sizes[handleIndex + 1] = newRight;
      onResize(path, sizes);
    },
    [isHorizontal, onResize, path],
  );

  const handleResizeEnd = useCallback(() => {
    // No-op for now; sizes are already committed on each move
  }, []);

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full overflow-hidden ${
        isHorizontal ? 'flex-row' : 'flex-col'
      }`}
    >
      {node.children.map((child, i) => (
        <SplitChild
          key={i}
          index={i}
          node={node}
          child={child}
          path={path}
          isHorizontal={isHorizontal}
          isLast={i === node.children.length - 1}
          onResizeStart={makeResizeStartHandler(i)}
          onResizeMove={makeResizeMoveHandler(i)}
          onResizeEnd={handleResizeEnd}
          renderNode={renderNode}
        />
      ))}
    </div>
  );
}

function SplitChild({
  index,
  node,
  child,
  path,
  isHorizontal,
  isLast,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  renderNode,
}: {
  index: number;
  node: LayoutSplit;
  child: LayoutNode;
  path: number[];
  isHorizontal: boolean;
  isLast: boolean;
  onResizeStart: () => number[];
  onResizeMove: (initialSizes: number[], delta: number) => void;
  onResizeEnd: () => void;
  renderNode: (node: LayoutNode, path: number[]) => React.ReactNode;
}) {
  const size = node.sizes[index];
  const style = isHorizontal
    ? { width: `${size * 100}%`, height: '100%' }
    : { height: `${size * 100}%`, width: '100%' };

  return (
    <>
      <div style={style} className="overflow-hidden shrink-0">
        {renderNode(child, [...path, index])}
      </div>
      {!isLast && (
        <ResizeHandle
          direction={node.direction}
          onResizeStart={onResizeStart}
          onResizeMove={onResizeMove}
          onResizeEnd={onResizeEnd}
        />
      )}
    </>
  );
}
