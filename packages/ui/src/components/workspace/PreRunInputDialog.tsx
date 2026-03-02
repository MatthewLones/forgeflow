import { useState, useCallback, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { EditorTab } from '../../context/LayoutContext';
import { useLayout } from '../../context/LayoutContext';
import { useRun } from '../../context/RunContext';

/* ── Types ─────────────────────────────────────────────── */

export interface RequiredInput {
  name: string;
  schema: {
    name: string;
    format: string;
    description: string;
    fields?: Array<{
      key: string;
      type: string;
      description: string;
      required?: boolean;
    }>;
  } | null;
}

/* ── JSON validation ───────────────────────────────────── */

function validateJsonFields(
  content: string,
  fields: NonNullable<RequiredInput['schema']>['fields'],
): { parseError: boolean; warnings: string[] } {
  if (!fields || fields.length === 0) return { parseError: false, warnings: [] };
  try {
    const data = JSON.parse(content);
    const warnings: string[] = [];
    for (const field of fields) {
      if (field.required !== false && !(field.key in data)) {
        warnings.push(`Missing required field: "${field.key}" — ${field.description}`);
      } else if (field.key in data) {
        const val = data[field.key];
        const actual = Array.isArray(val) ? 'array' : typeof val;
        if (actual !== field.type) {
          warnings.push(`Field "${field.key}": expected ${field.type}, got ${actual}`);
        }
      }
    }
    return { parseError: false, warnings };
  } catch {
    return { parseError: true, warnings: ['Invalid JSON — file could not be parsed'] };
  }
}

/* ── Format badge colors ───────────────────────────────── */

const FORMAT_COLORS: Record<string, string> = {
  json: 'bg-amber-100 text-amber-700',
  text: 'bg-blue-100 text-blue-700',
  markdown: 'bg-purple-100 text-purple-700',
  pdf: 'bg-red-100 text-red-700',
  csv: 'bg-green-100 text-green-700',
  image: 'bg-pink-100 text-pink-700',
  binary: 'bg-gray-100 text-gray-700',
};

/* ── Panel component (dockview tab) ───────────────────── */

export function PreRunPanel(props: IDockviewPanelProps<EditorTab>) {
  const params = props.params;
  const requiredInputs = (params.requiredInputs ?? []) as RequiredInput[];
  const loading = params.fetchingInputs ?? false;
  const projectId = params.projectId ?? '';
  const { startRun } = useRun();
  const { openTab, closeTab } = useLayout();

  // Read runner from params (passed through from toolbar)
  const runner = (params.runId ?? 'local') as 'mock' | 'local' | 'docker';

  // Map of artifact name → selected File
  const [fileMap, setFileMap] = useState<Record<string, File>>({});
  // Map of artifact name → validation warnings
  const [warningsMap, setWarningsMap] = useState<Record<string, string[]>>({});
  // Additional context files (optional, not tied to an artifact)
  const [extraFiles, setExtraFiles] = useState<File[]>([]);

  // Update state when params change (e.g. loading → loaded)
  const [resolvedInputs, setResolvedInputs] = useState<RequiredInput[]>(requiredInputs);
  const [resolvedLoading, setResolvedLoading] = useState(loading);

  useEffect(() => {
    const disposable = props.api.onDidParametersChange(() => {
      const p = props.params;
      setResolvedInputs((p.requiredInputs ?? []) as RequiredInput[]);
      setResolvedLoading(p.fetchingInputs ?? false);
    });
    return () => disposable.dispose();
  }, [props.api, props.params]);

  const handleFileSelected = useCallback(
    async (inputName: string, file: File, schema: RequiredInput['schema']) => {
      const renamedFile = new File([file], inputName, { type: file.type });
      setFileMap((prev) => ({ ...prev, [inputName]: renamedFile }));

      if (schema?.format === 'json' && schema.fields) {
        const text = await file.text();
        const { warnings } = validateJsonFields(text, schema.fields);
        setWarningsMap((prev) => ({ ...prev, [inputName]: warnings }));
      } else {
        setWarningsMap((prev) => ({ ...prev, [inputName]: [] }));
      }
    },
    [],
  );

  const handleStartRun = useCallback(async () => {
    const allFiles = [
      ...Object.values(fileMap),
      ...extraFiles,
    ];
    // Close pre-run tab, open run tab, start run
    closeTab('pre-run');
    openTab({ id: 'run', type: 'run', label: 'Run' });
    await startRun(projectId, runner, allFiles);
  }, [fileMap, extraFiles, closeTab, openTab, startRun, projectId, runner]);

  const allRequiredFilled = resolvedInputs.every((input) => fileMap[input.name]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--color-border)] shrink-0">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Run Configuration</h2>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Provide input files for this flow execution
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {resolvedLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-[var(--color-text-muted)]">Loading required inputs...</span>
          </div>
        ) : resolvedInputs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <span className="text-sm text-[var(--color-text-primary)]">No input files required</span>
            <span className="text-xs text-[var(--color-text-muted)]">
              This flow can start without any user-provided files.
            </span>
          </div>
        ) : (
          <>
            <div className="text-xs text-[var(--color-text-muted)] mb-2">
              {resolvedInputs.length} required input{resolvedInputs.length !== 1 ? 's' : ''}
            </div>
            {resolvedInputs.map((input) => (
              <FileInputRow
                key={input.name}
                input={input}
                file={fileMap[input.name] ?? null}
                onFileChange={(file) => {
                  if (file) {
                    handleFileSelected(input.name, file, input.schema);
                  } else {
                    setFileMap((prev) => {
                      const next = { ...prev };
                      delete next[input.name];
                      return next;
                    });
                    setWarningsMap((prev) => {
                      const next = { ...prev };
                      delete next[input.name];
                      return next;
                    });
                  }
                }}
                warnings={warningsMap[input.name] ?? []}
              />
            ))}
          </>
        )}

        {/* Additional context files */}
        {!resolvedLoading && (
          <AdditionalFilesSection
            files={extraFiles}
            onFilesChange={setExtraFiles}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2 shrink-0">
        <button
          type="button"
          onClick={() => closeTab('pre-run')}
          className="text-xs font-medium px-3 py-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleStartRun}
          disabled={resolvedLoading || (resolvedInputs.length > 0 && !allRequiredFilled)}
          className="text-xs font-medium px-4 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Start Run
        </button>
      </div>
    </div>
  );
}

/* ── File input row ────────────────────────────────────── */

function FileInputRow({
  input,
  file,
  onFileChange,
  warnings,
}: {
  input: RequiredInput;
  file: File | null;
  onFileChange: (file: File | null) => void;
  warnings: string[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const format = input.schema?.format ?? 'text';
  const formatColor = FORMAT_COLORS[format] ?? FORMAT_COLORS.binary;

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) onFileChange(droppedFile);
    },
    [onFileChange],
  );

  const handleFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) onFileChange(selected);
    },
    [onFileChange],
  );

  return (
    <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${formatColor}`}>
          {format}
        </span>
        <span className="text-xs font-medium text-[var(--color-text-primary)]">
          {input.name}
        </span>
      </div>

      {/* Description */}
      {input.schema?.description && (
        <p className="text-xs text-[var(--color-text-muted)]">
          {input.schema.description}
        </p>
      )}

      {/* Expected fields (for JSON with fields) */}
      {input.schema?.format === 'json' && input.schema.fields && input.schema.fields.length > 0 && (
        <div className="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-canvas-bg)] rounded px-2 py-1.5 space-y-0.5">
          <div className="font-medium text-[var(--color-text-secondary)]">Expected fields:</div>
          {input.schema.fields.map((f) => (
            <div key={f.key}>
              <span className="font-mono text-[var(--color-text-primary)]">{f.key}</span>
              <span className="text-[var(--color-text-muted)]"> ({f.type}) — {f.description}</span>
              {f.required === false && <span className="text-[var(--color-text-muted)] italic"> (optional)</span>}
            </div>
          ))}
        </div>
      )}

      {/* Drop zone / file picker */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-md px-3 py-3 cursor-pointer transition-colors ${
          dragOver
            ? 'border-[var(--color-node-agent)] bg-blue-50'
            : file
              ? 'border-emerald-300 bg-emerald-50'
              : 'border-[var(--color-border)] hover:border-[var(--color-node-agent)]'
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileInput}
        />
        {file ? (
          <div className="flex items-center gap-2 w-full">
            <span className="text-xs text-emerald-700 font-medium truncate flex-1">
              {file.name}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {formatFileSize(file.size)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
              }}
              className="text-[10px] text-red-500 hover:text-red-700 font-medium"
            >
              Remove
            </button>
          </div>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">
            Drop a file here or click to browse
          </span>
        )}
      </div>

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="space-y-0.5">
          {warnings.map((w, i) => (
            <div key={i} className="text-[10px] text-amber-600">
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Additional context files ──────────────────────────── */

function AdditionalFilesSection({
  files,
  onFilesChange,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length > 0) onFilesChange([...files, ...dropped]);
    },
    [files, onFilesChange],
  );

  const handleFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      if (selected.length > 0) onFilesChange([...files, ...selected]);
    },
    [files, onFilesChange],
  );

  return (
    <div className="border-t border-[var(--color-border)] pt-3 mt-3">
      <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
        Additional Context (optional)
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center gap-1 border-2 border-dashed rounded-md px-3 py-2 cursor-pointer transition-colors ${
          dragOver
            ? 'border-[var(--color-node-agent)] bg-blue-50'
            : 'border-[var(--color-border)] hover:border-[var(--color-node-agent)]'
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Drop additional files or click to browse
        </span>
      </div>
      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-text-primary)] truncate flex-1">{file.name}</span>
              <span className="text-[10px] text-[var(--color-text-muted)]">{formatFileSize(file.size)}</span>
              <button
                type="button"
                onClick={() => onFilesChange(files.filter((_, j) => j !== i))}
                className="text-[10px] text-red-500 hover:text-red-700 font-medium"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────── */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
