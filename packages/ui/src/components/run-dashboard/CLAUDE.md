# Run Dashboard Components

## Purpose
Standalone run observability UI rendered at `/projects/:id/runs/:runId`. Provides live SSE event streaming, DAG status visualization, workspace file exploration, and post-run summaries. Does NOT handle interrupt form rendering (delegates to `../shared/InterruptFormRouter`).

## Entry Points
- `DashboardDAG` — React Flow canvas with node status highlighting (running/completed/failed/awaiting_input)
- `EventStream` — live SSE event feed with verbosity filtering (compact/standard/verbose) and auto-scroll
- `RunSummary` — post-run report with phases, artifacts, tasks, workspace files, and embedded event timeline
- `DashboardToolbar` — status indicator, cost/turns display, stop/rerun/interrupt/checkpoint action buttons
- `InputWizard` — pre-run configuration: runner selection (mock/local/docker), model picker, file upload with drag-and-drop
- `PreviewDrawer` — right-side drawer for viewing workspace files and artifacts
- `NodePromptDrawer` — right-side drawer showing compiled prompt for a selected node
- `WorkspaceExplorer` — file tree for run workspace directories, polls every 3s while running

## Contracts & Invariants
- `DashboardDAG` reuses `AgentNode`/`CheckpointNode` from `../canvas/nodes/` and `FlowEdge` from `../canvas/edges/`. These are the same renderers as the workspace DAG. Node data gets a `runStatus` field injected for status coloring.
- `EventStream` verbosity levels filter by event type sets: compact (phase/run lifecycle), standard (+ files/children/costs), verbose (+ tool calls/text blocks, but hides `message` since `text_block` supersedes it). `rate_limited` events are always visible regardless of verbosity level.
- `RunSummary` fetches summary data via `api.runs.getSummary()` — it calls the API directly, not through a context. This is intentional because the summary is fetched once and is not live-updating.
- `InputWizard` renames uploaded files to their artifact names before submission (e.g., user's `pitch.txt` becomes the file named `startup_materials`). JSON validation against schema fields is advisory only (warnings, not blocking).
- Drawers (`PreviewDrawer`, `NodePromptDrawer`) render with a backdrop overlay at z-40 and the drawer at z-50. Click on backdrop closes.

## Anti-Patterns
- Do NOT embed interrupt form logic in dashboard components — always delegate to `InterruptFormRouter` from `../shared/`.
- Do NOT poll for events — the parent page (`RunDashboardPage`) manages the SSE connection via `RunContext`. Dashboard components receive events as props.
- Do NOT add run control logic (start/stop/resume) to these components — that belongs in `RunContext`. Dashboard components only call context methods.

## Dependencies
- Consumes: `RunContext` (via `useRun()`), `api-client` (summary, workspace tree, file fetching)
- Consumes: `../canvas/nodes/AgentNode`, `../canvas/nodes/CheckpointNode`, `../canvas/edges/FlowEdge`
- Consumes: `../shared/ArtifactViewer`, `../shared/TodoWidget`
- Consumes: `@xyflow/react`, `marked`, `../../lib/flow-to-reactflow`, `../../lib/derive-phase-todos`
- Consumed by: `pages/RunDashboardPage`

## Patterns
- Auto-scroll with pin: EventStream tracks `pinToBottom` state. Scrolling up disables auto-scroll; scrolling back to bottom re-enables it. A `ResizeObserver` re-pins on panel resize.
- Elapsed timer: EventStream runs a 1-second interval timer from `startedAt`, freezes when `isDone` becomes true.
- Activity indicator: `ActivityIndicator` rotates forge-themed verbs ("Forging...", "Tempering...", "Quenching...") every 3 seconds with animated dots. Pure cosmetic, no semantic meaning.
- Node filtering: EventStream accepts a `nodeFilter` prop. Events with a `nodeId` field that doesn't match are hidden. A chip button in the toolbar clears the filter.
