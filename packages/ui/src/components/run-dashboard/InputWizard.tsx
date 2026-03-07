import { useState, useCallback, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { api } from '../../lib/api-client';

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

type RunnerType = 'mock' | 'local' | 'docker';

/* ── Available models ─────────────────────────────────── */

interface ModelOption {
  id: string;
  label: string;
  description: string;
  cost: string;
}

const MODELS: ModelOption[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fast & cheap, good for testing', cost: '$1/$5' },
  { id: 'claude-sonnet-4-5-20250514', label: 'Sonnet 4.5', description: 'Balanced speed & quality', cost: '$3/$15' },
  { id: 'claude-sonnet-4-6-20250514', label: 'Sonnet 4.6', description: 'Latest balanced model', cost: '$3/$15' },
  { id: 'claude-opus-4-5-20250918', label: 'Opus 4.5', description: 'High quality', cost: '$5/$25' },
  { id: 'claude-opus-4-6-20250918', label: 'Opus 4.6', description: 'Most capable', cost: '$15/$75' },
];

/* ── JSON validation ───────────────────────────────────── */

function validateJsonFields(
  content: string,
  fields: NonNullable<RequiredInput['schema']>['fields'],
): { warnings: string[] } {
  if (!fields || fields.length === 0) return { warnings: [] };
  try {
    const data = JSON.parse(content);
    const warnings: string[] = [];
    for (const field of fields) {
      if (field.required !== false && !(field.key in data)) {
        warnings.push(`Missing required field: "${field.key}"`);
      }
    }
    return { warnings };
  } catch {
    return { warnings: ['Invalid JSON'] };
  }
}

const FORMAT_COLORS: Record<string, string> = {
  json: 'bg-amber-100 text-amber-700',
  text: 'bg-blue-100 text-blue-700',
  markdown: 'bg-purple-100 text-purple-700',
  pdf: 'bg-red-100 text-red-700',
  csv: 'bg-green-100 text-green-700',
};

/* ── InputWizard ──────────────────────────────────────── */

export function InputWizard({
  projectId,
  onStartRun,
  onCancel,
  error,
}: {
  projectId: string;
  onStartRun: (runner: RunnerType, files: File[], model?: string) => void;
  onCancel: () => void;
  error?: string | null;
}) {
  const [requiredInputs, setRequiredInputs] = useState<RequiredInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [runner, setRunner] = useState<RunnerType>('mock');
  const [model, setModel] = useState(MODELS[0].id); // Default to cheapest (Haiku)
  const [fileMap, setFileMap] = useState<Record<string, File>>({});
  const [warningsMap, setWarningsMap] = useState<Record<string, string[]>>({});
  const [extraFiles, setExtraFiles] = useState<File[]>([]);

  useEffect(() => {
    api.flows.requiredInputs(projectId)
      .then((data) => setRequiredInputs(data.requiredInputs as RequiredInput[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

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

  const handleStart = useCallback(() => {
    const allFiles = [...Object.values(fileMap), ...extraFiles];
    onStartRun(runner, allFiles, runner !== 'mock' ? model : undefined);
  }, [fileMap, extraFiles, runner, model, onStartRun]);

  const allRequiredFilled = requiredInputs.every((input) => fileMap[input.name]);

  return (
    <div className="h-full flex flex-col bg-white max-w-2xl mx-auto">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[var(--color-border)] shrink-0">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">New Run</h2>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Configure your run and provide any required input files
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Runner selector */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] block mb-1.5">
            Runner
          </label>
          <div className="flex gap-2">
            {(['mock', 'local', 'docker'] as RunnerType[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRunner(r)}
                className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                  runner === r
                    ? 'border-[var(--color-node-agent)] bg-blue-50 text-[var(--color-node-agent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-gray-50'
                }`}
              >
                {r === 'mock' ? 'Mock' : r === 'local' ? 'Local' : 'Docker'}
              </button>
            ))}
          </div>
        </div>

        {/* Model selector (shown for non-mock runners) */}
        {runner !== 'mock' && (
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] block mb-1.5">
              Model
            </label>
            <div className="space-y-1">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModel(m.id)}
                  className={`w-full flex items-center gap-3 text-left text-xs px-3 py-2 rounded border transition-colors ${
                    model === m.id
                      ? 'border-[var(--color-node-agent)] bg-blue-50'
                      : 'border-[var(--color-border)] hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${model === m.id ? 'bg-[var(--color-node-agent)]' : 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${model === m.id ? 'text-[var(--color-node-agent)]' : 'text-[var(--color-text-primary)]'}`}>
                        {m.label}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)] font-mono">{m.cost}/M</span>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)]">{m.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Required inputs */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-[var(--color-text-muted)]">Loading required inputs...</span>
          </div>
        ) : requiredInputs.length === 0 ? (
          <div className="rounded border border-[var(--color-border)] p-4 text-center">
            <span className="text-xs text-[var(--color-text-muted)]">
              No input files required. Ready to start.
            </span>
          </div>
        ) : (
          <>
            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] block">
              Required Inputs ({requiredInputs.length})
            </label>
            {requiredInputs.map((input) => (
              <FileInputRow
                key={input.name}
                input={input}
                file={fileMap[input.name] ?? null}
                onFileChange={(file) => {
                  if (file) {
                    handleFileSelected(input.name, file, input.schema);
                  } else {
                    setFileMap((prev) => { const next = { ...prev }; delete next[input.name]; return next; });
                    setWarningsMap((prev) => { const next = { ...prev }; delete next[input.name]; return next; });
                  }
                }}
                warnings={warningsMap[input.name] ?? []}
              />
            ))}
          </>
        )}

        {/* Extra files */}
        {!loading && (
          <AdditionalFiles files={extraFiles} onFilesChange={setExtraFiles} />
        )}
      </div>

      {/* Validation error banner */}
      {error && (
        <div className="mx-6 mb-0 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-2">
            <span className="text-red-600 text-sm font-bold shrink-0">{'\u2717'}</span>
            <div className="text-xs text-red-700 leading-relaxed">
              {error}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 py-4 border-t border-[var(--color-border)] flex items-center justify-end gap-2 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium px-3 py-1.5 rounded text-[var(--color-text-secondary)] hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleStart}
          disabled={loading || (requiredInputs.length > 0 && !allRequiredFilled)}
          className="text-xs font-medium px-4 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Start Run
        </button>
      </div>
    </div>
  );
}

/* ── FileInputRow ─────────────────────────────────────── */

function FileInputRow({
  input, file, onFileChange, warnings,
}: {
  input: RequiredInput;
  file: File | null;
  onFileChange: (file: File | null) => void;
  warnings: string[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const format = input.schema?.format ?? 'text';
  const formatColor = FORMAT_COLORS[format] ?? 'bg-gray-100 text-gray-700';

  return (
    <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${formatColor}`}>{format}</span>
        <span className="text-xs font-medium text-[var(--color-text-primary)]">{input.name}</span>
      </div>
      {input.schema?.description && (
        <p className="text-xs text-[var(--color-text-muted)]">{input.schema.description}</p>
      )}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e: DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onFileChange(f); }}
        onClick={() => fileInputRef.current?.click()}
        className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-md px-3 py-3 cursor-pointer transition-colors ${
          dragOver ? 'border-[var(--color-node-agent)] bg-blue-50' : file ? 'border-emerald-300 bg-emerald-50' : 'border-[var(--color-border)] hover:border-[var(--color-node-agent)]'
        }`}
      >
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => { const s = e.target.files?.[0]; if (s) onFileChange(s); }} />
        {file ? (
          <div className="flex items-center gap-2 w-full">
            <span className="text-xs text-emerald-700 font-medium truncate flex-1">{file.name}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); onFileChange(null); }} className="text-[10px] text-red-500 hover:text-red-700 font-medium">Remove</button>
          </div>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">Drop a file or click to browse</span>
        )}
      </div>
      {warnings.length > 0 && warnings.map((w, i) => (
        <div key={i} className="text-[10px] text-amber-600">{w}</div>
      ))}
    </div>
  );
}

/* ── Additional files ─────────────────────────────────── */

function AdditionalFiles({ files, onFilesChange }: { files: File[]; onFilesChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="border-t border-[var(--color-border)] pt-3">
      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] block mb-1.5">
        Additional Context (optional)
      </label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e: DragEvent) => { e.preventDefault(); setDragOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) onFilesChange([...files, ...f]); }}
        onClick={() => ref.current?.click()}
        className={`flex items-center justify-center border-2 border-dashed rounded-md px-3 py-2 cursor-pointer transition-colors ${
          dragOver ? 'border-[var(--color-node-agent)] bg-blue-50' : 'border-[var(--color-border)] hover:border-[var(--color-node-agent)]'
        }`}
      >
        <input ref={ref} type="file" multiple className="hidden" onChange={(e) => { const s = Array.from(e.target.files ?? []); if (s.length) onFilesChange([...files, ...s]); }} />
        <span className="text-[10px] text-[var(--color-text-muted)]">Drop files or click to browse</span>
      </div>
      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1">{f.name}</span>
              <button type="button" onClick={() => onFilesChange(files.filter((_, j) => j !== i))} className="text-[10px] text-red-500">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
