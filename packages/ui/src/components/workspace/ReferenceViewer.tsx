import { useMemo, useState, useEffect } from 'react';
import { marked } from 'marked';
import { isElectron, getElectronAPI } from '../../lib/electron';

interface ReferenceViewerProps {
  refPath: string;
}

/** Mock content — in production this would load from the project store / filesystem */
const MOCK_CONTENT: Record<string, { content: string; type: string }> = {
  'contract.pdf': {
    content: '',
    type: 'pdf',
  },
  'standards-height.md': {
    content: `# ADU Height Standards

## Maximum Height Limits

- **Detached ADU:** 16 feet maximum
- **Attached ADU:** Cannot exceed height of primary dwelling
- **Two-story ADU:** Requires special permit if > 16 feet

## Setback Requirements

| Zone | Front | Side | Rear |
|------|-------|------|------|
| R-1  | 20 ft | 5 ft | 4 ft |
| R-2  | 15 ft | 5 ft | 4 ft |
| R-3  | 10 ft | 3 ft | 4 ft |

## Notes

ADUs within 1/2 mile of public transit may have relaxed height limits up to 18 feet per AB 68.
`,
    type: 'md',
  },
  'compliance-rules.json': {
    content: JSON.stringify({
      version: '2.1',
      jurisdiction: 'Los Angeles County',
      rules: [
        {
          id: 'height-001',
          name: 'Maximum Height',
          condition: 'detached_adu',
          maxFeet: 16,
          exceptions: ['transit_proximity', 'lot_size_over_5000sqft'],
        },
        {
          id: 'setback-001',
          name: 'Rear Setback',
          condition: 'all_zones',
          minFeet: 4,
          exceptions: ['existing_garage_conversion'],
        },
      ],
    }, null, 2),
    type: 'json',
  },
  'regulations/height-limits.pdf': {
    content: '',
    type: 'pdf',
  },
  'regulations/setback-rules.md': {
    content: `# Setback Rules

## General Requirements

All ADUs must maintain minimum setbacks from property lines.

### Side Setbacks
- Minimum 4 feet for structures under 16 feet
- Minimum 5 feet for structures 16 feet and over

### Rear Setbacks
- Minimum 4 feet from rear property line
- No setback required for garage conversions
`,
    type: 'md',
  },
};

function getFileType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'json') return 'json';
  if (ext === 'txt') return 'txt';
  return 'other';
}

export function ReferenceViewer({ refPath }: ReferenceViewerProps) {
  const fileType = getFileType(refPath);
  const mock = MOCK_CONTENT[refPath];
  const fileName = refPath.split('/').pop() ?? refPath;

  if (fileType === 'pdf') {
    return <PdfViewer fileName={fileName} filePath={refPath} />;
  }

  if (fileType === 'md') {
    return <MarkdownViewer content={mock?.content ?? `*No content for ${refPath}*`} />;
  }

  if (fileType === 'json') {
    return <JsonViewer content={mock?.content ?? '{}'} />;
  }

  return <TextViewer content={mock?.content ?? `No content for ${refPath}`} />;
}

function PdfViewer({ fileName, filePath }: { fileName: string; filePath?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath || !isElectron()) return;

    let revoked = false;
    const api = getElectronAPI()!;
    api.fs.readFile(filePath).then((buffer) => {
      if (revoked) return;
      const blob = new Blob([buffer], { type: 'application/pdf' });
      setBlobUrl(URL.createObjectURL(blob));
    }).catch((err: unknown) => {
      if (revoked) return;
      setError(err instanceof Error ? err.message : 'Failed to load PDF');
    });

    return () => {
      revoked = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // Only re-run when filePath changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Electron with loaded PDF — render inline
  if (blobUrl) {
    return (
      <div className="h-full w-full">
        <embed src={blobUrl} type="application/pdf" className="w-full h-full" />
      </div>
    );
  }

  // Electron but file failed to load
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-[var(--color-text-muted)]">
        <div className="w-16 h-20 rounded-lg border-2 border-red-300 flex items-center justify-center">
          <span className="text-2xl font-bold text-red-400">PDF</span>
        </div>
        <div className="text-sm font-medium text-[var(--color-text-secondary)]">{fileName}</div>
        <div className="text-xs text-center max-w-xs text-red-500">{error}</div>
      </div>
    );
  }

  // Browser fallback — no Electron available
  if (!isElectron()) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-[var(--color-text-muted)]">
        <div className="w-16 h-20 rounded-lg border-2 border-[var(--color-border)] flex items-center justify-center">
          <span className="text-2xl font-bold text-red-400">PDF</span>
        </div>
        <div className="text-sm font-medium text-[var(--color-text-secondary)]">{fileName}</div>
        <div className="text-xs text-center max-w-xs">
          PDF viewing is available in the desktop app.
        </div>
      </div>
    );
  }

  // Electron but still loading
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-xs text-[var(--color-text-muted)]">Loading PDF...</div>
    </div>
  );
}

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

function TextViewer({ content }: { content: string }) {
  return (
    <div className="h-full overflow-auto p-4">
      <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
        {content}
      </pre>
    </div>
  );
}
