import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { marked } from 'marked';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import '../../lib/pdf-worker';
import { api } from '../../lib/api-client';

interface ReferenceViewerProps {
  refPath: string;
}

function getFileType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'json') return 'json';
  if (ext === 'txt') return 'txt';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  return 'other';
}

export function ReferenceViewer({ refPath }: ReferenceViewerProps) {
  const { id: projectId } = useParams<{ id: string }>();
  const fileType = getFileType(refPath);
  const fileName = refPath.split('/').pop() ?? refPath;

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)]">
        No project context
      </div>
    );
  }

  if (fileType === 'pdf') {
    return <PdfViewer projectId={projectId} refPath={refPath} />;
  }
  if (fileType === 'image') {
    return <ImageViewer projectId={projectId} refPath={refPath} fileName={fileName} />;
  }

  return <TextBasedViewer projectId={projectId} refPath={refPath} fileType={fileType} />;
}

/* ── PDF Viewer (react-pdf) ─────────────────────────────── */

function PdfViewer({ projectId, refPath }: { projectId: string; refPath: string }) {
  const [numPages, setNumPages] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const fileUrl = api.references.getFileUrl(projectId, refPath);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-[var(--color-text-muted)]">
        <div className="w-16 h-20 rounded-lg border-2 border-red-300 flex items-center justify-center">
          <span className="text-2xl font-bold text-red-400">PDF</span>
        </div>
        <div className="text-xs text-center max-w-xs text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 flex flex-col items-center">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={(err) => setError(err?.message ?? 'Failed to load PDF')}
        loading={
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
              <div className="w-4 h-4 border-2 border-[var(--color-node-agent)] border-t-transparent rounded-full animate-spin" />
              Loading PDF...
            </div>
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            width={700}
            className="mb-4 shadow-md"
            renderTextLayer
            renderAnnotationLayer
          />
        ))}
      </Document>
      {numPages > 0 && (
        <div className="text-[10px] text-[var(--color-text-muted)] py-2">
          {numPages} page{numPages !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

/* ── Image Viewer ───────────────────────────────────────── */

function ImageViewer({ projectId, refPath, fileName }: { projectId: string; refPath: string; fileName: string }) {
  const fileUrl = api.references.getFileUrl(projectId, refPath);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--color-text-muted)]">
        <span className="text-sm">Failed to load image</span>
        <span className="text-xs font-mono">{fileName}</span>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center overflow-auto p-4 bg-[var(--color-canvas-bg)]">
      <img
        src={fileUrl}
        alt={fileName}
        className="max-w-full max-h-full object-contain"
        onError={() => setError(true)}
      />
    </div>
  );
}

/* ── Text-based Viewer (md, json, txt, other) ───────────── */

function TextBasedViewer({ projectId, refPath, fileType }: { projectId: string; refPath: string; fileType: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    api.references.getTextContent(projectId, refPath)
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [projectId, refPath]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
          <div className="w-4 h-4 border-2 border-[var(--color-node-agent)] border-t-transparent rounded-full animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-red-500">
        {error}
      </div>
    );
  }

  const text = content ?? '';

  if (fileType === 'md') return <MarkdownViewer content={text} />;
  if (fileType === 'json') return <JsonViewer content={text} />;
  return <TextViewer content={text} />;
}

/* ── Markdown Viewer ────────────────────────────────────── */

function MarkdownViewer({ content }: { content: string }) {
  const html = useMemo(() => {
    return marked.parse(content, { async: false }) as string;
  }, [content]);

  return (
    <div className="h-full overflow-auto p-6">
      <div
        className="prose prose-sm max-w-none
          [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:text-[var(--color-text-primary)]
          [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[var(--color-text-primary)]
          [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[var(--color-text-primary)]
          [&_p]:text-xs [&_p]:text-[var(--color-text-secondary)] [&_p]:mb-2 [&_p]:leading-relaxed
          [&_ul]:text-xs [&_ul]:text-[var(--color-text-secondary)] [&_ul]:mb-2 [&_ul]:pl-4
          [&_ol]:text-xs [&_ol]:text-[var(--color-text-secondary)] [&_ol]:mb-2 [&_ol]:pl-4
          [&_li]:mb-0.5
          [&_strong]:text-[var(--color-text-primary)]
          [&_code]:text-xs [&_code]:bg-[var(--color-canvas-bg)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
          [&_pre]:bg-[var(--color-canvas-bg)] [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:text-xs [&_pre]:overflow-x-auto
          [&_table]:text-xs [&_table]:w-full [&_table]:border-collapse
          [&_th]:text-left [&_th]:px-3 [&_th]:py-1.5 [&_th]:border [&_th]:border-[var(--color-border)] [&_th]:bg-[var(--color-canvas-bg)] [&_th]:font-semibold
          [&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-[var(--color-border)]
          [&_hr]:border-[var(--color-border)] [&_hr]:my-4
          [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-node-agent)] [&_blockquote]:pl-3 [&_blockquote]:text-xs [&_blockquote]:text-[var(--color-text-muted)]
        "
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/* ── JSON Viewer ────────────────────────────────────────── */

function JsonViewer({ content }: { content: string }) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }, [content]);

  if (!parsed) {
    return <TextViewer content={content} />;
  }

  return (
    <div className="h-full overflow-auto p-4">
      <JsonNode value={parsed} name={null} depth={0} />
    </div>
  );
}

function JsonNode({ value, name, depth }: { value: unknown; name: string | null; depth: number }) {
  if (value === null) {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: `${depth * 16}px` }}>
        {name !== null && <span className="text-xs text-[var(--color-node-agent)] font-medium">{name}</span>}
        <span className="text-xs text-[var(--color-text-muted)] italic">null</span>
      </div>
    );
  }

  if (typeof value === 'string') {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: `${depth * 16}px` }}>
        {name !== null && <span className="text-xs text-[var(--color-node-agent)] font-medium">{name}</span>}
        <span className="text-xs text-green-600">"{value}"</span>
      </div>
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: `${depth * 16}px` }}>
        {name !== null && <span className="text-xs text-[var(--color-node-agent)] font-medium">{name}</span>}
        <span className="text-xs text-[var(--color-node-checkpoint)]">{String(value)}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div>
        <div className="flex items-baseline gap-1" style={{ paddingLeft: `${depth * 16}px` }}>
          {name !== null && <span className="text-xs text-[var(--color-node-agent)] font-medium">{name}</span>}
          <span className="text-[10px] text-[var(--color-text-muted)]">[{value.length}]</span>
        </div>
        {value.map((item, i) => (
          <JsonNode key={i} value={item} name={String(i)} depth={depth + 1} />
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div>
        {name !== null && (
          <div className="flex items-baseline gap-1" style={{ paddingLeft: `${depth * 16}px` }}>
            <span className="text-xs text-[var(--color-node-agent)] font-medium">{name}</span>
            <span className="text-[10px] text-[var(--color-text-muted)]">{`{${entries.length}}`}</span>
          </div>
        )}
        {entries.map(([key, val]) => (
          <JsonNode key={key} value={val} name={key} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: `${depth * 16}px` }}>
      <span className="text-xs text-[var(--color-text-muted)]">{String(value)}</span>
    </div>
  );
}

/* ── Text Viewer ────────────────────────────────────────── */

function TextViewer({ content }: { content: string }) {
  return (
    <div className="h-full overflow-auto p-4">
      <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
        {content}
      </pre>
    </div>
  );
}
