# @forgeflow/ui

## Purpose
React 19 IDE for designing, running, and observing agent workflows. Does NOT execute flows or validate/compile them directly -- all backend logic is accessed via the server API.

## Entry Points
- `main.tsx` -- BrowserRouter + `<App>`, calls `initTooltip()` globally at startup
- `App.tsx` -- route definitions, wraps everything in `ProjectStoreProvider`; heavy pages are `lazy()` loaded

## Contracts & Invariants
- The UI NEVER imports from `@forgeflow/*` packages except `@forgeflow/types` -- all parser/validator/compiler/engine logic is behind server API calls
- All API calls go through `lib/api-client.ts` (`api.*`) -- never use raw `fetch` to the server
- State is managed entirely via `useReducer` contexts -- there is NO external state library (no Redux, Zustand, etc.)
- FlowReducer's `dirty` flag is the single source of truth for unsaved changes; `MARK_CLEAN` is dispatched only after a successful server save via `useSyncFlow`
- `SET_FLOW` resets `dirty` to `false` and increments `flowVersion` -- use `flowVersion` as a React key to force panel remounts when the entire flow is replaced (e.g., copilot mutation, git checkout)
- Every context hook (`useFlow`, `useRun`, `useLayout`, etc.) throws if called outside its Provider -- never render a consumer above its Provider

## Anti-Patterns
- Do NOT import from `@forgeflow/parser`, `@forgeflow/validator`, `@forgeflow/compiler`, or `@forgeflow/engine` -- these are server-side only
- Do NOT call `dispatch({ type: 'MARK_CLEAN' })` anywhere except inside `useSyncFlow` -- double-marking clean can lose unsaved edits
- Do NOT create new EventSource connections outside `RunContext` or `CopilotContext` -- SSE lifecycle (reconnect, replay, cleanup) is managed centrally
- Do NOT add state libraries -- the reducer+context pattern is intentional for this project's scale
- Do NOT use `window.history.replaceState` for navigation except the wizard-to-run URL update in RunDashboardPage (it avoids remounting the RunProvider)

## Dependencies
- Consumes: `@forgeflow/types` (type imports only), server API at `localhost:3001`
- Consumed by: `@forgeflow/desktop` (Electron wrapper)

## Patterns
- **Provider nesting in WorkspacePage**: `FlowProvider > DagProvider > LayoutProvider > RunProvider > CopilotProvider > GitProvider`. Order matters -- inner providers may consume outer ones.
- **Dockview tab management**: `LayoutContext.openTab()` creates or focuses panels by id; tab types map to component names via `COMPONENT_MAP`
- **SSE reconnect**: both `RunContext` and `CopilotContext` use exponential backoff (1s, 2s, 4s...) with event skip counters for replay dedup. Max 5 reconnect attempts before checking server state.
- **Auto-save debounce**: `useSyncFlow` waits 800ms after the last dirty change, then saves and marks clean. Status indicator cycles: idle -> saving -> saved -> idle.
- **Auto-edges**: `useAutoEdges` hook watches artifact I/O declarations in node configs and auto-creates/removes DAG edges. These edges have `auto: true` and `REMOVE_AUTO_EDGE` only removes auto edges.
- **Resize panels**: `useResize` hook in WorkspacePage handles sidebar, DAG, AI panel, and git panel widths/heights with pointer capture.
- **Vite proxy**: `/api` routes proxy to `localhost:3001` in dev mode, so the UI can use relative paths or `VITE_API_URL`.

## Downlinks
- `src/context/CLAUDE.md` -- React context providers and reducers (state management layer)
- `src/components/CLAUDE.md` -- UI components (workspace panels, run dashboard, shared primitives)
- `src/lib/CLAUDE.md` -- Pure utility functions and the API client
- `src/pages/CLAUDE.md` -- Route-level page components
