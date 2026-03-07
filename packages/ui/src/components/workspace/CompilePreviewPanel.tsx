import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { EditorTab } from '../../context/LayoutContext';
import type { CompilePreviewResult, CompilePreviewSkill } from '../../lib/api-client';
import type { AgentPhaseIR, CheckpointIR, PhaseIR } from '@forgeflow/types';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';

const NODE_TYPE_GLYPH: Record<string, string> = {
  agent: 'A',
  checkpoint: 'C',
};

export function CompilePreviewPanel(props: IDockviewPanelProps<EditorTab>) {
  const result = props.params.compileResult;

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No compile results
      </div>
    );
  }

  if (!result.valid) {
    return (
      <div className="h-full flex flex-col p-4 gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-red-500">
          Compilation Failed
        </div>
        {result.errors?.map((err, i) => (
          <div key={i} className="text-xs text-[var(--color-text-secondary)] flex items-start gap-2">
            <span className="text-red-500 shrink-0">{'\u25CF'}</span>
            {err.message}
          </div>
        ))}
      </div>
    );
  }

  return <CompilePreviewContent result={result} />;
}

type SidebarSelection =
  | { type: 'phase'; phaseIdx: number }
  | { type: 'child'; phaseIdx: number; childKey: string }
  | { type: 'system' }
  | { type: 'skill'; skillIdx: number; fileIdx: number };

function CompilePreviewContent({ result }: { result: CompilePreviewResult }) {
  const { phases, systemPrompt, skills } = result;
  const [selection, setSelection] = useState<SidebarSelection>({ type: 'phase', phaseIdx: 0 });
  /** When viewing a workspace file, store its path + content */
  const [workspaceFile, setWorkspaceFile] = useState<{ path: string; content: string } | null>(null);

  // Determine content to display
  let content = '';
  if (selection.type === 'system') {
    content = systemPrompt ?? '';
  } else if (selection.type === 'skill') {
    const skill = skills?.[selection.skillIdx];
    const file = skill?.files[selection.fileIdx];
    content = file?.content ?? '';
  } else if (selection.type === 'child') {
    const phase = phases[selection.phaseIdx];
    content = phase?.childPrompts[selection.childKey]?.markdown ?? '';
  } else {
    const phase = phases[selection.phaseIdx];
    content = phase?.prompt ?? '';
  }

  // If viewing a workspace file, override content
  const displayContent = workspaceFile ? workspaceFile.content : content;

  // Current phase for workspace tree
  const currentPhaseIdx = selection.type === 'phase' || selection.type === 'child' ? selection.phaseIdx : null;
  const currentPhase = currentPhaseIdx !== null ? phases[currentPhaseIdx] : null;

  // Which sidebar phases are expanded (to show children)
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(() => {
    // Auto-expand phases that have children
    const expanded = new Set<number>();
    phases.forEach((p, i) => {
      if (Object.keys(p.childPrompts).length > 0) expanded.add(i);
    });
    return expanded;
  });

  // Which sidebar skills are expanded (to show files)
  const [expandedSkills, setExpandedSkills] = useState<Set<number>>(new Set());

  const togglePhaseExpand = (idx: number) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleSkillExpand = (idx: number) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handlePhaseSelect = (idx: number) => {
    setSelection({ type: 'phase', phaseIdx: idx });
    setWorkspaceFile(null);
  };

  const handleChildSelect = (phaseIdx: number, childKey: string) => {
    setSelection({ type: 'child', phaseIdx, childKey });
    setWorkspaceFile(null);
  };

  // Unique key for editor re-render
  const editorKey = workspaceFile
    ? `ws-file-${workspaceFile.path}`
    : selection.type === 'system'
      ? 'system'
      : selection.type === 'skill'
        ? `skill-${selection.skillIdx}-${selection.fileIdx}`
        : selection.type === 'child'
          ? `child-${selection.phaseIdx}-${selection.childKey}`
          : `phase-${selection.phaseIdx}`;

  // Show workspace pane for phases
  const showWorkspace = currentPhase !== null && (selection.type === 'phase' || selection.type === 'child');

  return (
    <div className="h-full flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-52 shrink-0 border-r border-[var(--color-border)] overflow-y-auto bg-[var(--color-canvas-bg)]">
        {/* System Prompt */}
        {systemPrompt && (
          <>
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              System
            </div>
            <SidebarItem
              glyph="S"
              glyphClass="bg-amber-500/15 text-amber-600"
              label="System Prompt"
              isActive={selection.type === 'system'}
              onClick={() => { setSelection({ type: 'system' }); setWorkspaceFile(null); }}
            />
          </>
        )}

        {/* Phases + nested children */}
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Phases
        </div>
        {phases.map((p, i) => {
          const childKeys = Object.keys(p.childPrompts);
          const hasChildren = childKeys.length > 0;
          const isExpanded = expandedPhases.has(i);
          const isPhaseActive = (selection.type === 'phase' && selection.phaseIdx === i)
            || (selection.type === 'child' && selection.phaseIdx === i);

          return (
            <div key={p.nodeId}>
              <div className="flex items-center">
                {/* Expand toggle */}
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => togglePhaseExpand(i)}
                    className="w-4 shrink-0 flex items-center justify-center text-[8px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1"
                  >
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </button>
                ) : (
                  <span className="w-4 shrink-0 ml-1" />
                )}
                <button
                  type="button"
                  onClick={() => handlePhaseSelect(i)}
                  className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                    selection.type === 'phase' && selection.phaseIdx === i
                      ? 'bg-white text-[var(--color-text-primary)] font-medium'
                      : isPhaseActive
                        ? 'bg-white/40 text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-white/60'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center shrink-0 ${
                      p.nodeType === 'checkpoint'
                        ? 'bg-[var(--color-node-checkpoint)]/15 text-[var(--color-node-checkpoint)]'
                        : 'bg-[var(--color-node-agent)]/15 text-[var(--color-node-agent)]'
                    }`}
                  >
                    {NODE_TYPE_GLYPH[p.nodeType] ?? 'A'}
                  </span>
                  <span className="truncate">{p.nodeName}</span>
                </button>
              </div>

              {/* Nested child subagents */}
              {hasChildren && isExpanded && (
                <div className="ml-5 border-l border-[var(--color-border)]">
                  {childKeys.map((key) => {
                    // Try to extract child name from the key (e.g., "analyze_financials.md")
                    const childName = key.replace(/\.md$/, '').replace(/_/g, ' ');
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleChildSelect(i, key)}
                        className={`w-full flex items-center gap-2 pl-3 pr-2 py-1 text-left text-[11px] transition-colors ${
                          selection.type === 'child' && selection.phaseIdx === i && selection.childKey === key
                            ? 'bg-white text-[var(--color-text-primary)] font-medium'
                            : 'text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-secondary)]'
                        }`}
                      >
                        <span className="w-3.5 h-3.5 rounded text-[8px] font-bold flex items-center justify-center shrink-0 bg-[var(--color-node-agent)]/10 text-[var(--color-node-agent)]">
                          A
                        </span>
                        <span className="truncate capitalize">{childName}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Skills with nested file tree */}
        {skills && skills.length > 0 && (
          <>
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              Skills
            </div>
            {skills.map((skill, si) => {
              const isExpanded = expandedSkills.has(si);
              const hasMultipleFiles = skill.files.length > 1;
              return (
                <div key={skill.name}>
                  <div className="flex items-center">
                    {hasMultipleFiles ? (
                      <button
                        type="button"
                        onClick={() => toggleSkillExpand(si)}
                        className="w-4 shrink-0 flex items-center justify-center text-[8px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1"
                      >
                        {isExpanded ? '\u25BC' : '\u25B6'}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0 ml-1" />
                    )}
                    <button
                      type="button"
                      onClick={() => { setSelection({ type: 'skill', skillIdx: si, fileIdx: 0 }); setWorkspaceFile(null); }}
                      className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                        selection.type === 'skill' && selection.skillIdx === si
                          ? 'bg-white text-[var(--color-text-primary)] font-medium'
                          : 'text-[var(--color-text-secondary)] hover:bg-white/60'
                      }`}
                    >
                      <span className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center shrink-0 bg-emerald-500/15 text-emerald-600">
                        K
                      </span>
                      <span className="truncate">{skill.name}</span>
                    </button>
                  </div>
                  {hasMultipleFiles && isExpanded && (
                    <div className="ml-5 border-l border-[var(--color-border)]">
                      {skill.files.map((file, fi) => (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => { setSelection({ type: 'skill', skillIdx: si, fileIdx: fi }); setWorkspaceFile(null); }}
                          className={`w-full flex items-center gap-1.5 pl-3 pr-2 py-1 text-left text-[11px] transition-colors ${
                            selection.type === 'skill' && selection.skillIdx === si && selection.fileIdx === fi
                              ? 'bg-white text-[var(--color-text-primary)] font-medium'
                              : 'text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-secondary)]'
                          }`}
                        >
                          <span className="text-[var(--color-text-muted)] text-[9px] shrink-0">{'\uD83D\uDCC4'}</span>
                          <span className="truncate">{file.path}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Main content: editor + optional workspace pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor pane */}
        <div className={`flex-1 flex flex-col overflow-hidden ${showWorkspace ? 'min-w-0' : ''}`}>
          {/* Breadcrumb when viewing a workspace file */}
          {workspaceFile && (
            <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-[var(--color-border)] bg-white">
              <button
                type="button"
                onClick={() => setWorkspaceFile(null)}
                className="text-[11px] text-[var(--color-node-agent)] hover:underline shrink-0"
              >
                Workspace
              </button>
              <span className="text-[var(--color-text-muted)] text-[11px] shrink-0">&rsaquo;</span>
              <span className="text-[11px] text-[var(--color-text-primary)] font-medium truncate">
                {workspaceFile.path}
              </span>
            </div>
          )}

          {/* Read-only editor */}
          <div className="flex-1 overflow-hidden">
            <ReadOnlyMarkdownEditor key={editorKey} content={displayContent} />
          </div>
        </div>

        {/* Workspace pane (drag-resizable right side) */}
        {showWorkspace && (
          <ResizableWorkspacePane
            phase={currentPhase!}
            skills={skills}
            onFileSelect={(path, fileContent) => setWorkspaceFile({ path, content: fileContent })}
          />
        )}
      </div>
    </div>
  );
}

// ─── Sidebar Item ────────────────────────────────────────────────

function SidebarItem({
  glyph,
  glyphClass,
  label,
  isActive,
  onClick,
}: {
  glyph: string;
  glyphClass: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
        isActive
          ? 'bg-white text-[var(--color-text-primary)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-white/60'
      }`}
    >
      <span className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center shrink-0 ${glyphClass}`}>
        {glyph}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// ─── Resizable Workspace Pane ────────────────────────────────────

function ResizableWorkspacePane({
  phase,
  skills,
  onFileSelect,
}: {
  phase: { nodeId: string; ir?: PhaseIR; childPrompts: Record<string, { ir?: PhaseIR; markdown: string }> };
  skills?: CompilePreviewSkill[];
  onFileSelect: (path: string, content: string) => void;
}) {
  const [width, setWidth] = useState(224); // ~w-56
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      // Dragging the left edge: moving left increases width
      const delta = startX.current - ev.clientX;
      const newWidth = Math.max(120, Math.min(600, startWidth.current + delta));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  return (
    <div
      className="shrink-0 flex flex-col bg-[var(--color-canvas-bg)] relative"
      style={{ width: `${width}px` }}
    >
      {/* Drag handle on left border */}
      <div
        onMouseDown={onMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-node-agent)]/30 transition-colors z-10 border-l border-[var(--color-border)]"
      />

      {/* Header */}
      <div className="shrink-0 flex items-center px-2 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] truncate">
          Workspace
        </span>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-auto">
        <WorkspaceTreeView
          phase={phase}
          skills={skills}
          onFileSelect={onFileSelect}
        />
      </div>
    </div>
  );
}

// ─── Workspace Tree ──────────────────────────────────────────────

interface TreeNode {
  name: string;
  isDir: boolean;
  annotation?: string;
  content?: string;
  path: string;
  children?: TreeNode[];
}

function buildWorkspaceTree(
  phase: { nodeId: string; ir?: PhaseIR; childPrompts: Record<string, { ir?: PhaseIR; markdown: string }> },
  skills?: CompilePreviewSkill[],
): TreeNode {
  const ir = phase.ir;
  const root: TreeNode = { name: phase.nodeId, isDir: true, path: phase.nodeId, children: [] };

  // --- input/ ---
  const inputDir: TreeNode = { name: 'input', isDir: true, path: 'input', children: [] };
  if (ir && 'inputs' in ir) {
    const agentIR = ir as AgentPhaseIR;
    for (const inp of agentIR.inputs) {
      inputDir.children!.push({
        name: inp.file,
        isDir: false,
        annotation: inp.sourceLabel,
        path: `input/${inp.file}`,
        content: formatSchemaInfo(inp.file, inp.schema, inp.sourceLabel),
      });
    }
  } else if (ir && ir.kind === 'checkpoint') {
    const cpIR = ir as CheckpointIR;
    for (const f of cpIR.filesToPresent) {
      inputDir.children!.push({
        name: f.file,
        isDir: false,
        annotation: f.sourceLabel,
        path: `input/${f.file}`,
        content: formatSchemaInfo(f.file, f.schema, f.sourceLabel),
      });
    }
  }
  root.children!.push(inputDir);

  // --- output/ ---
  const outputDir: TreeNode = { name: 'output', isDir: true, path: 'output', children: [] };
  if (ir && 'outputs' in ir) {
    const agentIR = ir as AgentPhaseIR;
    for (const out of agentIR.outputs) {
      outputDir.children!.push({
        name: out.file,
        isDir: false,
        annotation: 'expected',
        path: `output/${out.file}`,
        content: formatSchemaInfo(out.file, out.schema, undefined, true),
      });
    }
  } else if (ir && ir.kind === 'checkpoint') {
    const cpIR = ir as CheckpointIR;
    for (const out of cpIR.expectedInputs) {
      outputDir.children!.push({
        name: out.file,
        isDir: false,
        annotation: 'expected from user',
        path: `output/${out.file}`,
        content: formatSchemaInfo(out.file, out.schema, undefined, true),
      });
    }
  }
  root.children!.push(outputDir);

  // --- skills/ ---
  const phaseSkillNames = new Set<string>();
  if (ir && 'skills' in ir) {
    for (const s of (ir as AgentPhaseIR).skills) {
      phaseSkillNames.add(s.name);
    }
  }

  if (skills && phaseSkillNames.size > 0) {
    const skillsDir: TreeNode = { name: 'skills', isDir: true, path: 'skills', children: [] };
    for (const skill of skills) {
      if (!phaseSkillNames.has(skill.name)) continue;
      const skillDir: TreeNode = { name: skill.name, isDir: true, path: `skills/${skill.name}`, children: [] };

      const filesByDir = new Map<string, { name: string; path: string; content: string }[]>();
      for (const f of skill.files) {
        const parts = f.path.split('/');
        if (parts.length === 1) {
          skillDir.children!.push({
            name: f.path,
            isDir: false,
            path: `skills/${skill.name}/${f.path}`,
            content: f.content,
          });
        } else {
          const dir = parts[0];
          if (!filesByDir.has(dir)) filesByDir.set(dir, []);
          filesByDir.get(dir)!.push({ name: parts.slice(1).join('/'), path: f.path, content: f.content });
        }
      }
      for (const [dirName, files] of filesByDir) {
        skillDir.children!.push({
          name: dirName,
          isDir: true,
          path: `skills/${skill.name}/${dirName}`,
          children: files.map((f) => ({
            name: f.name,
            isDir: false,
            path: `skills/${skill.name}/${f.path}`,
            content: f.content,
          })),
        });
      }
      skillsDir.children!.push(skillDir);
    }
    if (skillsDir.children!.length > 0) {
      root.children!.push(skillsDir);
    }
  }

  // --- prompts/ ---
  const childPromptKeys = Object.keys(phase.childPrompts);
  if (childPromptKeys.length > 0) {
    const promptsDir: TreeNode = { name: 'prompts', isDir: true, path: 'prompts', children: [] };
    for (const key of childPromptKeys) {
      promptsDir.children!.push({
        name: key,
        isDir: false,
        path: `prompts/${key}`,
        content: phase.childPrompts[key].markdown,
      });
    }
    root.children!.push(promptsDir);
  }

  return root;
}

function formatSchemaInfo(
  file: string,
  schema?: { name?: string; format?: string; description?: string; fields?: Array<{ key: string; type: string; description?: string; required?: boolean }> },
  sourceLabel?: string,
  isOutput?: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# ${file}`);
  if (sourceLabel) lines.push(`Source: ${sourceLabel}`);
  if (isOutput) lines.push('This file will be created by the agent during execution.');
  lines.push('');

  if (schema) {
    if (schema.format) lines.push(`**Format:** ${schema.format}`);
    if (schema.description) lines.push(`**Description:** ${schema.description}`);
    if (schema.fields && schema.fields.length > 0) {
      lines.push('');
      lines.push('## Fields');
      lines.push('');
      lines.push('| Field | Type | Description |');
      lines.push('|-------|------|-------------|');
      for (const f of schema.fields) {
        const opt = f.required === false ? ' (optional)' : '';
        lines.push(`| ${f.key} | ${f.type}${opt} | ${f.description ?? ''} |`);
      }
    }
  } else {
    lines.push('_No schema defined for this artifact._');
  }
  return lines.join('\n');
}

function WorkspaceTreeView({
  phase,
  skills,
  onFileSelect,
}: {
  phase: { nodeId: string; ir?: PhaseIR; childPrompts: Record<string, { ir?: PhaseIR; markdown: string }> };
  skills?: CompilePreviewSkill[];
  onFileSelect: (path: string, content: string) => void;
}) {
  const tree = useMemo(() => buildWorkspaceTree(phase, skills), [phase, skills]);

  return (
    <div className="py-1 font-mono text-[10px] leading-tight">
      {tree.children?.map((child) => (
        <TreeNodeRow key={child.path} node={child} depth={0} onFileSelect={onFileSelect} />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  onFileSelect,
}: {
  node: TreeNode;
  depth: number;
  onFileSelect: (path: string, content: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const indent = 6 + depth * 12;

  if (node.isDir) {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-0.5 py-px text-left hover:bg-white/60 transition-colors"
          style={{ paddingLeft: `${indent}px` }}
        >
          <span className="text-[var(--color-text-muted)] w-2.5 text-center shrink-0 text-[7px]">
            {hasChildren ? (expanded ? '\u25BC' : '\u25B6') : ''}
          </span>
          <span className="font-semibold text-[var(--color-text-secondary)] truncate">{node.name}/</span>
        </button>
        {expanded && node.children?.map((child) => (
          <TreeNodeRow key={child.path} node={child} depth={depth + 1} onFileSelect={onFileSelect} />
        ))}
      </div>
    );
  }

  const isClickable = node.content !== undefined;
  return (
    <button
      type="button"
      disabled={!isClickable}
      onClick={() => isClickable && onFileSelect(node.path, node.content!)}
      className={`w-full flex items-center gap-0.5 py-px text-left transition-colors overflow-hidden ${
        isClickable ? 'hover:bg-white/60 cursor-pointer' : 'cursor-default'
      }`}
      style={{ paddingLeft: `${indent + 12}px` }}
    >
      <span className={`shrink-0 ${isClickable ? 'text-[var(--color-node-agent)]' : 'text-[var(--color-text-secondary)]'}`}>
        {node.name}
      </span>
      {node.annotation && (
        <span className="text-[var(--color-text-muted)] text-[8px] truncate italic">
          {node.annotation}
        </span>
      )}
    </button>
  );
}

// ─── Read-only Editor ────────────────────────────────────────────

function ReadOnlyMarkdownEditor({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const theme = EditorView.theme({
      '&': { height: '100%', fontSize: '13px' },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: '1.6',
      },
      '.cm-content': { padding: '16px 0' },
      '.cm-cursor': { display: 'none !important' },
      '.cm-gutters': {
        borderRight: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-canvas-bg)',
        color: 'var(--color-text-muted)',
      },
      '.cm-line': { padding: '0 16px' },
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        theme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    return () => view.destroy();
  }, [content]);

  return <div ref={containerRef} className="h-full overflow-hidden" />;
}

