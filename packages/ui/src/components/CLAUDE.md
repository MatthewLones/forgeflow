# UI Components

## Purpose
All React components for the ForgeFlow IDE, run dashboard, and shared primitives. Does NOT own routing, contexts, hooks, or API client logic (those live in sibling `pages/`, `context/`, `hooks/`, `lib/` directories).

## Entry Points
- `workspace/DockviewLayout` — dockview-react panel manager; ALL workspace panel types registered here
- `run-dashboard/` — standalone run observability UI at `/projects/:id/runs/:runId`
- `shared/InterruptFormRouter` — dispatches interrupt forms by type (used by both workspace and dashboard)
- `canvas/nodes/` — `AgentNode`, `CheckpointNode` React Flow node renderers (shared by workspace DAG and dashboard DAG)
- `ai/AISidePanel` — Forge AI copilot chat panel

## Contracts & Invariants
- All styling uses Tailwind CSS with CSS custom properties (`var(--color-*)`) for theming. No CSS modules anywhere.
- Components receive data via React contexts (FlowContext, RunContext, LayoutContext, ProjectStore), never via prop drilling from page level.
- Canvas node components (`AgentNode`, `CheckpointNode`) and edge components (`FlowEdge`) are shared between the workspace DAG and the run-dashboard DAG. Changes to these affect both views.
- Interrupt forms always take `{ interrupt, onSubmit, disabled }` props. The `InterruptFormRouter` handles submission state and error display.

## Anti-Patterns
- Do NOT create a shared component library with generic primitives — components are purpose-built for ForgeFlow. Extract only when truly reused.
- Do NOT use CSS modules or styled-components — the entire UI uses Tailwind + CSS custom properties.
- Do NOT add new panel types without registering them in `workspace/DockviewLayout.tsx`'s `components` map and adding a corresponding `TYPE_DOT_COLORS` entry.
- Do NOT import `api` client directly in workspace panel components — workspace panels should go through contexts (RunContext, ProjectStore). Only run-dashboard and shared components call `api` directly.

## Dependencies
- Consumes: `FlowContext`, `RunContext`, `LayoutContext`, `DagContext`, `GitContext`, `ProjectStore`, `SkillContext` (all from `../context/`)
- Consumes: `api-client`, `flow-to-reactflow`, `chip-styles`, `sync-blocks-to-config`, `derive-phase-todos` (from `../lib/`)
- Consumes: `dockview-react`, `@xyflow/react`, `@codemirror/*`, `marked`, `react-pdf`
- Consumed by: `pages/WorkspacePage`, `pages/RunDashboardPage`, `pages/InterruptPage`

## Patterns
- Panel registration: DockviewLayout has a `components` map keyed by string IDs (e.g., `'agent-editor'`, `'run-panel'`). LayoutContext's `openTab()` uses these IDs.
- `flowVersion` key pattern: AgentEditorPanel and SkillEditorPanel include `state.flowVersion` in their React `key` to force remount when flow is replaced (e.g., git reset/pull).
- Slash command editors: Both `AgentEditor` and `SkillEditorContent` use slash command CodeMirror editors with chip decorations for skills, agents, and artifacts. Chip click handlers navigate to the referenced entity via LayoutContext.

## Downlinks
- [workspace/CLAUDE.md](workspace/CLAUDE.md) — IDE workspace panels and dockview layout
- [run-dashboard/CLAUDE.md](run-dashboard/CLAUDE.md) — standalone run observability UI
- [shared/CLAUDE.md](shared/CLAUDE.md) — cross-cutting shared components (interrupt forms, schema forms, viewers)
