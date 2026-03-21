import { useState } from 'react';
import type { ArtifactSchema } from '@forgeflow/types';

interface JsonDataViewProps {
  data: unknown;
  schema?: ArtifactSchema;
}

/**
 * Renders parsed JSON as human-readable tables/cards with a raw JSON toggle.
 *
 * - Object with schema fields → clean key-value card (no type badges or descriptions)
 * - Array of objects → HTML table
 * - Flat object → two-column key-value table
 * - Primitives → inline formatted value
 */
export function JsonDataView({ data, schema }: JsonDataViewProps) {
  return <FormattedView data={data} schema={schema} />;
}

/* ── Formatted view ─── */

function FormattedView({ data, schema }: JsonDataViewProps) {
  // Schema with fields → clean key-value card
  if (schema?.fields?.length && data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    return (
      <div className="space-y-1.5">
        {schema.fields.map((field) => {
          const value = obj[field.key];
          return (
            <div key={field.key} className="flex items-start gap-2 py-1.5 border-b border-[var(--color-border)]/30 last:border-0">
              <div className="min-w-[100px] max-w-[220px] w-auto shrink-0" title={field.key}>
                <div className="text-[11px] font-medium text-[var(--color-text-primary)] truncate">
                  {field.key}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <ValueDisplay value={value} />
              </div>
            </div>
          );
        })}
        {/* Show any extra keys not in schema */}
        {Object.keys(obj)
          .filter((k) => !schema.fields!.some((f) => f.key === k))
          .map((key) => (
            <div key={key} className="flex items-start gap-2 py-1.5 border-b border-[var(--color-border)]/30 last:border-0">
              <div className="min-w-[100px] max-w-[220px] w-auto shrink-0 text-[11px] text-[var(--color-text-muted)] truncate" title={key}>
                {key}
              </div>
              <div className="flex-1 min-w-0">
                <ValueDisplay value={obj[key]} />
              </div>
            </div>
          ))}
      </div>
    );
  }

  // Array of objects → table
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const rows = data as Record<string, unknown>[];
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-[var(--color-canvas-bg)]">
              {columns.map((col) => (
                <th key={col} className="text-left px-2 py-1.5 font-medium text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row, i) => (
              <tr key={i} className="hover:bg-[var(--color-canvas-bg)]/50">
                {columns.map((col) => (
                  <td key={col} className="px-2 py-1.5 border-b border-[var(--color-border)]/30">
                    <ValueDisplay value={row[col]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 100 && (
          <div className="text-[10px] text-[var(--color-text-muted)] px-2 py-1 italic">
            Showing 100 of {rows.length} rows
          </div>
        )}
      </div>
    );
  }

  // Array of primitives → bullet list
  if (Array.isArray(data)) {
    return (
      <div className="space-y-0.5">
        {data.slice(0, 50).map((item, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[11px]">
            <span className="text-[var(--color-text-muted)] shrink-0">{'\u2022'}</span>
            <ValueDisplay value={item} />
          </div>
        ))}
        {data.length > 50 && (
          <div className="text-[10px] text-[var(--color-text-muted)] italic">
            ...and {data.length - 50} more items
          </div>
        )}
      </div>
    );
  }

  // Flat object → key-value table
  if (data && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    return (
      <div className="space-y-0.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start gap-2 py-1.5 border-b border-[var(--color-border)]/30 last:border-0">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)] min-w-[100px] max-w-[220px] w-auto shrink-0 truncate" title={key}>
              {key}
            </span>
            <div className="flex-1 min-w-0">
              <ValueDisplay value={value} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Primitive fallback
  return <ValueDisplay value={data} />;
}

/* ── Expandable string ─── */

function ExpandableString({ value, threshold = 500 }: { value: string; threshold?: number }) {
  const [expanded, setExpanded] = useState(false);

  if (value.length <= threshold) {
    return <span className="text-[11px] text-[var(--color-text-primary)] break-words">{value}</span>;
  }

  return (
    <span className="text-[11px] text-[var(--color-text-primary)] break-words">
      {expanded ? value : value.slice(0, threshold)}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-blue-500 hover:underline ml-1 text-[10px]"
      >
        {expanded ? 'Show less' : `... (${value.length} chars)`}
      </button>
    </span>
  );
}

/* ── Collapsible nested ─── */

function CollapsibleNested({ data, label }: { data: unknown; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-[10px] text-blue-500 hover:underline flex items-center gap-1"
      >
        <span>{open ? '\u25BC' : '\u25B6'}</span>
        {label}
      </button>
      {open && (
        <div className="pl-2 border-l-2 border-[var(--color-border)]/40 ml-1 mt-1">
          <FormattedView data={data} />
        </div>
      )}
    </div>
  );
}

/* ── Value renderer ─── */

function ValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-[11px] text-[var(--color-text-muted)] italic">null</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${value ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
        {String(value)}
      </span>
    );
  }

  if (typeof value === 'number') {
    return <span className="text-[11px] font-mono text-blue-600">{value}</span>;
  }

  if (typeof value === 'string') {
    return <ExpandableString value={value} />;
  }

  // Nested array → collapsible
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-[11px] text-[var(--color-text-muted)] italic">empty array</span>;
    }
    // Simple small arrays (strings/numbers) inline
    if (value.length <= 5 && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      return (
        <span className="text-[11px] text-[var(--color-text-primary)]">
          {value.join(', ')}
        </span>
      );
    }
    return <CollapsibleNested data={value} label={`[${value.length} items]`} />;
  }

  // Nested object → collapsible
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-[11px] text-[var(--color-text-muted)] italic">empty object</span>;
    }
    // Small flat objects inline
    if (entries.length <= 3 && entries.every(([, v]) => typeof v !== 'object' || v === null)) {
      return (
        <span className="text-[11px] text-[var(--color-text-primary)]">
          {entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ')}
        </span>
      );
    }
    return <CollapsibleNested data={value} label={`{${entries.length} fields}`} />;
  }

  return <span className="text-[11px] text-[var(--color-text-primary)]">{String(value)}</span>;
}
