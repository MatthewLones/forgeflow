import { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import { api, type CompilePreviewResult } from '../../lib/api-client';
import type { FlowDefinition } from '@forgeflow/types';

interface NodePromptDrawerProps {
  nodeId: string | null;
  projectId: string;
  flow: FlowDefinition | null;
  onClose: () => void;
}

export function NodePromptDrawer({ nodeId, projectId, flow, onClose }: NodePromptDrawerProps) {
  const [compileResult, setCompileResult] = useState<CompilePreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!nodeId || !flow) return;

    // Cache by projectId — flow doesn't change during a run
    const key = projectId;
    if (compileResult && cacheKeyRef.current === key) return;

    setLoading(true);
    setError(null);
    cacheKeyRef.current = key;

    api.flows.compilePreview(flow, projectId)
      .then(setCompileResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to compile'))
      .finally(() => setLoading(false));
  }, [nodeId, flow, projectId, compileResult]);

  if (!nodeId) return null;

  const phase = compileResult?.phases.find((p) => p.nodeId === nodeId);
  const nodeName = flow?.nodes.find((n) => n.id === nodeId)?.name ?? nodeId;

  const promptHtml = phase?.prompt
    ? marked.parse(phase.prompt, { async: false }) as string
    : null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[560px] max-w-[85vw] bg-white shadow-2xl border-l border-[var(--color-border)] flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate flex-1">
            {nodeName}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">Compiled Prompt</span>
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
            <div className="text-xs text-[var(--color-text-muted)] italic">Compiling...</div>
          )}
          {error && (
            <div className="text-xs text-red-500">{error}</div>
          )}
          {!loading && !error && !phase && compileResult && (
            <div className="text-xs text-[var(--color-text-muted)]">
              No compiled prompt found for this node.
            </div>
          )}
          {promptHtml && (
            <div
              className="prose-skill"
              dangerouslySetInnerHTML={{ __html: promptHtml }}
            />
          )}
        </div>
      </div>
    </>
  );
}
