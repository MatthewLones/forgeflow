import type { SkillSummary } from '../../context/ProjectStore';

interface SkillCardProps {
  skill: SkillSummary;
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <div
      className="flex items-center gap-3 p-3.5 rounded-lg border border-[var(--color-border)] bg-white hover:shadow-sm hover:border-[var(--color-text-muted)] transition-all"
      title="Open any project to edit this skill in the workspace"
    >
      <div className="w-8 h-8 rounded-lg bg-[var(--color-node-merge-bg)] flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-[var(--color-node-merge)]">S</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {skill.name}
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] truncate">
          {skill.description}
        </div>
      </div>
      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
        {skill.referenceCount} ref{skill.referenceCount !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
