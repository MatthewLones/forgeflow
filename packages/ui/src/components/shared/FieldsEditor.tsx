import { useState, useCallback, useRef, useEffect } from 'react';
import type { ArtifactField } from '@forgeflow/types';

interface FieldsEditorProps {
  fields: ArtifactField[];
  onChange: (fields: ArtifactField[]) => void;
}

export function FieldsEditor({ fields, onChange }: FieldsEditorProps) {
  const addField = useCallback(() => {
    onChange([...fields, { key: '', type: 'string', description: '', required: true }]);
  }, [fields, onChange]);

  const updateField = useCallback(
    (index: number, updates: Partial<ArtifactField>) => {
      const next = fields.map((f, i) => (i === index ? { ...f, ...updates } : f));
      onChange(next);
    },
    [fields, onChange],
  );

  const removeField = useCallback(
    (index: number) => {
      onChange(fields.filter((_, i) => i !== index));
    },
    [fields, onChange],
  );

  const handleDescKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onChange([
          ...fields.slice(0, index + 1),
          { key: '', type: 'string', description: '', required: true },
          ...fields.slice(index + 1),
        ]);
      }
      // Shift+Enter: default textarea behavior (newline)
    },
    [fields, onChange],
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
          Schema Fields
        </span>
        <button type="button" onClick={addField} className="text-[10px] text-[var(--color-node-agent)] hover:underline">
          + Field
        </button>
      </div>
      {fields.length === 0 && (
        <div className="text-xs text-[var(--color-text-muted)] italic py-2">
          No fields defined — click + Field to add schema
        </div>
      )}
      {fields.map((field, i) => (
        <FieldRow
          key={i}
          field={field}
          index={i}
          onUpdate={updateField}
          onRemove={removeField}
          onDescKeyDown={handleDescKeyDown}
          isNew={field.key === '' && field.description === ''}
        />
      ))}
    </div>
  );
}

interface FieldRowProps {
  field: ArtifactField;
  index: number;
  onUpdate: (index: number, updates: Partial<ArtifactField>) => void;
  onRemove: (index: number) => void;
  onDescKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => void;
  isNew: boolean;
}

function FieldRow({ field, index, onUpdate, onRemove, onDescKeyDown, isNew }: FieldRowProps) {
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNew && keyRef.current) {
      keyRef.current.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-start gap-2">
      <input
        ref={keyRef}
        type="text"
        value={field.key}
        onChange={(e) => onUpdate(index, { key: e.target.value })}
        placeholder="key"
        className="w-28 shrink-0 text-xs font-mono px-2 py-1.5 border border-[var(--color-border)] rounded bg-white outline-none focus:border-[var(--color-node-agent)]"
      />
      <textarea
        value={field.description}
        onChange={(e) => onUpdate(index, { description: e.target.value })}
        onKeyDown={(e) => onDescKeyDown(e, index)}
        placeholder="description (Enter = new field, Shift+Enter = newline)"
        className="flex-1 text-xs px-2 py-1.5 border border-[var(--color-border)] rounded bg-white outline-none focus:border-[var(--color-node-agent)] resize-none"
        rows={1}
      />
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="text-[var(--color-text-muted)] hover:text-red-500 transition-colors text-xs px-1 py-1 shrink-0"
        title="Remove field"
      >
        &times;
      </button>
    </div>
  );
}
