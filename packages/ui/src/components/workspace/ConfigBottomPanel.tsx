import { useState, useCallback, useRef } from 'react';
import type { FlowNode, NodeConfig, ArtifactSchema } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { TagList } from '../inspector/fields/TagList';

interface ConfigBottomPanelProps {
  node: FlowNode;
}

interface ConfigTab {
  id: string;
  label: string;
  show: (node: FlowNode) => boolean;
}

const CONFIG_TABS: ConfigTab[] = [
  { id: 'io', label: 'I/O', show: () => true },
  { id: 'budget', label: 'Budget', show: () => true },
  { id: 'skills', label: 'Skills', show: () => true },
  { id: 'interrupts', label: 'Interrupts', show: (n) => n.type === 'agent' },
  { id: 'children', label: 'Sub-Agents', show: (n) => n.children.length > 0 },
  { id: 'presentation', label: 'Presentation', show: (n) => n.type === 'checkpoint' },
];

export function ConfigBottomPanel({ node }: ConfigBottomPanelProps) {
  const [height, setHeight] = useState(0);
  const [activeTab, setActiveTab] = useState('io');
  const visibleTabs = CONFIG_TABS.filter((t) => t.show(node));
  const isOpen = height > 0;

  const handleTabClick = useCallback(
    (tabId: string) => {
      if (activeTab === tabId && height > 0) {
        setHeight(0);
      } else {
        setActiveTab(tabId);
        if (height === 0) setHeight(160);
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
      {/* Drag handle */}
      {isOpen && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="h-[3px] cursor-row-resize hover:bg-[var(--color-node-agent)]/30 transition-colors"
        />
      )}

      {/* Tab bar */}
      <div className="h-7 flex items-center gap-0 px-2 bg-[var(--color-canvas-bg)] border-b border-[var(--color-border)]">
        {visibleTabs.map((tab) => {
          const badge = getTabBadge(tab.id, node);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
              className={`px-3 py-1 text-[11px] font-medium transition-colors rounded-t flex items-center gap-1 ${
                isOpen && activeTab === tab.id
                  ? 'text-[var(--color-node-agent)] bg-white border-b-2 border-b-[var(--color-node-agent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {tab.label}
              {badge > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] rounded-full bg-[var(--color-node-agent)]/10 text-[var(--color-node-agent)]">
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
            <ConfigTabContent node={node} activeTab={activeTab} />
          </div>
        </div>
      )}
    </div>
  );
}

function getTabBadge(tabId: string, node: FlowNode): number {
  switch (tabId) {
    case 'io':
      return (node.config.outputs?.length ?? 0) + (node.config.inputs?.length ?? 0);
    case 'skills':
      return node.config.skills?.length ?? 0;
    case 'interrupts':
      return node.config.interrupts?.length ?? 0;
    case 'children':
      return node.children.length;
    default:
      return 0;
  }
}

function ConfigTabContent({ node, activeTab }: { node: FlowNode; activeTab: string }) {
  switch (activeTab) {
    case 'io':
      return <IOContent config={node.config} />;
    case 'budget':
      return <BudgetContent nodeId={node.id} config={node.config} />;
    case 'skills':
      return <SkillsContent config={node.config} />;
    case 'interrupts':
      return <InterruptsContent config={node.config} />;
    case 'children':
      return <ChildrenContent node={node} />;
    case 'presentation':
      return <PresentationContent nodeId={node.id} config={node.config} />;
    default:
      return null;
  }
}

const FORMAT_LABELS: Record<string, string> = {
  json: 'Structured',
  markdown: 'Markdown',
  text: 'Text',
  csv: 'CSV',
  pdf: 'PDF',
  image: 'Image',
  binary: 'Binary',
};

function IOContent({ config }: { config: NodeConfig }) {
  const outputs = config.outputs ?? [];
  const inputs = config.inputs ?? [];

  if (outputs.length === 0 && inputs.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] italic">
        Use <span className="font-mono">/output</span> or <span className="font-mono">@artifact-name</span> in the instructions editor
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {outputs.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide mb-1">Outputs</div>
          <div className="space-y-1">
            {outputs.map((out, i) => {
              const schema = typeof out === 'string' ? { name: out, format: 'text', description: '' } : out as ArtifactSchema;
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[var(--color-text-primary)]">{schema.name || '(unnamed)'}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700">
                    {FORMAT_LABELS[schema.format] || schema.format}
                  </span>
                  {schema.description && (
                    <span className="text-[var(--color-text-muted)] truncate">{schema.description}</span>
                  )}
                  {(schema as ArtifactSchema).fields?.length ? (
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {(schema as ArtifactSchema).fields!.length} fields
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {inputs.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide mb-1">Inputs</div>
          <div className="flex flex-wrap gap-1.5">
            {inputs.map((inp, i) => {
              const name = typeof inp === 'string' ? inp : (inp as ArtifactSchema).name;
              return (
                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-purple-50 text-purple-700">
                  @{name}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BudgetContent({ nodeId, config }: { nodeId: string; config: NodeConfig }) {
  const { updateNodeConfig } = useFlow();
  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Max Turns</label>
        <input
          type="number"
          value={config.budget?.maxTurns ?? ''}
          onChange={(e) =>
            updateNodeConfig(nodeId, {
              budget: {
                maxTurns: Number(e.target.value) || 0,
                maxBudgetUsd: config.budget?.maxBudgetUsd ?? 0,
              },
            })
          }
          className="w-full text-xs border border-[var(--color-border)] rounded px-2 py-1.5 bg-white"
          placeholder="50"
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Budget ($)</label>
        <input
          type="number"
          step="0.50"
          value={config.budget?.maxBudgetUsd ?? ''}
          onChange={(e) =>
            updateNodeConfig(nodeId, {
              budget: {
                maxTurns: config.budget?.maxTurns ?? 0,
                maxBudgetUsd: Number(e.target.value) || 0,
              },
            })
          }
          className="w-full text-xs border border-[var(--color-border)] rounded px-2 py-1.5 bg-white"
          placeholder="5.00"
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Duration</label>
        <input
          type="text"
          value={config.estimatedDuration ?? ''}
          onChange={(e) => updateNodeConfig(nodeId, { estimatedDuration: e.target.value })}
          className="w-full text-xs border border-[var(--color-border)] rounded px-2 py-1.5 bg-white"
          placeholder="30s"
        />
      </div>
    </div>
  );
}

function SkillsContent({ config }: { config: NodeConfig }) {
  const skills = config.skills ?? [];

  if (skills.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] italic">
        Use <span className="font-mono">/skill:name</span> in the instructions editor
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s, i) => (
        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-emerald-50 text-emerald-700">
          /skill:{s}
        </span>
      ))}
    </div>
  );
}

function InterruptsContent({ config }: { config: NodeConfig }) {
  const interrupts = config.interrupts ?? [];

  if (interrupts.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] italic">
        Use <span className="font-mono">/interrupt:type</span> in the instructions editor
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {interrupts.map((int, i) => (
        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-red-50 text-red-700">
          /interrupt:{int.type}
        </span>
      ))}
    </div>
  );
}

function ChildrenContent({ node }: { node: FlowNode }) {
  if (node.children.length === 0) {
    return <div className="text-xs text-[var(--color-text-muted)]">No sub-agents</div>;
  }
  return (
    <div className="space-y-1">
      {node.children.map((child) => (
        <div
          key={child.id}
          className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
        >
          <span className="w-2 h-2 rounded-full bg-[var(--color-node-agent)]" />
          {child.name}
          <span className="text-[var(--color-text-muted)]">({child.id})</span>
        </div>
      ))}
    </div>
  );
}

function PresentationContent({ nodeId, config }: { nodeId: string; config: NodeConfig }) {
  const { updateNodeConfig } = useFlow();
  const presentation = config.presentation ?? { title: '', sections: [] };
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-[var(--color-text-muted)] mb-1">Title</label>
        <input
          type="text"
          value={presentation.title}
          onChange={(e) =>
            updateNodeConfig(nodeId, {
              presentation: { ...presentation, title: e.target.value },
            })
          }
          className="w-full text-xs border border-[var(--color-border)] rounded px-2 py-1.5 bg-white"
          placeholder="Phase Complete"
        />
      </div>
      <TagList
        label="Sections"
        tags={presentation.sections}
        onChange={(sections) =>
          updateNodeConfig(nodeId, {
            presentation: { ...presentation, sections },
          })
        }
        placeholder="e.g. findings"
      />
    </div>
  );
}
