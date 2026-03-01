import { useState, useRef } from 'react';
import type { CheckpointState } from '@forgeflow/types';
import { useRun } from '../../context/RunContext';

interface CheckpointBannerProps {
  projectId: string;
  checkpoint: CheckpointState;
}

export function CheckpointBanner({ projectId, checkpoint }: CheckpointBannerProps) {
  const { resumeFromCheckpoint } = useRun();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setContent(text);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      // Base64-encode the content
      const encoded = btoa(unescape(encodeURIComponent(content)));
      await resumeFromCheckpoint(projectId, checkpoint.waitingForFile, encoded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-amber-300 bg-amber-50">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-200">
        <span className="text-amber-600 font-bold text-xs">{'\u23F8'}</span>
        <span className="text-xs font-semibold text-amber-800">
          Checkpoint: {checkpoint.presentation?.title ?? checkpoint.checkpointNodeId}
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Waiting for */}
        <div className="text-xs text-[var(--color-text-primary)]">
          Waiting for: <span className="font-mono font-medium">{checkpoint.waitingForFile}</span>
        </div>

        {/* Available files */}
        {checkpoint.presentFiles.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-[var(--color-text-muted)] mb-1">
              Available files from prior phases:
            </div>
            <div className="space-y-0.5">
              {checkpoint.presentFiles.map((f) => (
                <div key={f} className="text-[11px] text-[var(--color-text-secondary)] font-mono pl-2 flex items-center gap-1.5">
                  <span className="text-[var(--color-text-muted)]">{'\u2022'}</span>
                  {f}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost so far */}
        {checkpoint.costSoFar && (
          <div className="text-[10px] text-[var(--color-text-muted)]">
            Cost so far: {checkpoint.costSoFar.turns} turns, ${checkpoint.costSoFar.usd.toFixed(2)}
          </div>
        )}

        {/* File upload */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-medium px-3 py-1.5 rounded border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
            >
              Choose file...
            </button>
            <span className="text-[10px] text-[var(--color-text-muted)]">or paste content below</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`Paste content for ${checkpoint.waitingForFile}...`}
            rows={6}
            className="w-full text-xs px-2 py-1.5 border border-[var(--color-border)] rounded bg-white font-mono focus:border-amber-500 focus:outline-none transition-colors resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="text-[11px] text-red-600">{error}</div>
        )}

        {/* Resume button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !content.trim()}
          className="text-xs font-medium px-4 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Resuming...' : 'Resume'}
        </button>
      </div>
    </div>
  );
}
