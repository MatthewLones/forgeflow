# UI Pages

## Purpose
Owns route-level page components that are the top-level React components rendered per URL. Does NOT own reusable UI components (those live in `components/`) or state management (that lives in `context/`).

## Entry Points
- `DashboardPage` -- `/` route, project list with create/delete/import
- `WorkspacePage` -- `/workspace/:id`, the full IDE; loads project data on mount, wraps content in 6 nested context providers
- `RunDashboardPage` -- `/projects/:projectId/runs/:runId`, run observability with DAG, event stream, workspace explorer
- `InterruptPage` -- `.../runs/:runId/interrupts`, renders pending interrupt form + answered interrupt history
- `CheckpointPage` -- `.../runs/:runId/checkpoint`, renders pending checkpoint form + checkpoint history
- `RunListPage` -- `/projects/:projectId/runs`, lists all runs for a project
- `GitHubCallbackPage` -- `/github/callback`, handles OAuth code exchange

## Contracts & Invariants
- All pages except `DashboardPage` are lazy-loaded via `React.lazy()` in `App.tsx` and wrapped in `<Suspense>`
- `WorkspacePage` is the only page that mounts `FlowProvider`, `DagProvider`, `LayoutProvider`, `RunProvider`, `CopilotProvider`, and `GitProvider`. These providers MUST NOT be mounted elsewhere for workspace functionality.
- `RunDashboardPage`, `InterruptPage`, and `CheckpointPage` share a single `RunProvider` via `RunLayout` (an `<Outlet>` wrapper). They do NOT create their own RunProvider.
- Every page that depends on a URL param (`useParams`) handles the missing-param case (renders null or redirects)
- Pages load data on mount with loading spinners and handle errors with inline error banners -- no global error boundary except the workspace and run dashboard error boundaries

## Anti-Patterns
- Do NOT mount workspace-scoped providers (FlowProvider, DagProvider, etc.) in any page besides WorkspacePage -- they rely on its initialization flow
- Do NOT navigate between run sub-pages (dashboard/interrupts/checkpoint) with `navigate()` to full paths -- use relative paths (e.g., `navigate('interrupts')`) since they are nested routes under `RunLayout`
- Do NOT auto-redirect to summary on run completion -- RunDashboardPage intentionally lets the user click "View Summary" to avoid hiding the event stream prematurely
- Do NOT call `startRun` before validating the flow -- `handleRunInWorkspace` validates first and shows errors if invalid

## Dependencies
- Consumes: `context/*` (all providers), `lib/api-client.ts`, `components/*` (UI building blocks), `hooks/*` (useSyncFlow, useAutoEdges, useKeyboardShortcuts)
- Consumed by: `App.tsx` route definitions

## Patterns
- **WorkspacePage initialization sequence**: `loadProject(id)` -> `loadSkills(id)` + `loadReferences(id)` in parallel -> compute ELK positions (async, uses saved `flow.layout` if available) -> mount `FlowProvider` with flow + positions -> render `WorkspaceContent`
- **Run wizard URL dance**: When `runId === 'new'`, RunDashboardPage renders `InputWizard`. After `startRun` resolves, it uses `window.history.replaceState` to update the URL to the real runId without remounting (avoids losing the RunProvider and SSE connection).
- **Copilot flow reload**: `handleFlowChanged` callback in WorkspacePage reloads the flow from server, recomputes layout positions, clears skill cache, and dispatches `SET_FLOW`. This is passed to both `CopilotProvider.onFlowChanged` and `GitProvider.onFlowChanged`.
- **Keyboard shortcuts**: WorkspacePage defines ~30 bindings, applies localStorage remaps, and registers them via `useKeyboardShortcuts`. All shortcut handlers are stable refs or memoized callbacks to avoid re-registration.
- **Error boundaries**: WorkspacePage and RunLayout each have their own class-based error boundaries wrapping their content, providing reload/retry buttons.
