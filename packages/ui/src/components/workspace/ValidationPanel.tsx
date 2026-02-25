import { useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { EditorTab } from '../../context/LayoutContext';
import type { FlowDiagnostic, ValidationResult, ExecutionPlan } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { useLayout } from '../../context/LayoutContext';

const SEVERITY_CONFIG = {
  error: { icon: '\u25CF', color: 'text-red-500', bg: 'bg-red-50', label: 'Errors' },
  warning: { icon: '\u25B2', color: 'text-amber-500', bg: 'bg-amber-50', label: 'Warnings' },
  suggestion: { icon: '\u25CB', color: 'text-blue-500', bg: 'bg-blue-50', label: 'Suggestions' },
} as const;

export function ValidationPanel(props: IDockviewPanelProps<EditorTab>) {
  const result = props.params.validationResult;
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No validation results
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ValidationHeader result={result} />
      <div className="flex-1 overflow-y-auto">
        {result.errors.length > 0 && (
          <DiagnosticSection severity="error" items={result.errors} defaultOpen />
        )}
        {result.warnings.length > 0 && (
          <DiagnosticSection severity="warning" items={result.warnings} defaultOpen />
        )}
        {result.suggestions.length > 0 && (
          <DiagnosticSection severity="suggestion" items={result.suggestions} />
        )}
        {result.valid && result.executionPlan && (
          <ExecutionPlanSummary plan={result.executionPlan} />
        )}
        {result.valid && result.errors.length === 0 && result.warnings.length === 0 && result.suggestions.length === 0 && (
          <div className="p-6 text-center text-sm text-[var(--color-node-merge)]">
            Flow is valid with no issues.
          </div>
        )}
      </div>
    </div>
  );
}

function ValidationHeader({ result }: { result: ValidationResult }) {
  const total = result.errors.length + result.warnings.length + result.suggestions.length;
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-white">
      <span
        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
          result.valid
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-red-100 text-red-700'
        }`}
      >
        {result.valid ? 'Valid' : 'Invalid'}
      </span>
      {total > 0 && (
        <span className="text-xs text-[var(--color-text-muted)]">
          {result.errors.length > 0 && `${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}`}
          {result.errors.length > 0 && result.warnings.length > 0 && ', '}
          {result.warnings.length > 0 && `${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`}
          {(result.errors.length > 0 || result.warnings.length > 0) && result.suggestions.length > 0 && ', '}
          {result.suggestions.length > 0 && `${result.suggestions.length} suggestion${result.suggestions.length !== 1 ? 's' : ''}`}
        </span>
      )}
    </div>
  );
}

function DiagnosticSection({
  severity,
  items,
  defaultOpen = false,
}: {
  severity: 'error' | 'warning' | 'suggestion';
  items: FlowDiagnostic[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const config = SEVERITY_CONFIG[severity];

  return (
    <div className="border-b border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold hover:bg-[var(--color-canvas-bg)] transition-colors ${config.color}`}
      >
        <span className="text-[10px]">{open ? '\u25BC' : '\u25B6'}</span>
        <span>{config.label}</span>
        <span className="ml-auto text-[10px] font-medium text-[var(--color-text-muted)]">
          {items.length}
        </span>
      </button>
      {open && (
        <div className="pb-1">
          {items.map((item, i) => (
            <DiagnosticItem key={`${item.code}-${i}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticItem({ item }: { item: FlowDiagnostic }) {
  const { selectNode } = useFlow();
  const { selectAgent } = useLayout();
  const config = SEVERITY_CONFIG[item.severity];

  const handleNodeClick = () => {
    if (!item.location.nodeId) return;
    selectNode(item.location.nodeId);
    selectAgent(item.location.nodeId);
  };

  return (
    <div className="flex items-start gap-2 px-4 py-1.5 hover:bg-[var(--color-canvas-bg)] transition-colors group">
      <span className={`text-[10px] mt-0.5 shrink-0 ${config.color}`}>{config.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-primary)]">{item.message}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-mono px-1 py-px rounded bg-[var(--color-canvas-bg)] text-[var(--color-text-muted)]">
            {item.code}
          </span>
          {item.location.nodeId && (
            <button
              type="button"
              onClick={handleNodeClick}
              className="text-[10px] text-[var(--color-node-agent)] hover:underline"
            >
              {item.location.nodeId}
            </button>
          )}
          {item.location.field && (
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
              {item.location.field}
            </span>
          )}
        </div>
        {item.suggestion && (
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 italic">
            {item.suggestion}
          </p>
        )}
      </div>
    </div>
  );
}

function ExecutionPlanSummary({ plan }: { plan: ExecutionPlan }) {
  return (
    <div className="px-4 py-3">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
        Execution Plan
      </h4>
      <div className="flex gap-4 text-xs text-[var(--color-text-secondary)]">
        <span>
          <span className="font-medium text-[var(--color-text-primary)]">{plan.phases.length}</span> phases
        </span>
        <span>
          ~<span className="font-medium text-[var(--color-text-primary)]">{plan.totalEstimatedCost.turns}</span> turns
        </span>
        <span>
          ~$<span className="font-medium text-[var(--color-text-primary)]">{plan.totalEstimatedCost.usd.toFixed(2)}</span>
        </span>
      </div>
      {plan.criticalPath.length > 0 && (
        <div className="mt-2">
          <span className="text-[10px] font-medium text-[var(--color-text-muted)]">Critical path: </span>
          <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">
            {plan.criticalPath.join(' \u2192 ')}
          </span>
        </div>
      )}
      <div className="mt-3 space-y-1">
        {plan.phases.map((phase, i) => (
          <div key={phase.nodeId} className="flex items-center gap-2 text-[11px]">
            <span className="w-4 text-right text-[var(--color-text-muted)] font-mono">{i + 1}</span>
            <span className="font-medium text-[var(--color-text-primary)]">{phase.nodeId}</span>
            {phase.skills.length > 0 && (
              <span className="text-[var(--color-text-muted)]">
                ({phase.skills.length} skill{phase.skills.length !== 1 ? 's' : ''})
              </span>
            )}
            {phase.interruptCapable && (
              <span className="text-[9px] px-1 py-px rounded bg-amber-100 text-amber-700 font-medium">INT</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
