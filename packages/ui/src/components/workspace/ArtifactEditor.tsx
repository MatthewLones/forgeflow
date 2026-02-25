import { useState, useCallback } from 'react';
import type { ArtifactSchema, ArtifactFormat, ArtifactField, ArtifactFieldType } from '@forgeflow/types';

const FORMAT_OPTIONS: ArtifactFormat[] = ['json', 'markdown', 'text', 'csv', 'pdf', 'image', 'binary'];
const FIELD_TYPES: ArtifactFieldType[] = ['string', 'number', 'boolean', 'array', 'object'];

interface ArtifactEditorProps {
  label: string;
  artifacts: (string | ArtifactSchema)[];
  onChange: (artifacts: (string | ArtifactSchema)[]) => void;
  showFields?: boolean;
}

function toSchema(a: string | ArtifactSchema, showFields: boolean): ArtifactSchema {
  if (typeof a !== 'string') return a;
  return {
    name: a,
    format: 'json',
    description: '',
    ...(showFields ? { fields: [] } : {}),
  };
}

function getName(a: string | ArtifactSchema): string {
  return typeof a === 'string' ? a : a.name;
}

export function ArtifactEditor({ label, artifacts, onChange, showFields = false }: ArtifactEditorProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const updateArtifact = useCallback(
    (index: number, updated: ArtifactSchema) => {
      const next = [...artifacts];
      next[index] = updated;
      onChange(next);
    },
    [artifacts, onChange],
  );

  const removeArtifact = useCallback(
    (index: number) => {
      onChange(artifacts.filter((_, i) => i !== index));
      if (expandedIndex === index) setExpandedIndex(null);
    },
    [artifacts, onChange, expandedIndex],
  );

  const addArtifact = useCallback(() => {
    const schema: ArtifactSchema = {
      name: '',
      format: 'json',
      description: '',
      ...(showFields ? { fields: [] } : {}),
    };
    onChange([...artifacts, schema]);
    setExpandedIndex(artifacts.length);
  }, [artifacts, onChange, showFields]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
          {label}
        </span>
        <button
          type="button"
          onClick={addArtifact}
          className="text-[11px] text-[var(--color-node-agent)] hover:text-[var(--color-node-agent)]/80 font-medium"
        >
          + Add
        </button>
      </div>

      {artifacts.length === 0 && (
        <div className="text-[11px] text-[var(--color-text-muted)] italic py-1">
          No {label.toLowerCase()} defined
        </div>
      )}

      {artifacts.map((artifact, i) => (
        <ArtifactRow
          key={i}
          schema={toSchema(artifact, showFields)}
          expanded={expandedIndex === i}
          showFields={showFields}
          onUpdate={(updated) => updateArtifact(i, updated)}
          onRemove={() => removeArtifact(i)}
          onExpand={() => setExpandedIndex(expandedIndex === i ? null : i)}
        />
      ))}
    </div>
  );
}

interface ArtifactRowProps {
  schema: ArtifactSchema;
  expanded: boolean;
  showFields: boolean;
  onUpdate: (updated: ArtifactSchema) => void;
  onRemove: () => void;
  onExpand: () => void;
}

function ArtifactRow({ schema, expanded, showFields, onUpdate, onRemove, onExpand }: ArtifactRowProps) {
  const updateField = useCallback(
    (field: keyof ArtifactSchema, value: unknown) => {
      onUpdate({ ...schema, [field]: value });
    },
    [schema, onUpdate],
  );

  return (
    <div className="border border-[var(--color-border)] rounded bg-white">
      {/* Main row: name + format + expand + remove */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        <input
          type="text"
          value={schema.name}
          onChange={(e) => updateField('name', e.target.value)}
          placeholder="filename.json"
          className="flex-1 min-w-0 text-[11px] font-mono border-none bg-transparent outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />

        <select
          value={schema.format}
          onChange={(e) => updateField('format', e.target.value)}
          className="text-[10px] border border-[var(--color-border)] rounded px-1 py-0.5 bg-white text-[var(--color-text-secondary)]"
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f.toUpperCase()}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={onExpand}
          className={`text-[10px] px-1 ${expanded ? 'text-[var(--color-node-agent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
          title={expanded ? 'Collapse' : 'Expand details'}
        >
          {expanded ? '▾' : '▸'}
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-[var(--color-text-muted)] hover:text-red-500 px-0.5"
          title="Remove"
        >
          ×
        </button>
      </div>

      {/* Expanded details: description + fields */}
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-2 py-1.5 space-y-1.5 bg-[var(--color-canvas-bg)]">
          <div>
            <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Description</label>
            <input
              type="text"
              value={schema.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="What this file contains"
              className="w-full text-[11px] border border-[var(--color-border)] rounded px-1.5 py-1 bg-white"
            />
          </div>

          {showFields && schema.format === 'json' && (
            <FieldsEditor
              fields={schema.fields ?? []}
              onChange={(fields) => updateField('fields', fields)}
            />
          )}
        </div>
      )}

      {/* Compact summary when collapsed */}
      {!expanded && schema.description && (
        <div className="px-2 pb-1 text-[10px] text-[var(--color-text-muted)] truncate">
          {schema.description}
          {schema.fields && schema.fields.length > 0 && (
            <span className="ml-1">
              · {schema.fields.length} field{schema.fields.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface FieldsEditorProps {
  fields: ArtifactField[];
  onChange: (fields: ArtifactField[]) => void;
}

function FieldsEditor({ fields, onChange }: FieldsEditorProps) {
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

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[var(--color-text-muted)] font-medium">Fields</span>
        <button
          type="button"
          onClick={addField}
          className="text-[10px] text-[var(--color-node-agent)] hover:text-[var(--color-node-agent)]/80"
        >
          + Field
        </button>
      </div>

      {fields.length === 0 && (
        <div className="text-[10px] text-[var(--color-text-muted)] italic">No fields defined</div>
      )}

      <div className="space-y-1">
        {fields.map((field, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px]">
            <input
              type="text"
              value={field.key}
              onChange={(e) => updateField(i, { key: e.target.value })}
              placeholder="key"
              className="w-20 font-mono border border-[var(--color-border)] rounded px-1 py-0.5 bg-white"
            />
            <select
              value={field.type}
              onChange={(e) => updateField(i, { type: e.target.value as ArtifactFieldType })}
              className="border border-[var(--color-border)] rounded px-1 py-0.5 bg-white"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              type="text"
              value={field.description}
              onChange={(e) => updateField(i, { description: e.target.value })}
              placeholder="description"
              className="flex-1 min-w-0 border border-[var(--color-border)] rounded px-1 py-0.5 bg-white"
            />
            <label className="flex items-center gap-0.5 text-[var(--color-text-muted)]" title="Required">
              <input
                type="checkbox"
                checked={field.required !== false}
                onChange={(e) => updateField(i, { required: e.target.checked })}
                className="w-3 h-3"
              />
              req
            </label>
            <button
              type="button"
              onClick={() => removeField(i)}
              className="text-[var(--color-text-muted)] hover:text-red-500 px-0.5"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
