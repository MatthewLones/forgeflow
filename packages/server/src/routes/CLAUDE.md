# Server Routes

## Purpose
9 Express Router files that define all REST and SSE endpoints. Routes are thin handlers — they validate request params, delegate to services, and format responses. Do NOT contain business logic.

## Entry Points
- `health.ts` — `GET /health` (version + status)
- `projects.ts` — CRUD for projects + flow save/load + .forge export/import
- `skills.ts` — CRUD for skills within a project
- `flows.ts` — validation, compile preview, required-inputs query
- `runs.ts` — start/stop/resume/retry runs, SSE progress, output serving, workspace browsing
- `references.ts` — file upload/download/rename/delete for project reference files
- `copilot.ts` — AI copilot messaging, SSE streaming, chat CRUD, question answering
- `git.ts` — per-project git operations (init, stage, commit, branch, push/pull, reset)
- `github.ts` — GitHub OAuth flow, repo listing/creation, remote linking

## Contracts & Invariants
- Every route file exports `default` as a Router — mounted at `/api` by index.ts
- Route handlers MUST return early on validation errors (400) BEFORE calling service methods
- All async handlers wrap their body in try/catch and return 500 with `{ error: string }` on failure
- SSE endpoints (`/runs/:runId/progress`, `/copilot/:sessionId/progress`) MUST send `:ok\n\n` initial keepalive
- SSE endpoints MUST call `unsubscribe()` on `req.on('close')` to prevent memory leaks
- The `runs.ts` POST `/projects/:id/run` endpoint validates the flow BEFORE starting execution — invalid flows are rejected with 400
- `projects.ts` calls `ensureSeeded()` on GET list and GET single — ensures default project exists on first access
- File uploads use multer `memoryStorage()` — files are Buffers in memory, not written to temp disk

## Anti-Patterns
- Do NOT put business logic in route handlers — delegate to ProjectStore, RunManager, or CopilotManager
- Do NOT create multiple multer instances with different configs in the same file — define one per file
- Do NOT use `res.json()` after `res.writeHead()` in SSE endpoints — use `res.write()` with SSE format

## Dependencies
- Consumes: `../services/project-store.js`, `../services/run-manager.js`, `../services/copilot-manager.js`, `../services/git-manager.js`, `../services/github-service.js`
- Consumed by: `../index.ts` (mounts all routers)

## Patterns
- Each route file instantiates its own service instances at module level (ProjectStore is per-file, RunManager/CopilotManager are imported singletons)
- Resume endpoint accepts both multi-file `{ files: [...] }` and legacy single-file `{ fileName, content }` formats — checkpoint content is base64-encoded in the request body
- `runs.ts` workspace file serving uses `mime-types` lookup for Content-Type and path traversal prevention via `path.resolve()` comparison
- `copilot.ts` uses `projectId` as the route param for message/history/chats but `sessionId` for progress/stop/reset/answer — these are different identifiers
- API key resolution: `req.body.apiKey || process.env.ANTHROPIC_API_KEY` — request-level key takes precedence
- GitHub OAuth: auth URL derives callback origin from the `Referer` header, falling back to `localhost:5173`
