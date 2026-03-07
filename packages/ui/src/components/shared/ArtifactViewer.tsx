import { useState } from 'react';
import { marked } from 'marked';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '../../lib/pdf-worker';
import type { ArtifactSchema, ArtifactFormat } from '@forgeflow/types';
import { JsonDataView } from './JsonDataView';

interface ArtifactViewerProps {
  content?: string;
  fileUrl?: string;
  fileName: string;
  schema?: ArtifactSchema;
  format?: ArtifactFormat;
}

/**
 * Format-aware artifact content viewer.
 * Renders JSON as structured tables, markdown as HTML, CSV as tables,
 * PDF via react-pdf, images inline, and binary as download links.
 */
export function ArtifactViewer({ content, fileUrl, fileName, schema, format: formatOverride }: ArtifactViewerProps) {
  const format = formatOverride ?? schema?.format ?? inferFormat(fileName);

  if (format === 'pdf') {
    return <PdfPreview fileUrl={fileUrl} fileName={fileName} />;
  }

  if (format === 'image') {
    return <ImagePreview fileUrl={fileUrl} fileName={fileName} />;
  }

  if (format === 'binary') {
    return <BinaryDownload fileUrl={fileUrl} fileName={fileName} />;
  }

  // Text-based formats require content
  if (content == null) {
    return (
      <div className="text-[11px] text-[var(--color-text-muted)] italic">No content available</div>
    );
  }

  if (format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return (
        <div className="space-y-1">
          <div className="text-[10px] text-red-500 font-medium">Invalid JSON</div>
          <pre className="text-[11px] whitespace-pre-wrap break-words font-mono text-[var(--color-text-primary)] bg-[var(--color-canvas-bg)] rounded p-2">
            {content}
          </pre>
        </div>
      );
    }
    return <JsonDataView data={parsed} schema={schema} />;
  }

  if (format === 'markdown') {
    const html = marked.parse(content, { async: false }) as string;
    return (
      <div
        className="prose-skill text-[12px]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (format === 'csv') {
    return <CsvTable content={content} />;
  }

  // text, or unknown → styled pre
  return (
    <pre className="text-[11px] whitespace-pre-wrap break-words font-mono text-[var(--color-text-primary)] leading-relaxed">
      {content}
    </pre>
  );
}

/* ── Format inference ─────────────────────────────── */

function inferFormat(fileName: string): ArtifactFormat {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return 'image';
  return 'text';
}

/* ── PDF Preview ──────────────────────────────────── */

function PdfPreview({ fileUrl, fileName }: { fileUrl?: string; fileName: string }) {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!fileUrl) {
    return (
      <div className="text-[11px] text-[var(--color-text-muted)] italic">
        PDF preview requires a file URL &mdash; <span className="font-mono">{fileName}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-[var(--color-text-muted)]">
        <div className="w-12 h-14 rounded border-2 border-red-300 flex items-center justify-center">
          <span className="text-sm font-bold text-red-400">PDF</span>
        </div>
        <div className="text-[10px] text-red-500 text-center max-w-xs">{error}</div>
      </div>
    );
  }

  return (
    <div className="overflow-auto flex flex-col items-center">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={(err) => setError(err?.message ?? 'Failed to load PDF')}
        loading={
          <div className="flex items-center gap-2 py-6 text-xs text-[var(--color-text-muted)]">
            <div className="w-3 h-3 border-2 border-[var(--color-node-agent)] border-t-transparent rounded-full animate-spin" />
            Loading PDF...
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            width={600}
            className="mb-3 shadow-md"
            renderTextLayer
            renderAnnotationLayer
          />
        ))}
      </Document>
      {numPages > 0 && (
        <div className="text-[10px] text-[var(--color-text-muted)] py-1">
          {numPages} page{numPages !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

/* ── Image Preview ────────────────────────────────── */

function ImagePreview({ fileUrl, fileName }: { fileUrl?: string; fileName: string }) {
  const [error, setError] = useState(false);

  if (!fileUrl) {
    return (
      <div className="text-[11px] text-[var(--color-text-muted)] italic">
        Image preview requires a file URL &mdash; <span className="font-mono">{fileName}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-1 py-4 text-[var(--color-text-muted)]">
        <span className="text-xs">Failed to load image</span>
        <span className="text-[10px] font-mono">{fileName}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center overflow-auto py-2">
      <img
        src={fileUrl}
        alt={fileName}
        className="max-w-full max-h-[400px] object-contain rounded"
        onError={() => setError(true)}
      />
    </div>
  );
}

/* ── Binary Download ──────────────────────────────── */

function BinaryDownload({ fileUrl, fileName }: { fileUrl?: string; fileName: string }) {
  if (!fileUrl) {
    return (
      <div className="text-[11px] text-[var(--color-text-muted)] italic">
        Binary file: <span className="font-mono">{fileName}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2">
      <a
        href={fileUrl}
        download={fileName}
        className="text-[11px] font-medium px-3 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-canvas-bg)] text-[var(--color-text-secondary)] hover:bg-white transition-colors"
      >
        {'\u2B07'} Download {fileName}
      </a>
    </div>
  );
}

/* ── CSV Table ────────────────────────────────────── */

function CsvTable({ content }: { content: string }) {
  const lines = content.trim().split('\n');
  if (lines.length === 0) return <div className="text-[11px] text-[var(--color-text-muted)] italic">Empty CSV</div>;

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-[var(--color-canvas-bg)]">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-2 py-1 font-medium text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i} className="hover:bg-[var(--color-canvas-bg)]/50">
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1 text-[var(--color-text-primary)] border-b border-[var(--color-border)]/30">
                  {cell}
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
