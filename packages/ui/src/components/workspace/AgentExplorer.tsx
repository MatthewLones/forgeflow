import { useState, useCallback, useRef, useEffect } from 'react';
import type { FlowNode, FlowEdge, NodeType } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useProjectStore } from '../../context/ProjectStore';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';

/* ── Topological sort ────────────────────────────────────── */

function topologicalOrder(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of ids) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const e of edges) {
    if (ids.has(e.from) && ids.has(e.to)) {
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const next of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const result = sorted.map((id) => nodeMap.get(id)!).filter(Boolean);
  for (const node of nodes) {
    if (!sorted.includes(node.id)) result.push(node);
  }
  return result;
}

/* ── Constants ───────────────────────────────────────────── */

const TYPE_COLORS: Record<NodeType, string> = {
  agent: 'bg-[var(--color-node-agent)]',
  checkpoint: 'bg-[var(--color-node-checkpoint)]',
  merge: 'bg-[var(--color-node-merge)]',
};

const TYPE_BORDER_COLORS: Record<NodeType, string> = {
  agent: 'border-l-[var(--color-node-agent)]',
  checkpoint: 'border-l-[var(--color-node-checkpoint)]',
  merge: 'border-l-[var(--color-node-merge)]',
};

const TYPE_GLYPHS: Record<NodeType, string> = {
  agent: 'A',
  checkpoint: 'C',
  merge: 'M',
};

/* ── Section Header ──────────────────────────────────────── */

function SectionHeader({
  title,
  expanded,
  onToggle,
  onAdd,
  onContextMenu,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 bg-[var(--color-canvas-bg)] border-b border-[var(--color-border)] cursor-pointer select-none hover:bg-[var(--color-border)]/30 transition-colors"
      onClick={onToggle}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {expanded ? '\u25BE' : '\u25B8'}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
          {title}
        </span>
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          title={`Add new ${title.toLowerCase().replace(/s$/, '')}`}
          className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-node-agent)] transition-colors px-1"
        >
          +
        </button>
      )}
    </div>
  );
}

/* ── Agent Tree Item ─────────────────────────────────────── */

interface AgentTreeItemProps {
  node: FlowNode;
  depth: number;
  activeTabId: string | null;
  renamingNodeId: string | null;
  onSelect: (nodeId: string, label: string) => void;
  onRename: (nodeId: string, newName: string) => void;
  onStartRename: (nodeId: string | null) => void;
  onContextMenu: (e: React.MouseEvent, node: FlowNode) => void;
}

function AgentTreeItem({ node, depth, activeTabId, renamingNodeId, onSelect, onRename, onStartRename, onContextMenu }: AgentTreeItemProps) {
  const [expanded, setExpanded] = useState(node.children.length > 0);
  const [renameValue, setRenameValue] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasChildren = node.children.length > 0;
  const isActive = activeTabId === node.id;
  const isRenaming = renamingNodeId === node.id;

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name);
      // Defer focus so input is mounted
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isRenaming, node.name]);

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.name) {
      onRename(node.id, trimmed);
    }
    onStartRename(null);
  };

  const cancelRename = () => {
    onStartRename(null);
  };

  return (
    <div>
      <div
        role="treeitem"
        tabIndex={0}
        onClick={() => { if (!isRenaming) onSelect(node.id, node.name); }}
        onDoubleClick={() => onStartRename(node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node);
        }}
        onKeyDown={(e) => {
          if (isRenaming) return;
          if (e.key === 'Enter' || e.key === 'F2' || (e.metaKey && e.key === 'r')) {
            e.preventDefault();
            onStartRename(node.id);
          }
        }}
        className={`w-full flex items-center gap-1.5 py-1 text-left text-xs transition-colors relative cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-node-agent)] focus-visible:ring-inset ${
          isActive
            ? 'bg-[var(--color-node-agent)]/8 text-[var(--color-text-primary)] border-l-2 ' + TYPE_BORDER_COLORS[node.type]
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] border-l-2 border-l-transparent'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {/* Indent guides */}
        {depth > 0 && Array.from({ length: depth }).map((_, i) => (
          <span
            key={i}
            className="absolute top-0 bottom-0 w-px bg-[var(--color-border)]"
            style={{ left: `${8 + i * 16 + 7}px` }}
          />
        ))}

        {/* Expand/collapse */}
        {hasChildren ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-3 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] shrink-0 text-center"
          >
            {expanded ? '\u25BE' : '\u25B8'}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Type glyph */}
        <span className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold shrink-0 ${
          isActive ? 'text-white ' + TYPE_COLORS[node.type] : 'text-[var(--color-text-muted)] bg-[var(--color-canvas-bg)]'
        }`}>
          {TYPE_GLYPHS[node.type]}
        </span>

        {/* Node name or inline rename input */}
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-xs bg-white border border-[var(--color-node-agent)] rounded px-1 py-0 outline-none"
          />
        ) : (
          <span className={`truncate ${isActive ? 'font-medium' : ''}`}>
            {node.name}
          </span>
        )}

        {/* Sub-agent count badge */}
        {hasChildren && !isRenaming && (
          <span className="ml-auto text-[9px] text-[var(--color-text-muted)] pr-2">
            {node.children.length}
          </span>
        )}
      </div>

      {/* Sub-agents */}
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <AgentTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeTabId={activeTabId}
              renamingNodeId={renamingNodeId}
              onSelect={onSelect}
              onRename={onRename}
              onStartRename={onStartRename}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Reference File Tree ─────────────────────────────────── */

type FileType = 'pdf' | 'md' | 'json' | 'txt' | 'other';

interface ReferenceEntry {
  name: string;
  type: FileType | 'folder';
  path: string;           // full path like "regulations/height-limits.pdf"
  children?: ReferenceEntry[];
}

const MOCK_REFERENCES: ReferenceEntry[] = [
  {
    name: 'regulations',
    type: 'folder',
    path: 'regulations',
    children: [
      { name: 'height-limits.pdf', type: 'pdf', path: 'regulations/height-limits.pdf' },
      { name: 'setback-rules.md', type: 'md', path: 'regulations/setback-rules.md' },
    ],
  },
  { name: 'contract.pdf', type: 'pdf', path: 'contract.pdf' },
  { name: 'standards-height.md', type: 'md', path: 'standards-height.md' },
  { name: 'compliance-rules.json', type: 'json', path: 'compliance-rules.json' },
];

const FILE_TYPE_ICONS: Record<string, string> = {
  folder: '\u25B8',
  pdf: 'P',
  md: '#',
  json: 'J',
  txt: 'T',
  other: 'F',
};

const FILE_TYPE_COLORS: Record<string, string> = {
  folder: 'text-[var(--color-node-checkpoint)]',
  pdf: 'text-red-500',
  md: 'text-blue-500',
  json: 'text-amber-500',
  txt: 'text-[var(--color-text-muted)]',
  other: 'text-[var(--color-text-muted)]',
};

function ReferenceTreeItem({
  entry,
  depth,
  onOpen,
  onContextMenu,
}: {
  entry: ReferenceEntry;
  depth: number;
  onOpen: (entry: ReferenceEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: ReferenceEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFolder = entry.type === 'folder';

  return (
    <div>
      <div
        role="treeitem"
        tabIndex={0}
        onClick={() => isFolder ? setExpanded(!expanded) : onOpen(entry)}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, entry); }}
        className="w-full flex items-center gap-1.5 py-1 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] border-l-2 border-l-transparent transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-node-agent)] focus-visible:ring-inset"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {/* Indent guides */}
        {depth > 0 && Array.from({ length: depth }).map((_, i) => (
          <span
            key={i}
            className="absolute top-0 bottom-0 w-px bg-[var(--color-border)]"
            style={{ left: `${8 + i * 16 + 7}px` }}
          />
        ))}

        {/* Expand/collapse for folders */}
        {isFolder ? (
          <span className="w-3 text-[var(--color-text-muted)] shrink-0 text-center text-[10px]">
            {expanded ? '\u25BE' : '\u25B8'}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* File type icon */}
        <span className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold shrink-0 ${
          isFolder ? 'text-[var(--color-node-checkpoint)]' : (FILE_TYPE_COLORS[entry.type] ?? FILE_TYPE_COLORS.other)
        } bg-[var(--color-canvas-bg)]`}>
          {isFolder ? (expanded ? '\u25BE' : '\u25B8') : (FILE_TYPE_ICONS[entry.type] ?? FILE_TYPE_ICONS.other)}
        </span>

        <span className="truncate">{entry.name}</span>

        {/* File count for folders */}
        {isFolder && entry.children && (
          <span className="ml-auto text-[9px] text-[var(--color-text-muted)] pr-2">
            {entry.children.length}
          </span>
        )}
      </div>

      {isFolder && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <ReferenceTreeItem
              key={child.path}
              entry={child}
              depth={depth + 1}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Explorer ───────────────────────────────────────── */

export function AgentExplorer() {
  const { state, addNode, addChild, removeNode, updateNode, selectNode } = useFlow();
  const { activeTabId, selectAgent, selectSkill, selectReference } = useWorkspace();
  const { skills } = useProjectStore();

  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const [refsExpanded, setRefsExpanded] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);

  const sortedNodes = topologicalOrder(state.flow.nodes, state.flow.edges);

  const handleSelectAgent = useCallback(
    (nodeId: string, label: string) => {
      selectAgent(nodeId, label);
      selectNode(nodeId);
    },
    [selectAgent, selectNode],
  );

  const handleAddAgent = useCallback(() => {
    addNode('agent', { x: 0, y: 0 });
  }, [addNode]);

  const handleInlineRename = useCallback(
    (nodeId: string, newName: string) => {
      updateNode(nodeId, { name: newName });
    },
    [updateNode],
  );

  const handleDuplicateAgent = useCallback(
    (node: FlowNode) => {
      addNode(node.type, { x: 0, y: 0 });
    },
    [addNode],
  );

  const handleAgentContextMenu = useCallback(
    (e: React.MouseEvent, node: FlowNode) => {
      const items: ContextMenuEntry[] = [
        { label: 'Open', onClick: () => { selectAgent(node.id, node.name); selectNode(node.id); } },
        { label: 'Rename', onClick: () => setRenamingNodeId(node.id) },
        { separator: true },
        { label: 'New Sub-Agent', onClick: () => addChild(node.id, { x: 0, y: 0 }) },
        { label: 'Duplicate', onClick: () => handleDuplicateAgent(node) },
        { separator: true },
        { label: 'Delete', onClick: () => { if (window.confirm(`Delete "${node.name}"?`)) removeNode(node.id); }, danger: true },
      ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [selectAgent, selectNode, removeNode, addChild, handleDuplicateAgent],
  );

  const handleSkillContextMenu = useCallback(
    (e: React.MouseEvent, skillName: string) => {
      e.preventDefault();
      const items: ContextMenuEntry[] = [
        { label: 'Open', onClick: () => selectSkill(skillName) },
        { separator: true },
        { label: 'New Skill', onClick: () => { /* TODO: create skill dialog */ }, disabled: true },
        { label: 'Rename...', onClick: () => { /* TODO: rename skill */ }, disabled: true },
        { separator: true },
        { label: 'Delete', onClick: () => { /* TODO: delete skill */ }, danger: true, disabled: true },
      ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [selectSkill],
  );

  const handleOpenReference = useCallback(
    (entry: ReferenceEntry) => {
      if (entry.type !== 'folder') {
        selectReference(entry.path, entry.name);
      }
    },
    [selectReference],
  );

  const handleRefContextMenu = useCallback(
    (e: React.MouseEvent, entry: ReferenceEntry) => {
      e.preventDefault();
      const isFolder = entry.type === 'folder';
      const items: ContextMenuEntry[] = isFolder
        ? [
            { label: 'New File...', onClick: () => { /* TODO */ }, disabled: true },
            { label: 'New Folder...', onClick: () => { /* TODO */ }, disabled: true },
            { separator: true },
            { label: 'Rename', onClick: () => { /* TODO */ }, disabled: true },
            { label: 'Delete', onClick: () => { /* TODO */ }, danger: true, disabled: true },
          ]
        : [
            { label: 'Open', onClick: () => handleOpenReference(entry) },
            { separator: true },
            { label: 'Rename', onClick: () => { /* TODO */ }, disabled: true },
            { label: 'Delete', onClick: () => { /* TODO */ }, danger: true, disabled: true },
          ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [handleOpenReference],
  );

  const handleSectionContextMenu = useCallback(
    (e: React.MouseEvent, section: 'agents' | 'skills' | 'references') => {
      e.preventDefault();
      let items: ContextMenuEntry[];
      if (section === 'agents') {
        items = [
          { label: 'New Agent', onClick: () => addNode('agent', { x: 0, y: 0 }) },
          { label: 'New Checkpoint', onClick: () => addNode('checkpoint', { x: 0, y: 0 }) },
          { label: 'New Merge', onClick: () => addNode('merge', { x: 0, y: 0 }) },
        ];
      } else if (section === 'skills') {
        items = [
          { label: 'New Skill', onClick: () => { /* TODO */ }, disabled: true },
          { label: 'Import Skill...', onClick: () => { /* TODO */ }, disabled: true },
        ];
      } else {
        items = [
          { label: 'Upload File...', onClick: () => { /* TODO */ }, disabled: true },
          { label: 'New Folder', onClick: () => { /* TODO */ }, disabled: true },
        ];
      }
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [addNode],
  );

  return (
    <div className="h-full flex flex-col select-none overflow-y-auto">
      {/* ── Agents ─────────────────────────────────────── */}
      <SectionHeader
        title="Agents"
        expanded={agentsExpanded}
        onToggle={() => setAgentsExpanded(!agentsExpanded)}
        onAdd={handleAddAgent}
        onContextMenu={(e) => handleSectionContextMenu(e, 'agents')}
      />

      {agentsExpanded && (
        <div>
          {sortedNodes.length === 0 ? (
            <div className="px-3 py-3 text-center">
              <div className="text-[10px] text-[var(--color-text-muted)] mb-1">No agents yet</div>
              <button
                type="button"
                onClick={handleAddAgent}
                className="text-[10px] text-[var(--color-node-agent)] hover:underline"
              >
                Create first agent
              </button>
            </div>
          ) : (
            <div className="py-0.5">
              {sortedNodes.map((node) => (
                <AgentTreeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  activeTabId={activeTabId}
                  renamingNodeId={renamingNodeId}
                  onSelect={handleSelectAgent}
                  onRename={handleInlineRename}
                  onStartRename={setRenamingNodeId}
                  onContextMenu={handleAgentContextMenu}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Skills ─────────────────────────────────────── */}
      <SectionHeader
        title="Skills"
        expanded={skillsExpanded}
        onToggle={() => setSkillsExpanded(!skillsExpanded)}
        onContextMenu={(e) => handleSectionContextMenu(e, 'skills')}
      />

      {skillsExpanded && (
        <div className="py-0.5">
          {skills.map((skill) => {
            const isActive = activeTabId === `skill:${skill.name}`;
            return (
              <button
                key={skill.name}
                type="button"
                onClick={() => selectSkill(skill.name)}
                onContextMenu={(e) => handleSkillContextMenu(e, skill.name)}
                className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--color-node-merge)]/8 text-[var(--color-text-primary)] border-l-2 border-l-[var(--color-node-merge)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)] border-l-2 border-l-transparent'
                }`}
                style={{ paddingLeft: '8px' }}
              >
                <span className="w-3 shrink-0" />
                <span className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold shrink-0 ${
                  isActive ? 'text-white bg-[var(--color-node-merge)]' : 'text-[var(--color-text-muted)] bg-[var(--color-canvas-bg)]'
                }`}>
                  S
                </span>
                <span className={`truncate ${isActive ? 'font-medium' : ''}`}>
                  {skill.name}
                </span>
                <span className="ml-auto text-[9px] text-[var(--color-text-muted)] pr-2">
                  {skill.referenceCount}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── References ─────────────────────────────────── */}
      <SectionHeader
        title="References"
        expanded={refsExpanded}
        onToggle={() => setRefsExpanded(!refsExpanded)}
        onAdd={() => {/* TODO: file upload dialog */}}
        onContextMenu={(e) => handleSectionContextMenu(e, 'references')}
      />

      {refsExpanded && (
        <div className="py-0.5">
          {MOCK_REFERENCES.length === 0 ? (
            <div className="px-3 py-3 text-center">
              <div className="text-[10px] text-[var(--color-text-muted)]">
                Drop files here or click + to upload
              </div>
            </div>
          ) : (
            MOCK_REFERENCES.map((entry) => (
              <ReferenceTreeItem
                key={entry.path}
                entry={entry}
                depth={0}
                onOpen={handleOpenReference}
                onContextMenu={handleRefContextMenu}
              />
            ))
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
