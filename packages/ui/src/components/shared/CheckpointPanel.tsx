import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { CheckpointState, CheckpointExpectedFile, ArtifactSchema } from '@forgeflow/types';
import { marked } from 'marked';
import { useRun } from '../../context/RunContext';
import { api } from '../../lib/api-client';
import { ArtifactViewer } from './ArtifactViewer';
import { SchemaForm, formValuesToJson, isFormComplete } from './SchemaForm';

interface CheckpointPanelProps {
  projectId: string;
  checkpoint: CheckpointState;
  runId: string;
  /** Override outer container className (default: inline shrink-0 style) */
  className?: string;
  /** Hide the internal header (when the parent already renders one) */
  hideHeader?: boolean;
}

/* ── Expected file entry state ─── */

interface ExpectedEntry {
  fileName: string;
  schema?: ArtifactSchema;
  mode: 'form' | 'textarea' | 'upload';
  formValues: Record<string, string>;
  rawContent: string;
  valid: boolean | null;
  errors: string[];
  validating: boolean;
}

function pickMode(ef: CheckpointExpectedFile): ExpectedEntry['mode'] {
  const format = ef.schema?.format;
  const hasFields = ef.schema?.fields && ef.schema.fields.length > 0;
  if (format === 'json' && hasFields) return 'form';
  if (format === 'json' || format === 'text' || format === 'markdown') return 'textarea';
  return 'upload';
}

function base64Encode(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

async function fetchPresentedFile(runId: string, fileName: string): Promise<{ text: string; resolvedName: string }> {
  const result = await api.runs.getOutputResponse(runId, fileName);
  return { text: result.text, resolvedName: result.resolvedName };
}

/* ── Presented file state ─── */

const BINARY_FORMATS = new Set(['pdf', 'image', 'binary']);

function isBinaryFormat(schema?: ArtifactSchema): boolean {
  return schema?.format ? BINARY_FORMATS.has(schema.format) : false;
}

function isBinaryExtension(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext);
}

interface PresentedFile {
  fileName: string;
  resolvedName: string | null;
  schema?: ArtifactSchema;
  content: string | null;
  binary: boolean;
  loading: boolean;
  error: string | null;
  expanded: boolean;
}

/* ── Main component ─── */

export function CheckpointPanel({ projectId, checkpoint, runId, className, hideHeader }: CheckpointPanelProps) {
  const { resumeFromCheckpoint } = useRun();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const isEscalated = checkpoint.presentation?.sections?.includes('escalated_interrupt') ?? false;

  // Build expected files list
  const expectedFiles = checkpoint.expectedFiles ?? (checkpoint.waitingForFile
    ? [{ fileName: checkpoint.waitingForFile, provided: false }]
    : []);

  // ── Presented files state ──
  const [presentedFiles, setPresentedFiles] = useState<PresentedFile[]>(() =>
    checkpoint.presentFiles.map((fileName, i) => {
      const schema = checkpoint.presentSchemas?.[fileName];
      const binary = isBinaryFormat(schema);
      return {
        fileName,
        resolvedName: null,
        schema,
        content: null,
        binary,
        loading: !binary, // binary files don't need text loading
        error: null,
        expanded: i === 0,
      };
    }),
  );

  // Fetch presented file contents on mount
  useEffect(() => {
    if (!runId || checkpoint.presentFiles.length === 0) return;
    let cancelled = false;

    for (const fileName of checkpoint.presentFiles) {
      const schema = checkpoint.presentSchemas?.[fileName];
      if (isBinaryFormat(schema)) continue; // binary files use URL, skip text fetch

      fetchPresentedFile(runId, fileName)
        .then(({ text, resolvedName }) => {
          if (cancelled) return;
          // Check if resolved file is actually binary (e.g., extensionless name resolved to .pdf)
          const resolvedBinary = isBinaryExtension(resolvedName);
          setPresentedFiles((prev) =>
            prev.map((f) => f.fileName === fileName
              ? { ...f, content: resolvedBinary ? null : text, resolvedName, binary: resolvedBinary, loading: false }
              : f),
          );
        })
        .catch((err) => {
          if (cancelled) return;
          setPresentedFiles((prev) =>
            prev.map((f) => f.fileName === fileName
              ? { ...f, loading: false, error: err instanceof Error ? err.message : 'Failed to load' }
              : f),
          );
        });
    }

    return () => { cancelled = true; };
  }, [runId, checkpoint.presentFiles]);

  const togglePresented = useCallback((fileName: string) => {
    setPresentedFiles((prev) =>
      prev.map((f) => f.fileName === fileName ? { ...f, expanded: !f.expanded } : f),
    );
  }, []);

  // ── Expected files state ──
  const [entries, setEntries] = useState<ExpectedEntry[]>(() =>
    expectedFiles.map((ef) => ({
      fileName: ef.fileName,
      schema: ef.schema,
      mode: pickMode(ef),
      formValues: {},
      rawContent: '',
      valid: null,
      errors: [],
      validating: false,
    })),
  );

  const updateEntry = useCallback((fileName: string, updates: Partial<ExpectedEntry>) => {
    setEntries((prev) =>
      prev.map((e) => e.fileName === fileName ? { ...e, ...updates } : e),
    );
  }, []);

  const handleFileUpload = useCallback((fileName: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      updateEntry(fileName, { rawContent: reader.result as string, valid: null, errors: [] });
    };
    reader.readAsText(file);
  }, [updateEntry]);

  const handleValidate = useCallback(async (fileName: string, content: string) => {
    if (!runId || !content.trim()) return;
    updateEntry(fileName, { validating: true });
    try {
      const result = await api.runs.validateCheckpointFile(runId, fileName, base64Encode(content));
      updateEntry(fileName, { valid: result.valid, errors: result.errors, validating: false });
    } catch {
      updateEntry(fileName, { valid: null, errors: ['Validation request failed'], validating: false });
    }
  }, [runId, updateEntry]);

  // Get effective content for an entry
  const getContent = (entry: ExpectedEntry): string => {
    if (entry.mode === 'form' && entry.schema?.fields?.length) {
      return formValuesToJson(entry.schema.fields, entry.formValues);
    }
    return entry.rawContent;
  };

  // Check if entry is filled
  const isFilled = (entry: ExpectedEntry): boolean => {
    if (entry.mode === 'form' && entry.schema?.fields?.length) {
      return isFormComplete(entry.schema.fields, entry.formValues);
    }
    return entry.rawContent.trim().length > 0;
  };

  const allFilled = entries.every(isFilled);
  const anyInvalid = entries.some((e) => e.valid === false);
  const filledCount = entries.filter(isFilled).length;

  const handleSubmit = async () => {
    if (!allFilled) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const files = entries.map((e) => ({
        fileName: e.fileName,
        content: base64Encode(getContent(e)),
      }));
      await resumeFromCheckpoint(projectId, files);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to resume');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──

  const headerBg = isEscalated ? 'bg-red-50' : 'bg-amber-50';
  const headerBorder = isEscalated ? 'border-red-200' : 'border-amber-200';
  const headerIcon = isEscalated ? 'text-red-600' : 'text-amber-600';
  const headerText = isEscalated ? 'text-red-800' : 'text-amber-800';

  return (
    <div className={className ?? `shrink-0 border-b ${isEscalated ? 'border-red-300' : 'border-amber-300'} max-h-[70vh] overflow-y-auto`}>
      {/* Escalation warning */}
      {isEscalated && !hideHeader && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-100 border-b border-red-200">
          <span className="text-red-600 text-xs font-bold">{'\u26A0'}</span>
          <span className="text-[11px] text-red-700">
            An inline interrupt timed out and was escalated. Execution is paused.
          </span>
        </div>
      )}

      {/* Header */}
      {!hideHeader && (
        <div className={`flex items-center gap-2 px-4 py-2 border-b ${headerBorder} ${headerBg}`}>
          <span className={`${headerIcon} font-bold text-xs`}>{'\u23F8'}</span>
          <span className={`text-xs font-semibold ${headerText} flex-1`}>
            {isEscalated ? 'Escalated Interrupt' : 'Checkpoint'}: {checkpoint.presentation?.title ?? checkpoint.checkpointNodeId}
          </span>
          {checkpoint.costSoFar && (
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {checkpoint.costSoFar.turns} turns &middot; ${checkpoint.costSoFar.usd.toFixed(2)}
            </span>
          )}
        </div>
      )}

      <div className="bg-white">
        {/* ── Instructions text ── */}
        {checkpoint.instructions && (
          <InstructionsBlock text={checkpoint.instructions} />
        )}

        {/* ── PRESENTS section ── */}
        {presentedFiles.length > 0 && (
          <div className="border-b border-[var(--color-border)]">
            <div className="px-4 py-2 bg-[var(--color-canvas-bg)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Review before proceeding
              </span>
            </div>
            <div className="divide-y divide-[var(--color-border)]/40">
              {presentedFiles.map((pf) => (
                <div key={pf.fileName}>
                  {/* Collapsible header */}
                  <button
                    type="button"
                    onClick={() => togglePresented(pf.fileName)}
                    className="w-full flex items-center gap-2 px-4 py-1.5 hover:bg-[var(--color-canvas-bg)]/50 transition-colors"
                  >
                    <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                      {pf.expanded ? '\u25BC' : '\u25B6'}
                    </span>
                    <span className="text-[11px] font-mono font-medium text-[var(--color-text-primary)] flex-1 text-left truncate">
                      {pf.fileName}
                    </span>
                    {pf.schema?.format && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-canvas-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)] shrink-0">
                        {pf.schema.format}
                      </span>
                    )}
                    {pf.schema?.fields?.length ? (
                      <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">
                        {pf.schema.fields.length} fields
                      </span>
                    ) : null}
                    {pf.loading && (
                      <span className="text-[10px] text-[var(--color-text-muted)] italic shrink-0">loading...</span>
                    )}
                  </button>

                  {/* Expanded content */}
                  {pf.expanded && (
                    <div className="px-4 pb-3">
                      {pf.loading && (
                        <div className="py-2">
                          <div className="h-4 w-3/4 bg-gray-100 rounded animate-pulse" />
                          <div className="h-4 w-1/2 bg-gray-100 rounded animate-pulse mt-1" />
                        </div>
                      )}
                      {pf.error && (
                        <div className="text-[11px] text-red-500 py-1">{pf.error}</div>
                      )}
                      {!pf.loading && !pf.error && (pf.content !== null || pf.binary) && (
                        <ArtifactViewer
                          content={pf.binary ? undefined : (pf.content ?? undefined)}
                          fileUrl={pf.binary ? api.runs.getOutputFileUrl(runId, pf.fileName) : undefined}
                          fileName={pf.resolvedName ?? pf.fileName}
                          schema={pf.schema}
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── EXPECTS section ── */}
        {entries.length > 0 && (
          <div className="border-b border-[var(--color-border)]">
            <div className="px-4 py-2 bg-[var(--color-canvas-bg)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Provide to continue
              </span>
            </div>
            <div className="px-4 py-3 space-y-4">
              {entries.map((entry) => (
                <ExpectedFileInput
                  key={entry.fileName}
                  entry={entry}
                  onUpdate={(updates) => updateEntry(entry.fileName, updates)}
                  onFileUpload={(file) => handleFileUpload(entry.fileName, file)}
                  onValidate={() => handleValidate(entry.fileName, getContent(entry))}
                  fileInputRef={(el) => { if (el) fileInputRefs.current.set(entry.fileName, el); }}
                  triggerFileDialog={() => fileInputRefs.current.get(entry.fileName)?.click()}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-4 py-3 flex items-center gap-3">
          {submitError && (
            <span className="text-[11px] text-red-600 flex-1">{submitError}</span>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !allFilled || anyInvalid}
            className="text-xs font-semibold px-5 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            {submitting
              ? 'Resuming...'
              : entries.length > 1
                ? `Resume (${filledCount}/${entries.length} ready)`
                : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Instructions block (markdown) ─── */

function InstructionsBlock({ text }: { text: string }) {
  const html = useMemo(() => {
    return marked.parse(text, { async: false, breaks: true }) as string;
  }, [text]);

  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)]">
      <div
        className="prose prose-sm max-w-none text-[12px] leading-relaxed text-[var(--color-text-primary)] [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-sm [&_h2]:text-[13px] [&_h3]:text-[12px] [&_code]:text-[11px] [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/* ── Expected file input ─── */

interface ExpectedFileInputProps {
  entry: ExpectedEntry;
  onUpdate: (updates: Partial<ExpectedEntry>) => void;
  onFileUpload: (file: File) => void;
  onValidate: () => void;
  fileInputRef: (el: HTMLInputElement | null) => void;
  triggerFileDialog: () => void;
}

function ExpectedFileInput({ entry, onUpdate, onFileUpload, onValidate, fileInputRef, triggerFileDialog }: ExpectedFileInputProps) {
  const { schema } = entry;
  const hasFields = schema?.fields && schema.fields.length > 0;
  const formatLabel = schema?.format ?? 'text';

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-canvas-bg)] border-b border-[var(--color-border)]">
        <span className="text-[11px] font-mono font-medium text-[var(--color-text-primary)] flex-1 truncate">
          {entry.fileName}
        </span>
        {schema?.description && (
          <span className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[200px]" title={schema.description}>
            {schema.description}
          </span>
        )}
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white text-[var(--color-text-muted)] border border-[var(--color-border)] shrink-0">
          {formatLabel}
        </span>
        {hasFields && (
          <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">
            {schema!.fields!.length} fields
          </span>
        )}
        {/* Validation status */}
        {entry.validating && <span className="text-[10px] text-amber-600 shrink-0">validating...</span>}
        {entry.valid === true && <span className="text-[10px] text-green-600 shrink-0">{'\u2713'} Valid</span>}
        {entry.valid === false && <span className="text-[10px] text-red-600 shrink-0">{'\u2717'} Invalid</span>}
      </div>

      {/* Input area */}
      <div className="p-3">
        {/* FORM mode */}
        {entry.mode === 'form' && hasFields && (
          <div className="space-y-2">
            <SchemaForm
              schema={schema!}
              values={entry.formValues}
              onChange={(formValues) => onUpdate({ formValues, valid: null, errors: [] })}
            />
            <div className="flex items-center gap-2 pt-1 border-t border-[var(--color-border)]/30">
              <button
                type="button"
                onClick={() => {
                  const content = formValuesToJson(schema!.fields!, entry.formValues);
                  onUpdate({ mode: 'textarea', rawContent: content });
                }}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline"
              >
                Switch to raw JSON
              </button>
              <button
                type="button"
                onClick={onValidate}
                disabled={!isFormComplete(schema!.fields!, entry.formValues)}
                className="text-[10px] font-medium px-2 py-0.5 rounded border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] disabled:opacity-40"
              >
                Validate
              </button>
            </div>
          </div>
        )}

        {/* TEXTAREA mode */}
        {entry.mode === 'textarea' && (
          <div className="space-y-2">
            <textarea
              value={entry.rawContent}
              onChange={(e) => onUpdate({ rawContent: e.target.value, valid: null, errors: [] })}
              placeholder={formatLabel === 'json' ? '{\n  "field": "value"\n}' : `Enter ${entry.fileName} content...`}
              rows={formatLabel === 'json' ? 6 : 4}
              className="w-full text-[11px] px-2.5 py-1.5 border border-[var(--color-border)] rounded bg-white font-mono focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 focus:outline-none transition-colors resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={triggerFileDialog}
                className="text-[10px] font-medium px-2 py-0.5 rounded border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]"
              >
                Upload file
              </button>
              <button
                type="button"
                onClick={onValidate}
                disabled={!entry.rawContent.trim()}
                className="text-[10px] font-medium px-2 py-0.5 rounded border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] disabled:opacity-40"
              >
                Validate
              </button>
              {hasFields && (
                <button
                  type="button"
                  onClick={() => {
                    let parsed: Record<string, string> = {};
                    try {
                      const obj = JSON.parse(entry.rawContent);
                      for (const field of schema!.fields!) {
                        if (obj[field.key] !== undefined) {
                          const val = obj[field.key];
                          parsed[field.key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
                        }
                      }
                    } catch { /* ignore */ }
                    onUpdate({ mode: 'form', formValues: parsed });
                  }}
                  className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline"
                >
                  Switch to form
                </button>
              )}
            </div>
          </div>
        )}

        {/* UPLOAD mode */}
        {entry.mode === 'upload' && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={triggerFileDialog}
              className="text-[11px] font-medium px-3 py-1.5 rounded border border-dashed border-[var(--color-border)] bg-[var(--color-canvas-bg)] text-[var(--color-text-secondary)] hover:border-blue-400 hover:text-blue-600 transition-colors w-full"
            >
              {entry.rawContent ? `File loaded (${entry.rawContent.length} chars) \u2014 click to replace` : 'Click to choose file'}
            </button>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileUpload(file);
            e.target.value = '';
          }}
          className="hidden"
        />

        {/* Validation errors */}
        {entry.errors.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {entry.errors.map((err, i) => (
              <div key={i} className="text-[11px] text-red-600">
                {'\u2022'} {err}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
