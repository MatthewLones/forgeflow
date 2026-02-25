import { useState, type ReactNode } from 'react';

interface ConfigSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function ConfigSection({ title, defaultOpen = false, children }: ConfigSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] bg-[var(--color-canvas-bg)] hover:bg-[var(--color-border)]/30 transition-colors"
      >
        {title}
        <span className="text-[var(--color-text-muted)]">
          {open ? '\u25BE' : '\u25B8'}
        </span>
      </button>
      {open && (
        <div className="p-3 space-y-3 bg-white">
          {children}
        </div>
      )}
    </div>
  );
}
