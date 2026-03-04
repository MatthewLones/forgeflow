import { useState, useCallback, useRef } from 'react';
import type { SkillSummary } from '../../lib/api-client';
import { useLayout } from '../../context/LayoutContext';
import { Chip } from '../shared/Chip';

interface SkillBottomPanelProps {
  skill: SkillSummary;
  allSkills: SkillSummary[];
  description: string;
  onDescriptionChange: (desc: string) => void;
  referenceCount: number;
}

interface SkillTab {
  id: string;
  label: string;
  show: (skill: SkillSummary) => boolean;
}

const SKILL_TABS: SkillTab[] = [
  { id: 'description', label: 'Description', show: () => true },
  { id: 'sub-skills', label: 'Sub-Skills', show: (s) => s.subSkills.length > 0 },
  { id: 'references', label: 'References', show: (s) => s.referenceCount > 0 },
];

export function SkillBottomPanel({ skill, allSkills, description, onDescriptionChange, referenceCount }: SkillBottomPanelProps) {
  const [height, setHeight] = useState(0);
  const [activeTab, setActiveTab] = useState('description');
  const visibleTabs = SKILL_TABS.filter((t) => t.show(skill));
  const isOpen = height > 0;

  const handleTabClick = useCallback(
    (tabId: string) => {
      if (activeTab === tabId && height > 0) {
        setHeight(0);
      } else {
        setActiveTab(tabId);
        if (height === 0) setHeight(120);
      }
    },
    [activeTab, height],
  );

  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [height],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = startY.current - e.clientY;
    setHeight(Math.max(0, Math.min(400, startH.current + delta)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-white" style={{ height: isOpen ? height + 28 : 28 }}>
      {isOpen && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="h-[3px] cursor-row-resize hover:bg-emerald-500/30 transition-colors"
        />
      )}

      {/* Tab bar */}
      <div className="h-7 flex items-center gap-0 px-2 bg-[var(--color-canvas-bg)] border-b border-[var(--color-border)]">
        {visibleTabs.map((tab) => {
          const badge = getTabBadge(tab.id, skill, referenceCount);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
              className={`px-3 py-1 text-[11px] font-medium transition-colors rounded-t flex items-center gap-1 ${
                isOpen && activeTab === tab.id
                  ? 'text-emerald-600 bg-white border-b-2 border-b-emerald-500'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {tab.label}
              {badge > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] rounded-full bg-emerald-500/10 text-emerald-600">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isOpen && (
        <div className="overflow-y-auto" style={{ height: height - 3 }}>
          <div className="p-3">
            <SkillTabContent
              activeTab={activeTab}
              skill={skill}
              allSkills={allSkills}
              description={description}
              onDescriptionChange={onDescriptionChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function getTabBadge(tabId: string, skill: SkillSummary, referenceCount: number): number {
  switch (tabId) {
    case 'sub-skills':
      return skill.subSkills.length;
    case 'references':
      return referenceCount;
    default:
      return 0;
  }
}

function SkillTabContent({
  activeTab,
  skill,
  allSkills,
  description,
  onDescriptionChange,
}: {
  activeTab: string;
  skill: SkillSummary;
  allSkills: SkillSummary[];
  description: string;
  onDescriptionChange: (desc: string) => void;
}) {
  switch (activeTab) {
    case 'description':
      return <DescriptionContent description={description} onChange={onDescriptionChange} />;
    case 'sub-skills':
      return <SubSkillsContent skill={skill} allSkills={allSkills} />;
    case 'references':
      return <ReferencesContent count={skill.referenceCount} />;
    default:
      return null;
  }
}

function DescriptionContent({ description, onChange }: { description: string; onChange: (d: string) => void }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide mb-1">Description</div>
      <input
        type="text"
        value={description}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs border border-[var(--color-border)] rounded px-2 py-1.5 bg-white placeholder:text-[var(--color-text-muted)]"
        placeholder="Short description of what this skill provides..."
      />
    </div>
  );
}

function SubSkillsContent({ skill, allSkills }: { skill: SkillSummary; allSkills: SkillSummary[] }) {
  const { selectSkill } = useLayout();

  if (skill.subSkills.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] italic">
        Use <span className="font-mono">/skill:name</span> in SKILL.md to add sub-skills
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {skill.subSkills.map((name) => {
        const sub = allSkills.find((s) => s.name === name);
        return (
          <Chip
            key={name}
            type="skill"
            name={name}
            onClick={() => selectSkill(name)}
            tooltip={sub?.description || ''}
          />
        );
      })}
    </div>
  );
}

function ReferencesContent({ count }: { count: number }) {
  return (
    <div className="text-xs text-[var(--color-text-secondary)]">
      {count} reference file{count !== 1 ? 's' : ''} in <span className="font-mono">references/</span> directory
    </div>
  );
}
