import { useEffect, useCallback, useMemo } from 'react';
import { useWorkspace, type WorkspaceSelection } from '../../context/WorkspaceContext';
import { useFlow } from '../../context/FlowContext';
import { useProjectStore } from '../../context/ProjectStore';
import { SkillProvider, useSkill, type SkillViewMode } from '../../context/SkillContext';
import { TabBar } from './TabBar';
import { AgentEditor } from './AgentEditor';
import { ReferenceViewer } from './ReferenceViewer';
import { CodeMirrorEditor } from '../skill-editor/CodeMirrorEditor';
import { SkillSlashEditor } from '../skill-editor/SkillSlashEditor';
import { MarkdownPreview } from '../skill-editor/MarkdownPreview';
import { compileSkillContent } from '../../lib/compile-skill';
import { ImportSuggestionsBar } from '../skill-editor/ImportSuggestionsBar';
import { DropZoneOverlay } from './DropZoneOverlay';

interface EditorGroupPanelProps {
  groupId: string;
  isDragging: boolean;
  dragSourceGroupId: string | null;
}

export function EditorGroupPanel({ groupId, isDragging, dragSourceGroupId }: EditorGroupPanelProps) {
  const {
    groups,
    activeGroupId,
    activateTab,
    closeTab,
    splitGroup,
    setActiveGroup,
  } = useWorkspace();
  const { selectNode } = useFlow();

  const group = groups[groupId];
  const isGroupActive = groupId === activeGroupId;

  const selection = useMemo<WorkspaceSelection>(() => {
    if (!group || !group.activeTabId) return null;
    const tab = group.tabs.find((t) => t.id === group.activeTabId);
    if (!tab) return null;
    if (tab.type === 'agent' && tab.nodeId) return { type: 'agent', nodeId: tab.nodeId };
    if (tab.type === 'skill' && tab.skillName) return { type: 'skill', skillName: tab.skillName };
    if (tab.type === 'reference' && tab.refPath) return { type: 'reference', refPath: tab.refPath };
    return null;
  }, [group]);

  // Sync FlowContext selection only for the active group
  useEffect(() => {
    if (!isGroupActive) return;
    if (selection?.type === 'agent') {
      selectNode(selection.nodeId);
    } else {
      selectNode(null);
    }
  }, [selection, selectNode, isGroupActive]);

  const handleActivateTab = useCallback(
    (tabId: string) => activateTab(tabId, groupId),
    [activateTab, groupId],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => closeTab(tabId, groupId),
    [closeTab, groupId],
  );

  const handleSplit = useCallback(
    (direction: 'horizontal' | 'vertical') => splitGroup(groupId, direction),
    [splitGroup, groupId],
  );

  const handleFocus = useCallback(() => {
    if (!isGroupActive) setActiveGroup(groupId);
  }, [isGroupActive, setActiveGroup, groupId]);

  if (!group) return null;

  return (
    <div
      className={`h-full flex flex-col overflow-hidden relative ${
        isGroupActive ? 'border-t border-t-[var(--color-node-agent)]/50' : ''
      }`}
      onClick={handleFocus}
      onFocus={handleFocus}
    >
      <TabBar
        groupId={groupId}
        tabs={group.tabs}
        activeTabId={group.activeTabId}
        isGroupActive={isGroupActive}
        onActivate={handleActivateTab}
        onClose={handleCloseTab}
        onSplit={handleSplit}
      />

      <div className="flex-1 overflow-hidden bg-white">
        {!selection ? (
          <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
            Select an agent or skill to edit
          </div>
        ) : selection.type === 'agent' ? (
          <AgentEditor key={selection.nodeId} nodeId={selection.nodeId} />
        ) : selection.type === 'reference' ? (
          <ReferenceViewer key={selection.refPath} refPath={selection.refPath} />
        ) : (
          <SkillEditorPanel key={selection.skillName} skillName={selection.skillName} />
        )}
      </div>

      {/* Drop zone overlay during drag */}
      {isDragging && (
        <DropZoneOverlay groupId={groupId} />
      )}
    </div>
  );
}

/* ── Skill Editor (moved from EditorPanel.tsx) ──────────── */

function SkillEditorPanel({ skillName }: { skillName: string }) {
  const { skillData } = useProjectStore();
  const data = skillData[skillName];

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Skill not found: {skillName}
      </div>
    );
  }

  return (
    <SkillProvider initialState={data}>
      <SkillEditorContent skillName={skillName} />
    </SkillProvider>
  );
}

const VIEW_MODE_LABELS: Record<SkillViewMode, string> = {
  edit: 'Edit',
  compiled: 'Compiled',
  raw: 'Raw',
};

function SkillEditorContent({ skillName }: { skillName: string }) {
  const { state, selectedFile, selectFile, updateFile, viewMode, setViewMode } = useSkill();

  const handleChange = useCallback(
    (content: string) => {
      if (selectedFile) {
        updateFile(selectedFile.path, content);
      }
    },
    [selectedFile, updateFile],
  );

  const compiledContent = useMemo(
    () => (selectedFile ? compileSkillContent(selectedFile.content) : ''),
    [selectedFile],
  );

  const skillMd = state.files.find((f) => f.path === 'SKILL.md');
  const references = state.files.filter((f) => f.path.startsWith('references/'));
  const scripts = state.files.filter((f) => f.path.startsWith('scripts/'));

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-[var(--color-border)] bg-white overflow-x-auto">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mr-2 shrink-0">
          {skillName}
        </span>

        {skillMd && (
          <FileChip
            path="SKILL.md"
            isActive={selectedFile?.path === 'SKILL.md'}
            onClick={() => selectFile('SKILL.md')}
          />
        )}

        {references.length > 0 && (
          <>
            <span className="text-[var(--color-border)] mx-1 shrink-0">|</span>
            {references.map((f) => (
              <FileChip
                key={f.path}
                path={f.path}
                isActive={selectedFile?.path === f.path}
                onClick={() => selectFile(f.path)}
              />
            ))}
          </>
        )}

        {scripts.length > 0 && (
          <>
            <span className="text-[var(--color-border)] mx-1 shrink-0">|</span>
            {scripts.map((f) => (
              <FileChip
                key={f.path}
                path={f.path}
                isActive={selectedFile?.path === f.path}
                onClick={() => selectFile(f.path)}
              />
            ))}
          </>
        )}

        <div className="flex-1" />

        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Auto-detect import bar (only in edit mode) */}
      {viewMode === 'edit' && selectedFile && (
        <ImportSuggestionsBar
          content={selectedFile.content}
          onConvert={(converted) => updateFile(selectedFile.path, converted)}
        />
      )}

      <div className="flex-1 overflow-hidden bg-white">
        {selectedFile ? (
          viewMode === 'edit' ? (
            <SkillSlashEditor
              key={`edit-${selectedFile.path}`}
              content={selectedFile.content}
              onChange={handleChange}
            />
          ) : viewMode === 'compiled' ? (
            <MarkdownPreview
              key={`compiled-${selectedFile.path}`}
              content={compiledContent}
              fileName={selectedFile.path}
            />
          ) : (
            <CodeMirrorEditor
              key={`raw-${selectedFile.path}`}
              content={selectedFile.content}
              onChange={handleChange}
            />
          )
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  );
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: SkillViewMode;
  onChange: (mode: SkillViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-0 rounded-md border border-[var(--color-border)] overflow-hidden shrink-0">
      {(['edit', 'compiled', 'raw'] as SkillViewMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
            viewMode === mode
              ? 'bg-[var(--color-node-agent)] text-white'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
          }`}
        >
          {VIEW_MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}

function FileChip({
  path,
  isActive,
  onClick,
}: {
  path: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const fileName = path.includes('/') ? path.split('/').pop()! : path;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] rounded shrink-0 transition-colors ${
        isActive
          ? 'bg-[var(--color-node-merge)]/12 text-[var(--color-node-merge)] font-medium'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-canvas-bg)]'
      }`}
    >
      {fileName}
    </button>
  );
}
