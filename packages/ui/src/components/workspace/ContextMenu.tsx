import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const itemCount = items.filter((i) => !isSeparator(i)).length;
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - itemCount * 30 - 16);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] py-1 bg-white border border-[var(--color-border)] rounded-lg shadow-lg"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((entry, i) =>
        isSeparator(entry) ? (
          <div key={`sep-${i}`} className="my-1 border-t border-[var(--color-border)]" />
        ) : (
          <button
            key={entry.label}
            type="button"
            disabled={entry.disabled}
            onClick={() => {
              if (!entry.disabled) {
                entry.onClick();
                onClose();
              }
            }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              entry.disabled
                ? 'text-[var(--color-text-muted)] cursor-default'
                : entry.danger
                  ? 'text-red-500 hover:bg-red-50'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
            }`}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
