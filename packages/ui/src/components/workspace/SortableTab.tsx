import { useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { EditorTab } from '../../context/WorkspaceContext';

const TAB_COLORS: Record<string, string> = {
  agent: 'bg-[var(--color-node-agent)]',
  skill: 'bg-[var(--color-node-merge)]',
  checkpoint: 'bg-[var(--color-node-checkpoint)]',
  merge: 'bg-[var(--color-node-merge)]',
};

interface SortableTabProps {
  tab: EditorTab;
  isActive: boolean;
  isGroupActive: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export function SortableTab({ tab, isActive, isGroupActive, onActivate, onClose }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, data: { tab } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(tab.id);
    },
    [tab.id, onClose],
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        onClose(tab.id);
      }
    },
    [tab.id, onClose],
  );

  const dotColor = TAB_COLORS[tab.type] ?? TAB_COLORS.agent;
  const activeBorder = isGroupActive
    ? 'border-t-[var(--color-node-agent)]'
    : 'border-t-[var(--color-text-muted)]';

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={() => onActivate(tab.id)}
      onMouseDown={handleMiddleClick}
      className={`group flex items-center gap-1.5 px-3 h-8 text-xs border-r border-[var(--color-border)] transition-colors shrink-0 ${
        isActive
          ? `bg-white text-[var(--color-text-primary)] border-t-2 ${activeBorder}`
          : 'bg-[var(--color-canvas-bg)] text-[var(--color-text-secondary)] border-t-2 border-t-transparent hover:bg-white/60'
      }`}
      {...attributes}
      {...listeners}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <span className="truncate max-w-[120px]">{tab.label}</span>
      <span
        role="button"
        tabIndex={-1}
        onClick={handleClose}
        onKeyDown={(e) => { if (e.key === 'Enter') handleClose(e as unknown as React.MouseEvent); }}
        className={`w-4 h-4 flex items-center justify-center rounded-sm text-[10px] leading-none transition-colors ${
          isActive
            ? 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-canvas-bg)]'
            : 'text-transparent group-hover:text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)]'
        }`}
      >
        x
      </span>
    </button>
  );
}
