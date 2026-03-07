import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../../context/FlowContext';
import { useDag } from '../../context/DagContext';
import { useGit } from '../../context/GitContext';
import { ForgeExportIcon } from '../icons/ForgeFileIcon';
import { formatShortcut, isMac } from '../../lib/keyboard-shortcuts';
import type { SaveStatus } from '../../hooks/useSyncFlow';

interface WorkspaceToolbarProps {
  projectId: string;
  onToggleAI?: () => void;
  aiPanelOpen?: boolean;
  saveStatus?: SaveStatus;
  onValidate?: () => void;
  onCompile?: () => void;
  onRun?: () => void;
  onRunInWorkspace?: () => void;
  onExport?: () => void;
  onShowSettings?: () => void;
  validating?: boolean;
  compiling?: boolean;
  exporting?: boolean;
  onToggleGit?: () => void;
  gitPanelOpen?: boolean;
  onOpenGitHub?: () => void;
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving...',
  saved: 'Saved',
  error: 'Save failed',
};

export function WorkspaceToolbar({
  projectId,
  onToggleAI,
  aiPanelOpen,
  saveStatus = 'idle',
  onValidate,
  onCompile,
  onRun,
  onRunInWorkspace,
  onExport,
  onShowSettings,
  validating = false,
  compiling = false,
  exporting = false,
  onToggleGit,
  gitPanelOpen,
  onOpenGitHub,
}: WorkspaceToolbarProps) {
  const { state } = useFlow();
  const { flow } = state;
  const { dagCollapsed, toggleDag } = useDag();
  const git = useGit();
  const navigate = useNavigate();

  const handleRun = () => {
    if (onRun) {
      onRun();
    } else {
      navigate(`/projects/${projectId}/runs/new`);
    }
  };

  const handleHistory = () => {
    navigate(`/projects/${projectId}/runs`);
  };

  return (
    <div className="h-10 px-4 flex items-center gap-4 border-b border-[var(--color-border)] bg-white shrink-0">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-sm font-bold text-[var(--color-node-agent)] hover:opacity-80 transition-opacity"
      >
        ForgeFlow
      </button>
      <span className="text-sm text-[var(--color-text-muted)]">/</span>
      <span className="text-sm font-medium">{flow.name}</span>

      {/* Save status indicator */}
      {saveStatus !== 'idle' && (
        <span
          className={`text-[10px] font-medium transition-opacity ${
            saveStatus === 'error'
              ? 'text-red-500'
              : saveStatus === 'saving'
                ? 'text-[var(--color-text-muted)]'
                : 'text-[var(--color-node-merge)]'
          }`}
        >
          {SAVE_LABELS[saveStatus]}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggleDag}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
        >
          {dagCollapsed ? 'Show DAG' : 'Hide DAG'}
        </button>
        <ToolbarButton
          label={validating ? 'Validating...' : 'Validate'}
          onClick={onValidate}
          disabled={validating}
          title={formatShortcut({ id: '', label: '', category: 'toolbar', key: 'b', mod: true, shift: true })}
        />
        <ToolbarButton
          label={compiling ? 'Compiling...' : 'Compile'}
          onClick={onCompile}
          disabled={compiling}
          title={formatShortcut({ id: '', label: '', category: 'toolbar', key: 'e', mod: true, shift: true })}
        />
        <SplitRunButton
          onRun={handleRun}
          onRunInWorkspace={onRunInWorkspace}
          title={formatShortcut({ id: '', label: '', category: 'toolbar', key: 'r', mod: true, shift: true })}
        />
        <ToolbarButton label="History" onClick={handleHistory} />
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
        >
          <ForgeExportIcon size={13} />
          {exporting ? 'Exporting...' : 'Export'}
        </button>

        {/* Git button with branch indicator */}
        {onToggleGit && (
          <button
            type="button"
            onClick={onToggleGit}
            title={formatShortcut({ id: '', label: '', category: 'layout', key: 'g', mod: true, shift: true })}
            className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5 ${
              gitPanelOpen
                ? 'border-gray-400/60 bg-gray-100 text-gray-700'
                : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M6 3v12m0 0a3 3 0 1 0 3 3M6 15a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3V3" />
            </svg>
            {git.status?.branch || 'Git'}
            {(git.status?.files?.length ?? 0) > 0 && (
              <span className={`text-[9px] px-1 rounded-full ${gitPanelOpen ? 'bg-gray-500/15 text-gray-600' : 'bg-amber-500/15 text-amber-600'}`}>
                {git.status!.files.length}
              </span>
            )}
          </button>
        )}

        {onToggleAI && (
          <button
            type="button"
            onClick={onToggleAI}
            className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
              aiPanelOpen
                ? 'border-[var(--color-node-agent)]/40 bg-[var(--color-node-agent)]/10 text-[var(--color-node-agent)]'
                : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
            }`}
          >
            Forge
          </button>
        )}

        {onShowSettings && (
          <button
            type="button"
            onClick={onShowSettings}
            title={`Settings (${isMac ? '\u2318' : 'Ctrl'}/)`}
            className="text-xs font-medium w-7 h-7 flex items-center justify-center rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.982.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({ label, onClick, disabled, title }: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {label}
    </button>
  );
}

/* ── Split Run Button ─────────────────────────────────── */

function SplitRunButton({
  onRun,
  onRunInWorkspace,
  title,
}: {
  onRun: () => void;
  onRunInWorkspace?: () => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleWorkspaceRun = useCallback(() => {
    setOpen(false);
    onRunInWorkspace?.();
  }, [onRunInWorkspace]);

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={onRun}
        title={title}
        className="text-xs font-medium px-3 py-1.5 rounded-l-md border border-emerald-400/60 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
      >
        Run
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium px-1.5 py-1.5 rounded-r-md border border-l-0 border-emerald-400/60 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
      >
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 5l3 3 3-3H3z" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-44 bg-white border border-[var(--color-border)] rounded-md shadow-lg z-50 py-1">
          <button
            type="button"
            onClick={handleWorkspaceRun}
            className="w-full text-left text-xs px-3 py-1.5 text-[var(--color-text-primary)] hover:bg-[var(--color-canvas-bg)] transition-colors"
          >
            Run in Workspace
          </button>
        </div>
      )}
    </div>
  );
}
