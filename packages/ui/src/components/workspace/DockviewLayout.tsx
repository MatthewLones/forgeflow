import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type DockviewApi,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { useLayout, type EditorTab } from '../../context/LayoutContext';
import { useFlow } from '../../context/FlowContext';
import { useProjectStore } from '../../context/ProjectStore';
import { SkillProvider, useSkill } from '../../context/SkillContext';
import { AgentEditor } from './AgentEditor';
import { ArtifactEditor } from './ArtifactViewer';
import { ReferenceViewer } from './ReferenceViewer';
import { SkillSlashEditor } from '../skill-editor/SkillSlashEditor';
import { ImportSuggestionsBar } from '../skill-editor/ImportSuggestionsBar';
import { useSyncSkill } from '../../hooks/useSyncSkill';
import { useParams } from 'react-router-dom';

/* ── Panel components ─────────────────────────────────────── */

function AgentEditorPanel(props: IDockviewPanelProps<EditorTab>) {
  const params = props.params;
  const { selectNode } = useFlow();

  // Sync flow selection when this panel becomes active
  useEffect(() => {
    const disposable = props.api.onDidActiveChange((e) => {
      if (e.isActive && params.nodeId) {
        selectNode(params.nodeId);
      }
    });
    return () => disposable.dispose();
  }, [props.api, params.nodeId, selectNode]);

  if (!params.nodeId) return null;
  return <AgentEditor key={params.nodeId} nodeId={params.nodeId} />;
}

function SkillEditorPanel(props: IDockviewPanelProps<EditorTab>) {
  const params = props.params;
  const { id: projectId } = useParams<{ id: string }>();
  const { skillData, loadSkill } = useProjectStore();
  const [loading, setLoading] = useState(false);

  const skillName = params.skillName;

  // Load skill data from API if not cached
  useEffect(() => {
    if (!skillName || !projectId) return;
    if (skillData[skillName]) return;
    let cancelled = false;
    setLoading(true);
    loadSkill(projectId, skillName).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [skillName, projectId, skillData, loadSkill]);

  if (!skillName) return null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Loading skill...
      </div>
    );
  }

  const data = skillData[skillName];
  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Skill not found: {skillName}
      </div>
    );
  }

  return (
    <SkillProvider initialState={{ ...data, selectedFilePath: 'SKILL.md', dirty: false }}>
      <SkillEditorContent skillName={skillName} projectId={projectId} />
    </SkillProvider>
  );
}

function SkillEditorContent({ skillName, projectId }: { skillName: string; projectId: string }) {
  const { state, selectedFile, selectFile, updateFile } = useSkill();
  const { skills, createSkill, renameSkill, deleteSkill } = useProjectStore();
  const { selectSkill, selectArtifact, updateTabLabel } = useLayout();
  const { state: flowState } = useFlow();

  // Local state for editable skill name
  const [editName, setEditName] = useState(skillName);

  // Sync skill edits back to ProjectStore cache + server
  useSyncSkill(projectId, skillName, state);

  const handleChange = useCallback(
    (content: string) => {
      if (selectedFile) {
        updateFile(selectedFile.path, content);
      }
    },
    [selectedFile, updateFile],
  );

  const handleCreateSkill = useCallback(
    (name: string) => {
      createSkill(projectId, name);
    },
    [createSkill, projectId],
  );

  const handleClickSkill = useCallback(
    (name: string) => selectSkill(name),
    [selectSkill],
  );

  const handleClickFile = useCallback(
    (path: string) => selectFile(path),
    [selectFile],
  );

  const handleRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== skillName) {
      renameSkill(projectId, skillName, trimmed).catch(() => setEditName(skillName));
      updateTabLabel(skillName, trimmed);
    } else {
      setEditName(skillName);
    }
  }, [editName, skillName, projectId, renameSkill, updateTabLabel]);

  const handleDelete = useCallback(() => {
    if (window.confirm(`Delete skill "${skillName}"?`)) {
      deleteSkill(projectId, skillName);
    }
  }, [skillName, projectId, deleteSkill]);

  // Derive skill names, file paths, and artifact names for slash command autocomplete
  const skillNames = useMemo(() => skills.map((s) => s.name), [skills]);
  const filePaths = useMemo(() => state.files.map((f) => f.path), [state.files]);
  const artifactNames = useMemo(() => Object.keys(flowState.flow.artifacts ?? {}), [flowState.flow.artifacts]);

  const handleClickArtifact = useCallback(
    (name: string) => selectArtifact(name),
    [selectArtifact],
  );

  const skillMd = state.files.find((f) => f.path === 'SKILL.md');
  const references = state.files.filter((f) => f.path.startsWith('references/'));
  const scripts = state.files.filter((f) => f.path.startsWith('scripts/'));
  const hasFileTabs = references.length > 0 || scripts.length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Primary header — agent-style */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-white">
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="text-sm font-semibold text-[var(--color-text-primary)] bg-transparent border-none outline-none flex-1 min-w-0 placeholder:text-[var(--color-text-muted)]"
          placeholder="Skill name"
        />

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-[var(--color-text-muted)]">Skill</span>
        </div>

        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
          {skillName}
        </span>

        <button
          type="button"
          onClick={handleDelete}
          title="Delete skill"
          className="text-[var(--color-text-muted)] hover:text-red-500 transition-colors shrink-0 text-xs"
        >
          Delete
        </button>
      </div>

      {/* Secondary bar — file tabs (only if refs/scripts exist) */}
      {hasFileTabs && (
        <div className="shrink-0 flex items-center gap-1 px-3 py-1 border-b border-[var(--color-border)] bg-white overflow-x-auto">
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
        </div>
      )}

      {selectedFile && (
        <ImportSuggestionsBar
          content={selectedFile.content}
          onConvert={(converted) => updateFile(selectedFile.path, converted)}
        />
      )}

      <div className="flex-1 overflow-hidden bg-white">
        {selectedFile ? (
          <SkillSlashEditor
            key={`edit-${selectedFile.path}`}
            content={selectedFile.content}
            onChange={handleChange}
            skills={skillNames}
            files={filePaths}
            artifacts={artifactNames}
            currentSkill={skillName}
            onCreateSkill={handleCreateSkill}
            onClickSkill={handleClickSkill}
            onClickFile={handleClickFile}
            onClickArtifact={handleClickArtifact}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
            Select a file to edit
          </div>
        )}
      </div>
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

function ArtifactEditorPanel(props: IDockviewPanelProps<EditorTab>) {
  const params = props.params;
  if (!params.artifactName) return null;
  return <ArtifactEditor key={params.artifactName} artifactName={params.artifactName} />;
}

function ReferenceViewerPanel(props: IDockviewPanelProps<EditorTab>) {
  const params = props.params;
  if (!params.refPath) return null;
  return <ReferenceViewer key={params.refPath} refPath={params.refPath} />;
}

function EmptyPanel() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
      Select an agent or skill to edit
    </div>
  );
}

/* ── Panel registry ───────────────────────────────────────── */

const components = {
  'agent-editor': AgentEditorPanel,
  'skill-editor': SkillEditorPanel,
  'artifact-editor': ArtifactEditorPanel,
  'reference-viewer': ReferenceViewerPanel,
  'empty': EmptyPanel,
};

/* ── Custom tab renderer ──────────────────────────────────── */

const TYPE_DOT_COLORS: Record<string, string> = {
  agent: 'bg-[var(--color-node-agent)]',
  skill: 'bg-[var(--color-node-merge)]',
  reference: 'bg-[var(--color-node-checkpoint)]',
  artifact: 'bg-purple-500',
};

function ForgeFlowTab(props: IDockviewPanelHeaderProps<EditorTab>) {
  const params = props.params;
  const tabType = params?.type ?? 'agent';
  const dotColor = TYPE_DOT_COLORS[tabType] ?? TYPE_DOT_COLORS.agent;

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      props.api.close();
    },
    [props.api],
  );

  return (
    <div className="flex items-center gap-1.5 h-full px-2 text-xs cursor-pointer select-none group">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <span className="truncate max-w-[120px]">{props.api.title}</span>
      <button
        type="button"
        onClick={handleClose}
        className="ml-1 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 transition-all text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] shrink-0"
      >
        ×
      </button>
    </div>
  );
}

const tabComponents = {
  default: ForgeFlowTab,
};

/* ── Main layout component ────────────────────────────────── */

export function DockviewLayout() {
  const { setApi } = useLayout();

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      setApi(event.api);
      setupKeyboardShortcuts(event.api);
    },
    [setApi],
  );

  return (
    <DockviewReact
      components={components}
      defaultTabComponent={tabComponents.default}
      onReady={handleReady}
      className="h-full w-full dockview-theme-light forgeflow-dockview"
    />
  );
}

/* ── Keyboard shortcuts ───────────────────────────────────── */

function setupKeyboardShortcuts(api: DockviewApi) {
  const handler = (e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;

    // Cmd+W — Close active panel
    if (isMeta && e.key === 'w') {
      e.preventDefault();
      const active = api.activePanel;
      if (active) {
        api.removePanel(active);
      }
      return;
    }

    // Cmd+\ — Split right
    if (isMeta && !e.shiftKey && e.key === '\\') {
      e.preventDefault();
      const active = api.activePanel;
      if (active) {
        api.addPanel({
          id: `empty-${Date.now()}`,
          component: 'empty',
          title: 'Empty',
          position: { referencePanel: active.id, direction: 'right' },
        });
      }
      return;
    }

    // Cmd+Shift+\ — Split down
    if (isMeta && e.shiftKey && e.key === '\\') {
      e.preventDefault();
      const active = api.activePanel;
      if (active) {
        api.addPanel({
          id: `empty-${Date.now()}`,
          component: 'empty',
          title: 'Empty',
          position: { referencePanel: active.id, direction: 'below' },
        });
      }
      return;
    }

    // Cmd+1-9 — Focus group by index
    if (isMeta && e.key >= '1' && e.key <= '9') {
      const groups = api.groups;
      const idx = parseInt(e.key) - 1;
      if (idx < groups.length) {
        e.preventDefault();
        const group = groups[idx];
        const firstPanel = group.panels[0];
        if (firstPanel) {
          firstPanel.api.setActive();
        }
      }
    }
  };

  document.addEventListener('keydown', handler);
  // Cleanup handled by DockviewReact unmount
}
