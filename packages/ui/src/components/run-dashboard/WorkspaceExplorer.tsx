import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api-client';

interface PhaseFiles {
  phaseId: string;
  files: Array<{ path: string; size: number }>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspaceExplorer({
  runId,
  isRunning,
  onFileClick,
}: {
  runId: string;
  isRunning: boolean;
  onFileClick: (phaseId: string, filePath: string) => void;
}) {
  const [phases, setPhases] = useState<PhaseFiles[]>([]);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const fetchTree = useCallback(async () => {
    try {
      const result = await api.runs.getWorkspaceTree(runId);
      setPhases(result.phases);
      // Auto-expand new phases
      setExpandedPhases((prev) => {
        const next = new Set(prev);
        for (const p of result.phases) next.add(p.phaseId);
        return next;
      });
    } catch {
      // Workspace may not exist yet
    }
  }, [runId]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchTree().finally(() => setLoading(false));
  }, [fetchTree]);

  // Poll while running
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(fetchTree, 3000);
    return () => clearInterval(interval);
  }, [isRunning, fetchTree]);

  const togglePhase = useCallback((phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }, []);

  // Group files by directory within each phase
  const groupFiles = (files: Array<{ path: string; size: number }>) => {
    const dirs = new Map<string, Array<{ name: string; path: string; size: number }>>();
    for (const f of files) {
      const parts = f.path.split('/');
      const dir = parts.length > 1 ? parts[0] : '.';
      const name = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)!.push({ name, path: f.path, size: f.size });
    }
    return dirs;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-white">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Workspace</span>
        {isRunning && <span className="text-[10px] text-blue-500 animate-pulse">Live</span>}
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">{phases.length} phase{phases.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && phases.length === 0 && (
          <div className="p-3 text-xs text-[var(--color-text-muted)] italic">Loading workspace...</div>
        )}
        {!loading && phases.length === 0 && (
          <div className="p-3 text-xs text-[var(--color-text-muted)] italic">No workspace files yet</div>
        )}
        {phases.map((phase) => {
          const isOpen = expandedPhases.has(phase.phaseId);
          const grouped = groupFiles(phase.files);

          return (
            <div key={phase.phaseId}>
              <button
                type="button"
                onClick={() => togglePhase(phase.phaseId)}
                className="w-full flex items-center gap-1.5 px-3 py-1 hover:bg-gray-50 text-left"
              >
                <span className="text-[10px] text-[var(--color-text-muted)]">{isOpen ? '\u25BC' : '\u25B6'}</span>
                <span className="text-xs font-medium text-[var(--color-text-primary)]">{phase.phaseId}</span>
                <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{phase.files.length} files</span>
              </button>
              {isOpen && (
                <div className="pl-4">
                  {[...grouped].map(([dir, files]) => (
                    <div key={dir}>
                      {dir !== '.' && (
                        <div className="flex items-center gap-1 px-3 py-0.5">
                          <span className="text-[10px] text-[var(--color-text-muted)]">{dir}/</span>
                        </div>
                      )}
                      {files.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => onFileClick(phase.phaseId, file.path)}
                          className="w-full flex items-center gap-1.5 px-3 py-0.5 hover:bg-blue-50 text-left group"
                          style={{ paddingLeft: dir !== '.' ? '2rem' : '1rem' }}
                        >
                          <span className="text-[10px] text-[var(--color-text-muted)]">{'\u25A1'}</span>
                          <span className="text-xs text-[var(--color-text-primary)] group-hover:text-blue-600 truncate">{file.name}</span>
                          <span className="text-[9px] text-[var(--color-text-muted)] ml-auto shrink-0">{formatSize(file.size)}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
