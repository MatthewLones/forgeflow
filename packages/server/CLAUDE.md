# @forgeflow/server

## Purpose
Express 5 API server that bridges the UI to the engine, compiler, and validator packages via REST + SSE. Does NOT own business logic for validation, compilation, or orchestration — delegates to upstream packages.

## Entry Points
- `createApp()` — builds the Express app with all routes mounted at `/api`
- `startServer(port?)` — starts listening (default 3001), launches WorkspaceCleaner
- `runManager` (singleton) — manages active runs, SSE streaming, interrupt bridging
- `copilotManager` (singleton) — manages AI copilot sessions with Agent SDK

## Contracts & Invariants
- All routes are mounted under `/api` prefix — no route handler should include `/api` in its own path
- `runId` is generated BEFORE execution starts and the ActiveRun is registered in the map BEFORE `orchestrator.execute()` fires — this prevents a race where fast mock runs complete before the map entry exists
- SSE replays ALL past events on reconnect, then streams new ones — clients must handle deduplication
- The interrupt bridge is a stored Promise: engine handler creates it, SSE emits the interrupt event, `POST /interrupt-answer` resolves it. Do NOT broadcast interrupts from the handler — InterruptWatcher already emits via onProgress
- `.env` loading order: cwd first (dev), then `~/.forgeflow/.env` (packaged Electron). The dotenv import MUST come before any module that reads `process.env.ANTHROPIC_API_KEY`
- JSON body limit is 50MB — required for large flow definitions and skill content
- ProjectStore is instantiated per-route-file (not singleton), but all instances share the same filesystem path (`~/.forgeflow/projects/`)
- RunManager and CopilotManager are true singletons (module-level `export const`)

## Anti-Patterns
- Do NOT use Express 5 wildcard `*path` params as strings — they return arrays. Always use `Array.isArray(segments) ? segments.join('/') : segments`
- Do NOT `await` the orchestrator execution in `startRun()` — it runs in background via `.then()/.catch()` chains
- Do NOT broadcast interrupt events from the interruptHandler callback — InterruptWatcher already emits them via onProgress, double-broadcasting causes duplicate UI renders
- Do NOT import `DockerAgentRunner` at top level — use dynamic `import('@forgeflow/engine/docker')` inside `createRunner()` (see packages/CLAUDE.md cross-cutting contracts)

## Dependencies
- Consumes: `@forgeflow/types`, `@forgeflow/validator`, `@forgeflow/compiler`, `@forgeflow/engine`, `@forgeflow/state-store`, `@anthropic-ai/claude-agent-sdk`
- Consumed by: `@forgeflow/ui`, `@forgeflow/desktop`

## Patterns
- Route files each export a `Router()`, mounted at `/api` in index.ts — 9 route files total
- SSE connections: `writeHead(200, ...)` + `:ok\n\n` keepalive + event replay + `req.on('close')` unsubscribe
- Events persisted as NDJSON (`events.ndjson` per run, `{chatId}.ndjson` per copilot chat)
- Orphaned run cleanup: on startup, RunManager marks any `running`/`awaiting_input` runs as `failed`
- WorkspaceCleaner: configurable TTL via `WORKSPACE_TTL_HOURS` env var (default 24h), runs hourly
- Seeds default project on first access via `store.seedIfEmpty()` in the projects route

## Downlinks
- `src/routes/CLAUDE.md` — REST route handlers and SSE endpoints
- `src/services/CLAUDE.md` — ProjectStore, RunManager, CopilotManager, GitManager, GitHubService
