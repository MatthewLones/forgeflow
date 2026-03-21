# Server Services

## Purpose
5 service modules that own state management, execution orchestration, AI copilot sessions, and git integration. Routes delegate all business logic here. Does NOT own validation or compilation logic — delegates to upstream packages.

## Entry Points
- `ProjectStore` — filesystem CRUD at `~/.forgeflow/projects/{id}/`
- `RunManager` (singleton via `export const runManager`) — active run lifecycle, SSE broadcast, interrupt bridge
- `CopilotManager` (singleton via `export const copilotManager`) — Agent SDK sessions, MCP tool server, chat persistence
- `GitManager` — per-project git operations via `simple-git`
- `GitHubService` — GitHub OAuth + Octokit API wrapper
- `WorkspaceCleaner` — TTL-based cleanup of `~/.forgeflow/workspaces/`
- `copilot-tools.ts` — MCP tool definitions + system prompt for the copilot

## Contracts & Invariants
- ProjectStore stores FLOW.json as a "graph shell" (edges, skills, budget, nodes=[]) with individual node files in `nodes/{nodeId}.json` — `getFlow()` reassembles them. Old-format FLOW.json with inline nodes is handled transparently
- RunManager generates `runId` via `crypto.randomUUID()` and registers the ActiveRun in the map BEFORE calling `orchestrator.execute()` — this is a critical ordering constraint
- RunManager persists every ProgressEvent to `{runsBasePath}/{runId}/events.ndjson` synchronously via `appendFileSync`
- CopilotManager maintains one session per project (`projectSessions` map). Calling `sendMessage()` while `activeQuery=true` throws
- CopilotManager uses `persistSession: true` + `continue: true` on follow-up queries to maintain conversation context across messages
- GitManager uses a per-project mutex (`GitMutex`) to prevent concurrent git operations — avoids `index.lock` errors
- GitHubService stores OAuth token at `~/.forgeflow/github-token.json` — cached in memory after first load
- `MUTATING_TOOLS` set in copilot-tools.ts determines which tool calls trigger `copilot_flow_changed` SSE events

## Anti-Patterns
- Do NOT instantiate RunManager or CopilotManager outside their module — use the exported singletons
- Do NOT read orphaned run state files and assume they're resumable — RunManager marks them `failed` on startup via `cleanupOrphanedRuns()`
- Do NOT call `broadcastEvent` from the interruptHandler — the engine's InterruptWatcher emits interrupt events via onProgress which already calls broadcastEvent
- Do NOT persist streaming token deltas (`copilot_text` with `persist=false`) — they're ephemeral SSE-only; the consolidated text block is persisted when the full assistant message arrives
- Do NOT access `this.runs.get(runId)` from inside the interruptHandler closure without checking for undefined — the run may have been stopped
- Do NOT use `ProjectStore.saveFlow()` and expect `FLOW.json` to contain nodes — it writes a shell with `nodes: []` and individual `nodes/*.json` files

## Dependencies
- Consumes: `@forgeflow/types`, `@forgeflow/engine` (FlowOrchestrator, MockRunner, ClaudeAgentRunner), `@forgeflow/state-store` (LocalStateStore), `@forgeflow/validator`, `@forgeflow/compiler`, `@anthropic-ai/claude-agent-sdk`, `simple-git`, `@octokit/rest`
- Consumed by: `../routes/*`

## Patterns
- SSE broadcast: `event: {type}\ndata: {json}\n\n` format, with `event: done` + `res.end()` on completion
- CopilotManager emits events with `persist` flag — token-level deltas are SSE-only (`persist=false`), full text blocks and tool calls are persisted (`persist=true`)
- CopilotManager migrates legacy `copilot-events.ndjson` to `copilot-chats/{chatId}.ndjson` on first access per project
- copilot-tools.ts `onFlowMutated` callback fires immediately when a mutating tool writes to disk — bypasses stream parsing which may not reliably detect tool results
- Copilot system prompt (`FORGE_COPILOT_SYSTEM_PROMPT`) lives in copilot-tools.ts, not in the manager — it's ~340 lines of domain knowledge
- GitManager auto-initializes repos with a `.gitignore` (ignores `references/`, `copilot-chats/`) and an initial commit
- ProjectStore `isPathSafe()` guards all reference file operations against directory traversal
- RunManager `readWorkspaceFile()` independently guards against directory traversal via `path.resolve()` comparison
- ProjectStore `getProjectSkillsSummaries()` extracts sub-skill references from SKILL.md via `/skill:NAME` pattern (single slash, matching the UI chip syntax). Returns `subSkills: string[]` in each `SkillSummary`.
