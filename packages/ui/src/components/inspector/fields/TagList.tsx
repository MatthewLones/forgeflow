import { useState, useCallback, type KeyboardEvent } from 'react';

interface TagListProps {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagList({ label, tags, onChange, placeholder = 'Add item...' }: TagListProps) {
  const [input, setInput] = useState('');

  const addTag = useCallback(() => {
    const value = input.trim();
    if (value && !tags.includes(value)) {
      onChange([...tags, value]);
      setInput('');
    }
  }, [input, tags, onChange]);

  const removeTag = useCallback(
    (index: number) => {
      onChange(tags.filter((_, i) => i !== index));
    },
    [tags, onChange],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag();
      }
      if (e.key === 'Backspace' && !input && tags.length > 0) {
        removeTag(tags.length - 1);
      }
    },
    [addTag, input, tags.length, removeTag],
  );

  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
        {label}
      </label>
      <div className="flex flex-wrap gap-1 p-2 border border-[var(--color-border)] rounded-md bg-white min-h-[36px]">
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-[var(--color-canvas-bg)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)]"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] leading-none"
            >
              x
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={addTag}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] text-xs bg-transparent outline-none placeholder:text-[var(--color-text-muted)]"
        />
      </div>
    </div>
  );
}
