# UI Context Providers

## Purpose
Owns all React context providers and reducers that form the UI state management layer. Does NOT own API calls directly (delegates to `lib/api-client.ts`), does NOT own component rendering.

## Entry Points
- `useProjectStore()` -- global project/skill/reference CRUD, mounted at App root
- `useFlow()` -- flow editing state (nodes, edges, artifacts, dirty flag), mounted per workspace
- `useRun()` -- run execution state + SSE lifecycle, mounted per workspace and per run route
- `useLayout()` -- dockview tab management, mounted per workspace
- `useDag()` -- DAG canvas breadcrumb/collapse state, mounted per workspace
- `useCopilot()` -- AI copilot chat state + SSE streaming, mounted per workspace
- `useSkill()` -- skill file editor state, mounted per skill editor panel
- `useGit()` -- git operations + GitHub integration, mounted per workspace

## Contracts & Invariants
- Every `use*()` hook throws if called outside its Provider -- there are no fallback defaults
- `ProjectStoreProvider` wraps the entire app; all other providers are scoped to WorkspacePage or RunLayout
- FlowReducer: every action except `SELECT_NODE` and `MARK_CLEAN` sets `dirty: true`; `SET_FLOW` sets `dirty: false` and bumps `flowVersion`
- FlowReducer searches recursively into `node.children` for `UPDATE_NODE`, `UPDATE_NODE_CONFIG`, `REMOVE_NODE`, and `ADD_CHILD` -- node IDs are globally unique across all nesting levels
- RunContext: `subscribeSSE` takes a `skipEvents` count for reconnect replay dedup -- the server replays all past events, and the client skips the ones it already processed
- CopilotContext: `replayEvents()` is a pure function that reconstructs message history from NDJSON ProgressEvents -- used both on mount (loading persisted history) and when switching chats
- SkillContext: `SKILL.md` cannot be deleted or renamed (enforced in reducer)

## Anti-Patterns
- Do NOT dispatch `MARK_CLEAN` outside `useSyncFlow` -- it signals the server save succeeded
- Do NOT create additional `useReducer` instances for flow state -- FlowReducer is the single owner
- Do NOT subscribe to SSE events outside `RunContext` or `CopilotContext` -- they manage cleanup, reconnect, and event counting
- Do NOT read `state.flow` from FlowContext to make API calls directly -- use `useSyncFlow` for saves, `api.*` for everything else
- Do NOT store derived data in context state -- compute it in `useMemo` at the consumer level (e.g., `interruptHistory`, `checkpointHistory`, `pendingCheckpoint` are derived in RunContext via `useMemo`)

## Dependencies
- Consumes: `@forgeflow/types` (type imports), `lib/api-client.ts` (ProjectStore, RunContext, CopilotContext, GitContext)
- Consumed by: all pages and components in the UI package

## Patterns
- **Optimistic local state + async server sync**: `ProjectStore.updateFlow()` updates in-memory state immediately; `useSyncFlow` debounces the server save. `updateSkillCache()` similarly allows local edits without a round-trip.
- **SSE event counting for reconnect**: both `RunContext` and `CopilotContext` track `eventCountRef` -- on reconnect, they pass the count to `subscribeSSE(runId, skipEvents)` so the server can replay all events while the client skips already-processed ones.
- **Provider nesting order**: `FlowProvider` (needs flow data) > `DagProvider` (no deps) > `LayoutProvider` (no deps) > `RunProvider` (no deps) > `CopilotProvider` (needs projectId + onFlowChanged) > `GitProvider` (needs projectId + onFlowChanged). `CopilotProvider` and `GitProvider` both receive `onFlowChanged` to reload the flow after external mutations.
- **FlowReducer artifact cascading**: `REMOVE_ARTIFACT` and `REMOVE_ARTIFACT_FOLDER` recursively clean up all node input/output references. `RENAME_ARTIFACT` and `RENAME_ARTIFACT_FOLDER` recursively update references via `renameArtifactRefsInNodes`.
- **Budget cap detection**: CopilotContext checks if `totalCostUsd >= MAX_BUDGET_USD * 0.95` on `copilot_completed` and appends a user-facing budget message.
