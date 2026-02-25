import { useCallback, useState, useRef, useEffect } from 'react';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { EditorTab } from '../../context/WorkspaceContext';
import { SortableTab } from './SortableTab';

interface TabBarProps {
  groupId: string;
  tabs: EditorTab[];
  activeTabId: string | null;
  isGroupActive: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onSplit?: (direction: 'horizontal' | 'vertical') => void;
}

export function TabBar({
  groupId,
  tabs,
  activeTabId,
  isGroupActive,
  onActivate,
  onClose,
  onSplit,
}: TabBarProps) {
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close split menu on outside click
  useEffect(() => {
    if (!showSplitMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowSplitMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSplitMenu]);

  const handleSplitClick = useCallback(() => {
    onSplit?.('horizontal');
  }, [onSplit]);

  const handleSplitContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowSplitMenu((v) => !v);
  }, []);

  if (tabs.length === 0) {
    return (
      <div className="h-9 flex items-center bg-[var(--color-canvas-bg)] border-b border-[var(--color-border)] shrink-0">
        <span className="px-3 text-xs text-[var(--color-text-muted)]">No open editors</span>
      </div>
    );
  }

  const tabIds = tabs.map((t) => t.id);

  return (
    <div className="h-9 flex items-end bg-[var(--color-canvas-bg)] border-b border-[var(--color-border)] shrink-0">
      <div className="flex-1 flex items-end overflow-x-auto">
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy} id={groupId}>
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isGroupActive={isGroupActive}
              onActivate={onActivate}
              onClose={onClose}
            />
          ))}
        </SortableContext>
      </div>

      {/* Split button */}
      {onSplit && (
        <div className="relative shrink-0 flex items-center h-full px-1" ref={menuRef}>
          <button
            type="button"
            onClick={handleSplitClick}
            onContextMenu={handleSplitContextMenu}
            title="Split editor (right-click for options)"
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors text-xs"
          >
            {/* Split icon: two vertical rectangles */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1" y="2" width="5" height="10" rx="0.5" />
              <rect x="8" y="2" width="5" height="10" rx="0.5" />
            </svg>
          </button>

          {showSplitMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white rounded shadow-lg border border-[var(--color-border)] py-1 z-50 min-w-[140px]">
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
                onClick={() => { onSplit('horizontal'); setShowSplitMenu(false); }}
              >
                Split Right
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
                onClick={() => { onSplit('vertical'); setShowSplitMenu(false); }}
              >
                Split Down
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
