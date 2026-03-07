import { useState, useCallback, useRef, useEffect } from 'react';
import type { FlowNode, ArtifactSchema } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { useLayout } from '../../context/LayoutContext';

interface CheckpointIOBarProps {
  nodeId: string;
  node: FlowNode;
}

const FORMAT_BADGE: Record<string, string> = {
  json: 'JSON',
  markdown: 'MD',
  text: 'TXT',
  csv: 'CSV',
  pdf: 'PDF',
  image: 'IMG',
};

/**
 * Compact inline bar showing Presents (inputs) and Expects (outputs) for checkpoint nodes.
 * This is the source of truth — the I/O bottom panel mirrors these values.
 */
export function CheckpointIOBar({ nodeId, node }: CheckpointIOBarProps) {
  const { state, updateNodeConfig } = useFlow();
  const { selectArtifact } = useLayout();

  const inputs: string[] = (node.config.inputs ?? []).map((i) =>
    typeof i === 'string' ? i : (i as ArtifactSchema).name,
  );
  const outputs: string[] = (node.config.outputs ?? []).map((o) =>
    typeof o === 'string' ? o : (o as ArtifactSchema).name,
  );

  const allArtifacts = Object.keys(state.flow.artifacts ?? {});
  const availableForPresents = allArtifacts.filter((a) => !inputs.includes(a));
  const availableForExpects = allArtifacts.filter((a) => !outputs.includes(a));

  const getSchema = (name: string): ArtifactSchema | undefined =>
    state.flow.artifacts?.[name] as ArtifactSchema | undefined;

  const addInput = useCallback(
    (name: string) => {
      updateNodeConfig(nodeId, { inputs: [...inputs, name] });
    },
    [nodeId, inputs, updateNodeConfig],
  );

  const removeInput = useCallback(
    (name: string) => {
      updateNodeConfig(nodeId, { inputs: inputs.filter((i) => i !== name) });
    },
    [nodeId, inputs, updateNodeConfig],
  );

  const addOutput = useCallback(
    (name: string) => {
      updateNodeConfig(nodeId, { outputs: [...outputs, name] });
    },
    [nodeId, outputs, updateNodeConfig],
  );

  const removeOutput = useCallback(
    (name: string) => {
      updateNodeConfig(nodeId, { outputs: outputs.filter((o) => o !== name) });
    },
    [nodeId, outputs, updateNodeConfig],
  );

  return (
    <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-canvas-bg)] px-4 py-1.5 space-y-1">
      {/* Presents row */}
      <IORow
        label="Presents"
        labelColor="text-blue-600"
        items={inputs}
        getSchema={getSchema}
        onRemove={removeInput}
        onAdd={addInput}
        onClickChip={selectArtifact}
        available={availableForPresents}
        emptyHint="No artifacts presented to user"
      />

      {/* Expects row */}
      <IORow
        label="Expects"
        labelColor="text-amber-600"
        items={outputs}
        getSchema={getSchema}
        onRemove={removeOutput}
        onAdd={addOutput}
        onClickChip={selectArtifact}
        available={availableForExpects}
        emptyHint="No artifacts expected from user"
      />
    </div>
  );
}

/* ── IO Row ─── */

interface IORowProps {
  label: string;
  labelColor: string;
  items: string[];
  getSchema: (name: string) => ArtifactSchema | undefined;
  onRemove: (name: string) => void;
  onAdd: (name: string) => void;
  onClickChip: (name: string) => void;
  available: string[];
  emptyHint: string;
}

function IORow({ label, labelColor, items, getSchema, onRemove, onAdd, onClickChip, available, emptyHint }: IORowProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  return (
    <div className="flex items-center gap-2 min-h-[24px]">
      <span className={`text-[10px] font-bold uppercase tracking-wider ${labelColor} w-14 shrink-0`}>
        {label}
      </span>

      <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
        {items.length === 0 && (
          <span className="text-[10px] text-[var(--color-text-muted)] italic">{emptyHint}</span>
        )}
        {items.map((name) => {
          const schema = getSchema(name);
          return (
            <ArtifactChip
              key={name}
              name={name}
              schema={schema}
              onRemove={() => onRemove(name)}
              onClick={() => onClickChip(name)}
            />
          );
        })}
      </div>

      {/* Add button */}
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={available.length === 0}
          className="w-5 h-5 flex items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-xs"
          title={`Add ${label.toLowerCase()} artifact`}
        >
          +
        </button>
        {showDropdown && available.length > 0 && (
          <div className="absolute right-0 top-6 z-50 bg-white border border-[var(--color-border)] rounded-md shadow-lg min-w-[180px] max-h-[200px] overflow-y-auto">
            {available.map((name) => {
              const schema = getSchema(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onAdd(name);
                    setShowDropdown(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[var(--color-canvas-bg)] transition-colors flex items-center gap-2"
                >
                  <span className="font-mono text-[var(--color-text-primary)] truncate flex-1">{name}</span>
                  {schema?.format && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--color-canvas-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)] shrink-0">
                      {FORMAT_BADGE[schema.format] ?? schema.format}
                    </span>
                  )}
                  {schema?.fields?.length ? (
                    <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">
                      {schema.fields.length}f
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Artifact Chip with remove ─── */

function ArtifactChip({
  name,
  schema,
  onRemove,
  onClick,
}: {
  name: string;
  schema?: ArtifactSchema;
  onRemove: () => void;
  onClick: () => void;
}) {
  const format = schema?.format;
  const fieldCount = schema?.fields?.length;

  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-purple-50 border border-purple-200/60 text-purple-700 group">
      <button
        type="button"
        onClick={onClick}
        className="px-1.5 py-0.5 text-[11px] font-mono font-medium hover:bg-purple-100/60 transition-colors rounded-l truncate max-w-[140px]"
        title={schema?.description || name}
      >
        {name}
      </button>
      {format && (
        <span className="text-[8px] px-1 py-0.5 text-purple-500 bg-purple-100/50 font-sans">
          {FORMAT_BADGE[format] ?? format}
        </span>
      )}
      {fieldCount ? (
        <span className="text-[8px] px-0.5 py-0.5 text-purple-400 font-sans">
          {fieldCount}f
        </span>
      ) : null}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="px-1 py-0.5 text-[10px] text-purple-400 hover:text-red-500 hover:bg-red-50 transition-colors rounded-r"
        title={`Remove ${name}`}
      >
        {'\u00D7'}
      </button>
    </span>
  );
}
