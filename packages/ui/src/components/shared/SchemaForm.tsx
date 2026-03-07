import { useCallback } from 'react';
import type { ArtifactSchema, ArtifactField } from '@forgeflow/types';

interface SchemaFormProps {
  schema: ArtifactSchema;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled?: boolean;
}

/**
 * Schema-driven form. Renders labeled inputs per ArtifactSchema field.
 * All values stored as strings — serialized to typed JSON via `formValuesToJson()`.
 */
export function SchemaForm({ schema, values, onChange, disabled }: SchemaFormProps) {
  const fields = schema.fields ?? [];

  const handleFieldChange = useCallback(
    (key: string, value: string) => {
      onChange({ ...values, [key]: value });
    },
    [values, onChange],
  );

  return (
    <div className="space-y-3">
      {schema.description && (
        <div className="text-[11px] text-[var(--color-text-secondary)] italic">
          {schema.description}
        </div>
      )}
      {fields.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key] ?? ''}
          onChange={(v) => handleFieldChange(field.key, v)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/* ── Per-field input ─── */

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ArtifactField;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const isRequired = field.required !== false;

  return (
    <div className="space-y-1">
      {/* Label row */}
      <div className="flex items-center gap-1.5">
        <label className="text-[11px] font-semibold text-[var(--color-text-primary)]">
          {field.key}
        </label>
        {isRequired && <span className="text-red-400 text-[10px]">*</span>}
        <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--color-canvas-bg)] text-[var(--color-text-muted)] font-mono">
          {field.type}
        </span>
      </div>

      {/* Description */}
      {field.description && (
        <div className="text-[10px] text-[var(--color-text-muted)] leading-tight">
          {field.description}
        </div>
      )}

      {/* Input widget */}
      {field.type === 'boolean' ? (
        <BooleanToggle value={value} onChange={onChange} disabled={disabled} />
      ) : field.type === 'array' || field.type === 'object' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.type === 'array' ? '["item1", "item2"]' : '{"key": "value"}'}
          rows={2}
          className="w-full text-[11px] px-2.5 py-1.5 border border-[var(--color-border)] rounded bg-white font-mono focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 focus:outline-none transition-colors resize-none disabled:opacity-50 disabled:bg-gray-50"
        />
      ) : field.type === 'number' ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.description || '0'}
          className="w-full text-[11px] px-2.5 py-1.5 border border-[var(--color-border)] rounded bg-white font-mono focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 focus:outline-none transition-colors disabled:opacity-50 disabled:bg-gray-50"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.description || field.key}
          className="w-full text-[11px] px-2.5 py-1.5 border border-[var(--color-border)] rounded bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 focus:outline-none transition-colors disabled:opacity-50 disabled:bg-gray-50"
        />
      )}
    </div>
  );
}

/* ── Boolean toggle ─── */

function BooleanToggle({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const isTrue = value.toLowerCase() === 'true' || value === '1';
  const isSet = value !== '';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!isSet) onChange('true');
        else onChange(isTrue ? 'false' : 'true');
      }}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 ease-in-out
        focus:outline-none focus:ring-2 focus:ring-blue-400/20
        disabled:opacity-50 disabled:cursor-not-allowed
        ${isSet && isTrue ? 'bg-emerald-500' : isSet ? 'bg-gray-300' : 'bg-gray-200'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm
          transition duration-200 ease-in-out
          ${isSet && isTrue ? 'translate-x-4' : 'translate-x-0'}
        `}
      />
    </button>
  );
}

/* ── Serialization helpers ─── */

/** Serialize form string values to typed JSON using schema field definitions */
export function formValuesToJson(fields: ArtifactField[], values: Record<string, string>): string {
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key] ?? '';
    if (!raw.trim()) continue;

    switch (field.type) {
      case 'number':
        obj[field.key] = Number(raw);
        break;
      case 'boolean':
        obj[field.key] = raw.toLowerCase() === 'true' || raw === '1';
        break;
      case 'array':
      case 'object':
        try {
          obj[field.key] = JSON.parse(raw);
        } catch {
          obj[field.key] = raw;
        }
        break;
      default:
        obj[field.key] = raw;
    }
  }
  return JSON.stringify(obj, null, 2);
}

/** Check if all required fields are filled */
export function isFormComplete(fields: ArtifactField[], values: Record<string, string>): boolean {
  return fields.every((f) => {
    if (f.required === false) return true;
    return (values[f.key] ?? '').trim().length > 0;
  });
}
