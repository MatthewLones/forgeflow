import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '../../context/ProjectStore';

interface ProjectCardProps {
  project: ProjectSummary;
  onDelete: (id: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const timeAgo = formatTimeAgo(project.updatedAt);

  return (
    <div className="group rounded-xl border border-[var(--color-border)] bg-white hover:shadow-md hover:border-[var(--color-text-muted)] transition-all">
      {/* Card body — clickable */}
      <div
        className="p-5 cursor-pointer"
        onClick={() => navigate(`/workspace/${project.id}`)}
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] leading-tight">
            {project.name}
          </h3>
        </div>

        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed line-clamp-2 mb-4">
          {project.description}
        </p>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-node-agent)]" />
            {project.nodeCount} node{project.nodeCount !== 1 ? 's' : ''}
          </span>
          {project.skillCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-node-merge)]" />
              {project.skillCount} skill{project.skillCount !== 1 ? 's' : ''}
            </span>
          )}
          {project.hasCheckpoints && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-node-checkpoint)]" />
              checkpoint
            </span>
          )}
        </div>
      </div>

      {/* Card footer */}
      <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-text-muted)]">{timeAgo}</span>

        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-red-500">Delete?</span>
            <button
              type="button"
              onClick={() => onDelete(project.id)}
              className="text-[10px] font-medium text-red-500 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] px-1.5 py-0.5 rounded hover:bg-[var(--color-canvas-bg)] transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="hidden group-hover:block text-[10px] text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
