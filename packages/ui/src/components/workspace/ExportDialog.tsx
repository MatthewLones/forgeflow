import { useState, useCallback, useEffect, useRef } from 'react';

interface ExportDialogProps {
  defaultName: string;
  onExport: (fileName: string) => void;
  onClose: () => void;
}

export function ExportDialog({ defaultName, onExport, onClose }: ExportDialogProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and select the name (without extension) on mount
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(0, name.length);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const fileName = trimmed.endsWith('.forge') ? trimmed : `${trimmed}.forge`;
    onExport(fileName);
  }, [name, onExport]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleExport();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleExport, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Export Project
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-1.5 py-0.5"
          >
            Esc
          </button>
        </div>

        {/* Name input */}
        <div className="px-6 pb-5">
          <label className="text-[11px] text-[var(--color-text-muted)] mb-1.5 block">
            File name
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 text-sm font-mono bg-white border border-[var(--color-border)] rounded-lg px-3 py-2 focus:outline-none focus:border-[var(--color-node-agent)] focus:ring-1 focus:ring-[var(--color-node-agent)]/20"
              placeholder="project-name"
            />
            <span className="text-xs text-[var(--color-text-muted)] shrink-0">.forge</span>
          </div>

          <div className="flex items-center justify-between mt-4">
            <span className="text-[10px] text-[var(--color-text-muted)]">
              Press Enter to export
            </span>
            <button
              type="button"
              onClick={handleExport}
              disabled={!name.trim()}
              className="px-4 py-1.5 text-xs font-medium bg-[var(--color-node-agent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
