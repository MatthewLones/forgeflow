# @forgeflow/engine

## Purpose
Owns flow execution orchestration, workspace lifecycle, interrupt handling, and agent runner abstraction. Does NOT own flow validation, compilation, state persistence, or skill resolution (delegates to upstream packages).

## Entry Points
- `FlowOrchestrator` — executes flows end-to-end, resumes from checkpoints, retries from failures
- `InterruptWatcher` — watches workspace `output/` for signal files via chokidar, bridges interrupts to handler
- `prepareWorkspace()` / `collectOutputs()` / `cleanupWorkspace()` — per-phase workspace lifecycle
- `MockRunner` / `ClaudeAgentRunner` — AgentRunner implementations (DockerAgentRunner is a separate export)
- `extractVerboseEvents()` — converts Agent SDK messages to ProgressEvent stream

## Contracts & Invariants
- `execute()`, `resume()`, and `retryFromFailure()` all funnel into the private `executePhases()` method. Any new entry path MUST use `executePhases()` to avoid duplicating the phase loop.
- Checkpoint nodes (`type: 'checkpoint'`) never invoke the runner. They save state and return `awaiting_input` immediately. No LLM execution, no workspace cleanup.
- `resume()` requires `runState.status === 'awaiting_input'`. It re-validates the flow to regenerate the execution plan, then starts from `checkpointIndex + 1`.
- `retryFromFailure()` requires `runState.status === 'failed'`. It re-executes from the failed phase (or after the last completed phase as fallback).
- InterruptWatcher processes interrupts sequentially (queue + `draining` flag). Max concurrent handler calls is always 1.
- Auto-escalation only applies to `mode: 'inline'` interrupts. Checkpoint-mode interrupts are never escalated regardless of timeout settings.
- After escalation, the orchestrator saves partial outputs, creates a synthetic checkpoint, and returns `awaiting_input`.
- `collectOutputs()` recursively traverses `output/` but skips all signal file prefixes: `__INTERRUPT__`, `__ANSWER__`, `__CHILD_START__`, `__CHILD_DONE__`, `__PROGRESS__`.
- Output validation is advisory (warns on missing expected outputs but does not fail the phase).
- `validateOutputs()` does fuzzy matching: `"company_profile"` matches `"company_profile.json"` via base-name stripping.
- Failed phases still save partial outputs (best-effort) and include the failed phase's cost in totals.

## Anti-Patterns
- Do NOT import `DockerAgentRunner` from the barrel export (`@forgeflow/engine`). It pulls in dockerode/ssh2 native modules. Import from `@forgeflow/engine/docker` instead.
- Do NOT duplicate the phase loop outside `executePhases()`. All three public methods (execute/resume/retryFromFailure) share it for a reason.
- Do NOT call `buildFlowGraph()` before entering `executePhases()`. It is called once inside `executePhases()` and must not be called redundantly.
- Do NOT assume InterruptWatcher handles interrupts concurrently. The sequential queue is load-bearing for correctness.
- Do NOT run engine tests without first building the compiler: `pnpm --filter @forgeflow/compiler build`. Engine imports compiler via package name which resolves to dist/.

## Dependencies
- Consumes: `@forgeflow/types`, `@forgeflow/validator` (validateFlow, buildFlowGraph), `@forgeflow/compiler` (compilePhase, compileChildPrompts, FORGEFLOW_PHASE_SYSTEM_PROMPT), `@forgeflow/state-store` (StateStore interface), `@forgeflow/skill-resolver` (resolveSkills), `chokidar`, `@anthropic-ai/claude-agent-sdk` (lazy-imported in ClaudeAgentRunner), `dockerode` (only in DockerAgentRunner)
- Consumed by: `@forgeflow/cli`, `@forgeflow/server`

## Patterns
- **Lazy SDK import**: `ClaudeAgentRunner.attemptPhase()` does `await import('@anthropic-ai/claude-agent-sdk')` to avoid loading the SDK unless actually used.
- **Rate limit retry**: ClaudeAgentRunner retries up to 5 times on 429/529 errors with exponential backoff (10s base, 60s cap, 20% jitter).
- **Agent SDK permissions**: `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` + `persistSession: false`. This is intentional for sandboxed execution.
- **Docker workspace**: DockerAgentRunner writes `.forgeflow-prompt.md` and `.forgeflow-config.json` to the workspace, then mounts it at `/workspace` inside the container. The entrypoint reads these files.
- **Verbose events**: `extractVerboseEvents()` tracks a `SequenceRef` (monotonic counter per phase) and a `toolNameMap` (toolUseId to toolName) to correlate tool_call/tool_result pairs. Text and input are truncated at 2000 chars.
- **External run ID**: `execute()` accepts an optional `externalRunId` parameter used by RunManager to avoid race conditions between run creation and SSE subscription.
- **Workspace layout**: `{base}/{runId}/{phaseId}/` with subdirs `input/`, `output/`, `skills/`, and optionally `prompts/` for child prompt files.
