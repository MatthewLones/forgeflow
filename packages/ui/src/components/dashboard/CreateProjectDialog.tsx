import { useState, useCallback, type KeyboardEvent } from 'react';

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
}

export function CreateProjectDialog({ open, onClose, onCreate }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = useCallback(() => {
    if (!name.trim()) return;
    onCreate(name.trim(), description.trim());
    setName('');
    setDescription('');
    onClose();
  }, [name, description, onCreate, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleCreate();
      }
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleCreate, onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-xl border border-[var(--color-border)] w-full max-w-md mx-4">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">New Project</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Create a new flow project
          </p>
        </div>

        <div className="p-5 space-y-4" onKeyDown={handleKeyDown}>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Contract Review Pipeline"
              className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 outline-none focus:border-[var(--color-node-agent)] transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this flow do?"
              rows={3}
              className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 outline-none focus:border-[var(--color-node-agent)] transition-colors resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim()}
            className="text-xs font-medium px-4 py-1.5 rounded-md bg-[var(--color-node-agent)] text-white hover:bg-[var(--color-node-agent)]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
}
