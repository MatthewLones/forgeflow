# Workspace Components

## Purpose
All panel components rendered inside the dockview-react IDE workspace, plus the workspace toolbar. Does NOT own the DAG canvas itself (that's in `../canvas/`), routing, or context providers.

## Entry Points
- `DockviewLayout` — mounts `DockviewReact`, registers all panel components in its `components` map, renders custom tab headers with type-colored dots
- `WorkspaceToolbar` — top toolbar with save status, validate/compile/run/export/git/AI buttons
- `AgentEditor` — node instructions editor with slash commands, config sync, and skill output inheritance
- `EditorLayout` — thin wrapper around DockviewLayout

## Contracts & Invariants
- Every new panel type MUST be added to the `components` map in `DockviewLayout.tsx` AND a dot color entry in `TYPE_DOT_COLORS`. Without both, the panel will fail to render or display a broken tab.
- `AgentEditor` syncs config from instructions via `extractConfigFromInstructions()` on a 500ms debounce. The config bottom panel reflects parsed state. Never write config sync logic elsewhere. The debounce also auto-registers any `\output` or `@input` artifact names not yet in `state.flow.artifacts`.
- `SkillEditorPanel` wraps each skill in its own `SkillProvider` context. The `useSyncSkill` hook handles debounced persistence to the server. Skill data is loaded on demand from `ProjectStore.loadSkill()`.
- Panel components receive dockview `IDockviewPanelProps<EditorTab>` and extract params (`nodeId`, `skillName`, `artifactName`, `refPath`) from `props.params`.
- `AgentEditorPanel` syncs flow selection via `onDidActiveChange` — when a tab becomes active, it calls `selectNode()` to update the canvas selection.

## Anti-Patterns
- Do NOT call `api` directly from workspace panels — use FlowContext, RunContext, or ProjectStore contexts instead. The contexts handle debouncing, caching, and state management.
- Do NOT create standalone modals — use dockview panels (e.g., `PreRunPanel` is a panel, not a modal).
- Do NOT duplicate `findNode()` tree traversal — multiple files define local `findNode()` helpers; these are intentional per-file utilities due to the recursive FlowNode structure.
- Do NOT create agents/skills/artifacts from the `updateListener` in `SlashCommandEditor` — entity creation must only happen through autocomplete "Create" callbacks (function `apply`), which fire exactly once. Scanning the doc on every keystroke causes duplicate creation due to stale closures.

## Dependencies
- Consumes: `FlowContext`, `LayoutContext`, `DagContext`, `GitContext`, `ProjectStore`, `SkillContext`, `RunContext`
- Consumes: `../skill-editor/SkillSlashEditor`, `../shared/TodoWidget`, `../shared/CheckpointPanel`
- Consumed by: `pages/WorkspacePage` (renders `EditorLayout` + `WorkspaceToolbar`)

## Patterns
- `flowVersion` key: AgentEditorPanel and SkillEditorPanel include `state.flowVersion` in React `key` to force remount on git operations that replace the flow.
- Skill output inheritance: AgentEditor tracks `skillOutputsRef` and `inheritedNamesRef` to merge skill-declared outputs into node config. When skills change, old inherited outputs are removed and new ones added.
- Split run button: `SplitRunButton` in toolbar has a dropdown for "Run in Workspace" (inline panel) vs standard "Run" (navigates to dashboard).
- Horizontal tab scroll fix: DockviewLayout patches wheel events on the tab bar container to translate vertical scroll to horizontal scroll (workaround for dockview v5).
- Autocomplete acceptance: `SlashCommandEditor` maps both Tab and Space to `acceptCompletion` at highest priority. Space accepts the completion then inserts a trailing space; when no dropdown is open, Space falls through to default input.
