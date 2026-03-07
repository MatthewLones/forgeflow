import type { ArtifactSchema } from '@forgeflow/types';

interface JsonDataViewProps {
  data: unknown;
  schema?: ArtifactSchema;
}

/**
 * Renders parsed JSON as human-readable tables/cards. Never shows raw JSON.
 *
 * - Object with schema fields → labeled key-value card
 * - Array of objects → HTML table
 * - Flat object → two-column key-value table
 * - Primitives → inline formatted value
 */
export function JsonDataView({ data, schema }: JsonDataViewProps) {
  // Schema with fields → labeled key-value card
  if (schema?.fields?.length && data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    return (
      <div className="space-y-1">
        {schema.fields.map((field) => {
          const value = obj[field.key];
          return (
            <div key={field.key} className="flex items-start gap-2 py-1 border-b border-[var(--color-border)]/30 last:border-0">
              <div className="w-[140px] shrink-0">
                <div className="text-[11px] font-medium text-[var(--color-text-primary)]">
                  {field.key}
                </div>
                {field.description && (
                  <div className="text-[9px] text-[var(--color-text-muted)] leading-tight">
                    {field.description}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <ValueDisplay value={value} />
              </div>
              <span className="text-[9px] text-[var(--color-text-muted)] shrink-0 px-1 py-0.5 rounded bg-[var(--color-canvas-bg)]">
                {field.type}
              </span>
            </div>
          );
        })}
        {/* Show any extra keys not in schema */}
        {Object.keys(obj)
          .filter((k) => !schema.fields!.some((f) => f.key === k))
          .map((key) => (
            <div key={key} className="flex items-start gap-2 py-1 border-b border-[var(--color-border)]/30 last:border-0">
              <div className="w-[140px] shrink-0 text-[11px] text-[var(--color-text-muted)]">
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
                <th key={col} className="text-left px-2 py-1 font-medium text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row, i) => (
              <tr key={i} className="hover:bg-[var(--color-canvas-bg)]/50">
                {columns.map((col) => (
                  <td key={col} className="px-2 py-1 border-b border-[var(--color-border)]/30">
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
          <div key={key} className="flex items-start gap-2 py-0.5 border-b border-[var(--color-border)]/30 last:border-0">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)] w-[140px] shrink-0 truncate">
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
    // Truncate long strings
    if (value.length > 200) {
      return (
        <span className="text-[11px] text-[var(--color-text-primary)] break-words">
          {value.slice(0, 200)}<span className="text-[var(--color-text-muted)]">... ({value.length} chars)</span>
        </span>
      );
    }
    return <span className="text-[11px] text-[var(--color-text-primary)] break-words">{value}</span>;
  }

  // Nested object/array → recurse
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-[11px] text-[var(--color-text-muted)] italic">empty array</span>;
    }
    // Simple arrays (strings/numbers) inline
    if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      return (
        <span className="text-[11px] text-[var(--color-text-primary)]">
          {value.join(', ')}
        </span>
      );
    }
    return (
      <div className="pl-2 border-l-2 border-[var(--color-border)]/40 ml-1">
        <JsonDataView data={value} />
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-[11px] text-[var(--color-text-muted)] italic">empty object</span>;
    }
    // Small objects inline
    if (entries.length <= 3 && entries.every(([, v]) => typeof v !== 'object')) {
      return (
        <span className="text-[11px] text-[var(--color-text-primary)]">
          {entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ')}
        </span>
      );
    }
    return (
      <div className="pl-2 border-l-2 border-[var(--color-border)]/40 ml-1">
        <JsonDataView data={value} />
      </div>
    );
  }

  return <span className="text-[11px] text-[var(--color-text-primary)]">{String(value)}</span>;
}
