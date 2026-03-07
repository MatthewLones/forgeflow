import { useState } from 'react';
import { marked } from 'marked';
import type { Interrupt, InterruptAnswer } from '@forgeflow/types';
import { InterruptFormRouter } from '../shared/interrupt-forms';

interface InterruptBannerProps {
  interrupt: Interrupt;
  onSubmit: (answer: InterruptAnswer) => Promise<void>;
  runId?: string;
}

export function InterruptBanner({ interrupt, onSubmit, runId }: InterruptBannerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (answer: InterruptAnswer) => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-amber-300 bg-amber-50">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-200">
        <span className="text-amber-600 font-bold text-xs">{'\u26A0'}</span>
        <span className="text-xs font-semibold text-amber-800">{interrupt.title}</span>
        <span className="ml-auto text-[10px] font-mono text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
          {interrupt.mode}
        </span>
      </div>

      {/* Context */}
      <div
        className="px-4 py-1.5 text-[11px] text-amber-700 prose-skill"
        dangerouslySetInnerHTML={{ __html: marked.parse(interrupt.context ?? '', { async: false }) as string }}
      />

      {/* Source path */}
      {interrupt.source.agentPath.length > 0 && (
        <div className="px-4 pb-1.5 text-[10px] text-amber-500 font-mono">
          {interrupt.source.agentPath.join(' / ')}
        </div>
      )}

      {/* Form */}
      <div className="px-4 py-2">
        <InterruptFormRouter
          interrupt={interrupt}
          onSubmit={handleSubmit}
          runId={runId}
          compact
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 pb-2 text-[11px] text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
