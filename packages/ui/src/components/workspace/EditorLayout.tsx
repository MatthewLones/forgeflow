import { useCallback, useState, useEffect } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useWorkspace, type EditorTab } from '../../context/WorkspaceContext';
import type { LayoutNode } from '../../lib/layout-tree';
import { getAllGroupIds } from '../../lib/layout-tree';
import { SplitContainer } from './SplitContainer';
import { EditorGroupPanel } from './EditorGroupPanel';

export function EditorLayout() {
  const {
    layout,
    groups,
    activeGroupId,
    reorderTab,
    moveTabToGroup,
    splitGroup,
    resizeSplit,
    setActiveGroup,
  } = useWorkspace();

  const [draggedTab, setDraggedTab] = useState<{ tab: EditorTab; groupId: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const tabData = active.data.current?.tab as EditorTab | undefined;
    const sortableData = active.data.current?.sortable;
    if (tabData && sortableData) {
      setDraggedTab({ tab: tabData, groupId: sortableData.containerId });
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setDraggedTab(null);

      if (!over) return;

      const activeData = active.data.current;
      const overData = over.data.current;

      // Handle drop on a drop zone (split/move)
      if (overData?.type === 'dropzone') {
        const sourceGroupId = activeData?.sortable?.containerId as string | undefined;
        const targetGroupId = overData.groupId as string;
        const zone = overData.zone as string;
        const tabId = active.id as string;

        if (!sourceGroupId) return;

        if (zone === 'center' && sourceGroupId !== targetGroupId) {
          moveTabToGroup(tabId, sourceGroupId, targetGroupId);
        } else if (zone === 'left' || zone === 'right') {
          if (sourceGroupId === targetGroupId) {
            splitGroup(targetGroupId, 'horizontal');
          } else {
            splitGroup(targetGroupId, 'horizontal', tabId, sourceGroupId);
          }
        } else if (zone === 'top' || zone === 'bottom') {
          if (sourceGroupId === targetGroupId) {
            splitGroup(targetGroupId, 'vertical');
          } else {
            splitGroup(targetGroupId, 'vertical', tabId, sourceGroupId);
          }
        }
        return;
      }

      // Handle tab reordering within/across groups
      const sourceGroupId = activeData?.sortable?.containerId as string | undefined;
      const targetGroupId = overData?.sortable?.containerId as string | undefined;

      if (!sourceGroupId || !targetGroupId) return;

      if (sourceGroupId === targetGroupId) {
        const group = groups[sourceGroupId];
        if (!group) return;
        const oldIndex = group.tabs.findIndex((t) => t.id === active.id);
        const newIndex = group.tabs.findIndex((t) => t.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          reorderTab(sourceGroupId, oldIndex, newIndex);
        }
      } else {
        const targetGroup = groups[targetGroupId];
        if (!targetGroup) return;
        const newIndex = targetGroup.tabs.findIndex((t) => t.id === over.id);
        moveTabToGroup(
          active.id as string,
          sourceGroupId,
          targetGroupId,
          newIndex >= 0 ? newIndex : undefined,
        );
      }
    },
    [groups, reorderTab, moveTabToGroup, splitGroup],
  );

  const handleResize = useCallback(
    (path: number[], sizes: number[]) => {
      resizeSplit(path, sizes);
    },
    [resizeSplit],
  );

  const renderNode = useCallback(
    (node: LayoutNode, path: number[]): React.ReactNode => {
      if (node.type === 'leaf') {
        return (
          <EditorGroupPanel
            key={node.groupId}
            groupId={node.groupId}
            isDragging={!!draggedTab}
            dragSourceGroupId={draggedTab?.groupId ?? null}
          />
        );
      }
      return (
        <SplitContainer
          key={path.join('-') || 'root'}
          node={node}
          path={path}
          onResize={handleResize}
          renderNode={renderNode}
        />
      );
    },
    [handleResize, draggedTab],
  );

  // Keyboard shortcuts for split panes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+\ — Split right
      if (isMeta && !e.shiftKey && e.key === '\\') {
        e.preventDefault();
        splitGroup(activeGroupId, 'horizontal');
        return;
      }

      // Cmd+Shift+\ — Split down
      if (isMeta && e.shiftKey && e.key === '\\') {
        e.preventDefault();
        splitGroup(activeGroupId, 'vertical');
        return;
      }

      // Cmd+1/2/3 — Focus group by index
      if (isMeta && e.key >= '1' && e.key <= '9') {
        const groupIds = getAllGroupIds(layout);
        const idx = parseInt(e.key) - 1;
        if (idx < groupIds.length) {
          e.preventDefault();
          setActiveGroup(groupIds[idx]);
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeGroupId, layout, splitGroup, setActiveGroup]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="h-full w-full overflow-hidden">
        {renderNode(layout, [])}
      </div>

      <DragOverlay dropAnimation={null}>
        {draggedTab && (
          <div className="flex items-center gap-1.5 px-3 h-8 text-xs bg-white border border-[var(--color-border)] rounded shadow-lg opacity-90">
            <span className="w-2 h-2 rounded-full bg-[var(--color-node-agent)]" />
            <span className="truncate max-w-[120px]">{draggedTab.tab.label}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
