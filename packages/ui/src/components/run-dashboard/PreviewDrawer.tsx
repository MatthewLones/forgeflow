import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api-client';
import { ArtifactViewer } from '../shared/ArtifactViewer';

export interface PreviewTarget {
  type: 'workspace' | 'artifact';
  runId: string;
  phaseId?: string;
  filePath: string;
  projectId?: string;
}

const BINARY_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'zip', 'tar', 'gz']);

function isBinaryFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

export function PreviewDrawer({
  target,
  onClose,
}: {
  target: PreviewTarget | null;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fileName = target ? (target.filePath.split('/').pop() ?? target.filePath) : '';
  const binary = target ? isBinaryFile(target.filePath) : false;

  // Build direct URL for binary files
  const fileUrl = target
    ? target.type === 'workspace' && target.phaseId
      ? api.runs.getWorkspaceFileUrl(target.runId, target.phaseId, target.filePath)
      : api.runs.getOutputFileUrl(target.runId, target.filePath)
    : undefined;

  useEffect(() => {
    if (!target) {
      setContent(null);
      return;
    }

    // Binary files use URL-based rendering, no text fetch needed
    if (binary) {
      setContent(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (target.type === 'workspace' && target.phaseId) {
          const text = await api.runs.getWorkspaceFileText(target.runId, target.phaseId, target.filePath);
          setContent(text);
        } else {
          const text = await api.runs.getOutputText(target.runId, target.filePath);
          setContent(text);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [target, binary]);

  if (!target) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[480px] max-w-[80vw] bg-white shadow-2xl border-l border-[var(--color-border)] flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate flex-1">
            {target.phaseId && <span className="text-[var(--color-text-muted)]">{target.phaseId}/</span>}
            {fileName}
          </span>
          {target.projectId && (
            <button
              type="button"
              onClick={() => navigate(`/workspace/${target.projectId}`)}
              className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-[var(--color-text-secondary)] hover:bg-gray-50"
            >
              Open in IDE
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-sm font-bold"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="text-xs text-[var(--color-text-muted)] italic">Loading...</div>
          )}
          {error && (
            <div className="text-xs text-red-500">{error}</div>
          )}
          {!loading && !error && (
            <ArtifactViewer
              content={binary ? undefined : (content ?? undefined)}
              fileUrl={fileUrl}
              fileName={target.filePath}
            />
          )}
        </div>
      </div>
    </>
  );
}
