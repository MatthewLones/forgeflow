import { useMemo } from 'react';
import {
  formatShortcut,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  type ShortcutBinding,
} from '../../lib/keyboard-shortcuts';

interface ShortcutHelpOverlayProps {
  bindings: ShortcutBinding[];
  onClose: () => void;
}

export function ShortcutHelpOverlay({ bindings, onClose }: ShortcutHelpOverlayProps) {
  const grouped = useMemo(() => {
    const groups = new Map<string, ShortcutBinding[]>();
    for (const b of bindings) {
      // Collapse group.2-9 into a single "Cmd+1-9" display
      if (b.id.startsWith('group.') && b.id !== 'group.1') continue;
      // Don't show Escape in the help overlay (it's implicit)
      if (b.id === 'escape') continue;
      const list = groups.get(b.category) ?? [];
      list.push(b);
      groups.set(b.category, list);
    }
    return groups;
  }, [bindings]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-1.5 py-0.5"
          >
            Esc
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-5">
          {CATEGORY_ORDER.map((category) => {
            const items = grouped.get(category);
            if (!items || items.length === 0) return null;
            return (
              <div key={category}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
                  {CATEGORY_LABELS[category] ?? category}
                </div>
                <div className="space-y-1.5">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {item.id === 'group.1' ? 'Focus group 1-9' : item.label}
                      </span>
                      <kbd className="text-[11px] bg-[var(--color-canvas-bg)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-[var(--color-text-primary)] min-w-[24px] text-center whitespace-nowrap" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>
                        {item.id === 'group.1'
                          ? formatShortcut({ ...item, label: '', key: '1' }) + '-9'
                          : formatShortcut(item)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
