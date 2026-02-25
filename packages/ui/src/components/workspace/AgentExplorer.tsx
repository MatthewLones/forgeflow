import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { FlowNode, FlowEdge, NodeType, ArtifactSchema } from '@forgeflow/types';
import { artifactName } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { useLayout } from '../../context/LayoutContext';
import { useProjectStore, type SkillSummary, type ReferenceEntry } from '../../context/ProjectStore';
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  folder: '\u25B8',
  pdf: 'P',
  md: '#',
  json: 'J',
  txt: 'T',
  image: 'I',
  other: 'F',
};

const FILE_TYPE_COLORS: Record<string, string> = {
  folder: 'text-[var(--color-node-checkpoint)]',
  pdf: 'text-red-500',
  md: 'text-blue-500',
  json: 'text-amber-500',
  txt: 'text-[var(--color-text-muted)]',
  image: 'text-green-500',
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

        {/* File count for folders, file size for files */}
        {isFolder && entry.children ? (
          <span className="ml-auto text-[9px] text-[var(--color-text-muted)] pr-2 shrink-0">
            {entry.children.length}
          </span>
        ) : !isFolder && entry.size != null ? (
          <span className="ml-auto text-[9px] text-[var(--color-text-muted)] pr-2 shrink-0">
            {formatFileSize(entry.size)}
          </span>
        ) : null}
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

/* ── Skill Tree Item ─────────────────────────────────────── */

interface SkillTreeItemProps {
  skill: SkillSummary;
  allSkills: SkillSummary[];
  depth: number;
  activeTabId: string | null;
  visited: Set<string>;
  onSelect: (skillName: string) => void;
  onContextMenu: (e: React.MouseEvent, skillName: string) => void;
}

function SkillTreeItem({ skill, allSkills, depth, activeTabId, visited, onSelect, onContextMenu }: SkillTreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasSubSkills = skill.subSkills.length > 0;
  const isActive = activeTabId === `skill:${skill.name}`;

  // Resolve sub-skills by name, guarding against circular references
  const resolvedSubSkills = hasSubSkills
    ? skill.subSkills
        .filter((name) => !visited.has(name))
        .map((name) => allSkills.find((s) => s.name === name))
        .filter(Boolean) as SkillSummary[]
    : [];

  const nextVisited = hasSubSkills ? new Set([...visited, skill.name]) : visited;

  return (
    <div>
      <div
        role="treeitem"
        tabIndex={0}
        onClick={() => onSelect(skill.name)}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, skill.name); }}
        className={`w-full flex items-center gap-1.5 py-1 text-left text-xs transition-colors relative cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-node-agent)] focus-visible:ring-inset ${
          isActive
            ? 'bg-[var(--color-node-merge)]/8 text-[var(--color-text-primary)] border-l-2 border-l-[var(--color-node-merge)]'
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
        {hasSubSkills ? (
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

        {/* Skill glyph */}
        <span className={`w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold shrink-0 ${
          isActive ? 'text-white bg-[var(--color-node-merge)]' : 'text-[var(--color-text-muted)] bg-[var(--color-canvas-bg)]'
        }`}>
          S
        </span>

        {/* Skill name */}
        <span className={`truncate ${isActive ? 'font-medium' : ''}`}>
          {skill.name}
        </span>

        {/* Badge: sub-skill count or reference count */}
        <span className="ml-auto text-[9px] text-[var(--color-text-muted)] pr-2">
          {hasSubSkills ? `${skill.subSkills.length} sub` : skill.referenceCount}
        </span>
      </div>

      {/* Sub-skills */}
      {hasSubSkills && expanded && (
        <div>
          {resolvedSubSkills.map((sub) => (
            <SkillTreeItem
              key={sub.name}
              skill={sub}
              allSkills={allSkills}
              depth={depth + 1}
              activeTabId={activeTabId}
              visited={nextVisited}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Artifact Lineage ────────────────────────────────────── */

interface ArtifactLineage {
  name: string;
  format?: string;
  producers: string[];  // node IDs that output this artifact
  consumers: string[];  // node IDs that input this artifact
}

function buildArtifactLineage(nodes: FlowNode[]): ArtifactLineage[] {
  const artifacts = new Map<string, { format?: string; producers: Set<string>; consumers: Set<string> }>();

  function ensure(name: string) {
    if (!artifacts.has(name)) {
      artifacts.set(name, { producers: new Set(), consumers: new Set() });
    }
    return artifacts.get(name)!;
  }

  function walk(nodeList: FlowNode[]) {
    for (const node of nodeList) {
      for (const output of node.config.outputs) {
        const name = artifactName(output);
        const entry = ensure(name);
        entry.producers.add(node.id);
        if (typeof output !== 'string' && output.format) {
          entry.format = output.format;
        }
      }
      for (const input of node.config.inputs) {
        const name = artifactName(input);
        const entry = ensure(name);
        entry.consumers.add(node.id);
        if (typeof input !== 'string' && input.format && !entry.format) {
          entry.format = input.format;
        }
      }
      walk(node.children);
    }
  }

  walk(nodes);

  return Array.from(artifacts.entries())
    .map(([name, { format, producers, consumers }]) => ({
      name,
      format,
      producers: [...producers],
      consumers: [...consumers],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const FORMAT_BADGE_COLORS: Record<string, string> = {
  json: 'bg-amber-100 text-amber-700',
  markdown: 'bg-blue-100 text-blue-700',
  text: 'bg-gray-100 text-gray-600',
  csv: 'bg-green-100 text-green-700',
  pdf: 'bg-red-100 text-red-700',
  image: 'bg-purple-100 text-purple-700',
  binary: 'bg-gray-100 text-gray-600',
};

/* ── Main Explorer ───────────────────────────────────────── */

export function AgentExplorer() {
  const { state, addNode, addChild, removeNode, updateNode, selectNode } = useFlow();
  const { activeTabId, selectAgent, selectSkill, selectReference } = useLayout();
  const { skills, references, uploadReferences, deleteReference, createReferenceFolder, renameReference, createSkill, deleteSkill } = useProjectStore();

  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const [refsExpanded, setRefsExpanded] = useState(true);
  const [artifactsExpanded, setArtifactsExpanded] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedNodes = topologicalOrder(state.flow.nodes, state.flow.edges);
  const artifactLineage = useMemo(() => buildArtifactLineage(state.flow.nodes), [state.flow.nodes]);

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

  const handleAddSkill = useCallback(async () => {
    const name = window.prompt('Skill name (e.g. contract-law-basics):');
    if (!name?.trim()) return;
    const projectId = state.flow.id;
    await createSkill(projectId, name.trim());
  }, [state.flow.id, createSkill]);

  const handleDeleteSkill = useCallback(async (skillName: string) => {
    if (!window.confirm(`Delete skill "${skillName}"?`)) return;
    const projectId = state.flow.id;
    await deleteSkill(projectId, skillName);
  }, [state.flow.id, deleteSkill]);

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
        { label: 'New Skill', onClick: () => handleAddSkill() },
        { separator: true },
        { label: 'Delete', onClick: () => handleDeleteSkill(skillName), danger: true },
      ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [selectSkill, handleAddSkill, handleDeleteSkill],
  );

  const handleOpenReference = useCallback(
    (entry: ReferenceEntry) => {
      if (entry.type !== 'folder') {
        selectReference(entry.path, entry.name);
      }
    },
    [selectReference],
  );

  // File upload handlers
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadReferences(state.flow.id, Array.from(files));
    e.target.value = '';
  }, [state.flow.id, uploadReferences]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    await uploadReferences(state.flow.id, files);
  }, [state.flow.id, uploadReferences]);

  const handleRefContextMenu = useCallback(
    (e: React.MouseEvent, entry: ReferenceEntry) => {
      e.preventDefault();
      const isFolder = entry.type === 'folder';
      const projectId = state.flow.id;
      const items: ContextMenuEntry[] = isFolder
        ? [
            { label: 'Upload File...', onClick: () => {
              const input = document.createElement('input');
              input.type = 'file';
              input.multiple = true;
              input.onchange = async () => {
                if (input.files) await uploadReferences(projectId, Array.from(input.files), entry.path);
              };
              input.click();
            }},
            { label: 'New Folder...', onClick: () => {
              const name = window.prompt('Folder name:');
              if (!name?.trim()) return;
              createReferenceFolder(projectId, entry.path + '/' + name.trim());
            }},
            { separator: true },
            { label: 'Rename', onClick: () => {
              const newName = window.prompt('New name:', entry.name);
              if (!newName?.trim() || newName === entry.name) return;
              const dir = entry.path.includes('/') ? entry.path.substring(0, entry.path.lastIndexOf('/') + 1) : '';
              renameReference(projectId, entry.path, dir + newName.trim());
            }},
            { label: 'Delete', onClick: () => {
              if (window.confirm(`Delete folder "${entry.name}" and all its contents?`)) {
                deleteReference(projectId, entry.path);
              }
            }, danger: true },
          ]
        : [
            { label: 'Open', onClick: () => handleOpenReference(entry) },
            { separator: true },
            { label: 'Rename', onClick: () => {
              const newName = window.prompt('New name:', entry.name);
              if (!newName?.trim() || newName === entry.name) return;
              const dir = entry.path.includes('/') ? entry.path.substring(0, entry.path.lastIndexOf('/') + 1) : '';
              renameReference(projectId, entry.path, dir + newName.trim());
            }},
            { label: 'Delete', onClick: () => {
              if (window.confirm(`Delete "${entry.name}"?`)) {
                deleteReference(projectId, entry.path);
              }
            }, danger: true },
          ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [handleOpenReference, state.flow.id, uploadReferences, deleteReference, createReferenceFolder, renameReference],
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
          { label: 'New Skill', onClick: () => handleAddSkill() },
        ];
      } else {
        items = [
          { label: 'Upload File...', onClick: handleUploadClick },
          { label: 'New Folder', onClick: () => {
            const name = window.prompt('Folder name:');
            if (!name?.trim()) return;
            createReferenceFolder(state.flow.id, name.trim());
          }},
        ];
      }
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [addNode, handleAddSkill, handleUploadClick, state.flow.id, createReferenceFolder],
  );

  // Empty set for the root level of skill tree (no ancestors yet)
  const emptyVisited = useState(() => new Set<string>())[0];

  return (
    <div className="h-full flex flex-col select-none overflow-y-auto">
      {/* Agents */}
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

      {/* Skills */}
      <SectionHeader
        title="Skills"
        expanded={skillsExpanded}
        onToggle={() => setSkillsExpanded(!skillsExpanded)}
        onAdd={handleAddSkill}
        onContextMenu={(e) => handleSectionContextMenu(e, 'skills')}
      />

      {skillsExpanded && (
        <div className="py-0.5">
          {skills.map((skill) => (
            <SkillTreeItem
              key={skill.name}
              skill={skill}
              allSkills={skills}
              depth={0}
              activeTabId={activeTabId}
              visited={emptyVisited}
              onSelect={selectSkill}
              onContextMenu={handleSkillContextMenu}
            />
          ))}
        </div>
      )}

      {/* References */}
      <SectionHeader
        title="References"
        expanded={refsExpanded}
        onToggle={() => setRefsExpanded(!refsExpanded)}
        onAdd={handleUploadClick}
        onContextMenu={(e) => handleSectionContextMenu(e, 'references')}
      />

      {refsExpanded && (
        <div
          className={`py-0.5 transition-colors ${dragOver ? 'bg-[var(--color-node-agent)]/10 ring-1 ring-inset ring-[var(--color-node-agent)]/30' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {references.length === 0 ? (
            <div className="px-3 py-3 text-center">
              <div className="text-[10px] text-[var(--color-text-muted)]">
                Drop files here or click + to upload
              </div>
            </div>
          ) : (
            references.map((entry) => (
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

      {/* Artifacts */}
      <SectionHeader
        title="Artifacts"
        expanded={artifactsExpanded}
        onToggle={() => setArtifactsExpanded(!artifactsExpanded)}
      />

      {artifactsExpanded && (
        <div className="py-0.5">
          {artifactLineage.length === 0 ? (
            <div className="px-3 py-3 text-center">
              <div className="text-[10px] text-[var(--color-text-muted)]">
                No artifacts declared yet
              </div>
            </div>
          ) : (
            artifactLineage.map((artifact) => (
              <div
                key={artifact.name}
                className="px-2 py-1 text-xs border-l-2 border-l-transparent hover:bg-[var(--color-canvas-bg)] cursor-default"
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-3 shrink-0" />
                  <span className="font-mono text-[11px] text-[var(--color-text-primary)] truncate">
                    {artifact.name}
                  </span>
                  {artifact.format && (
                    <span className={`text-[9px] font-medium px-1 py-0 rounded ${
                      FORMAT_BADGE_COLORS[artifact.format] ?? 'bg-gray-100 text-gray-600'
                    }`}>
                      {artifact.format.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="ml-6 text-[10px] text-[var(--color-text-muted)] space-y-0.5 mt-0.5">
                  {artifact.producers.length > 0 ? (
                    <div>
                      <span className="text-[var(--color-node-merge)]">{'\u2192 '}</span>
                      produced by: {artifact.producers.join(', ')}
                    </div>
                  ) : (
                    <div>
                      <span className="text-[var(--color-node-checkpoint)]">{'\u2192 '}</span>
                      user upload
                    </div>
                  )}
                  {artifact.consumers.length > 0 && (
                    <div>
                      <span className="text-[var(--color-node-agent)]">{'\u2192 '}</span>
                      consumed by: {artifact.consumers.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Hidden file input for reference uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

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
