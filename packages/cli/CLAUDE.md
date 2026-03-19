# @forgeflow/cli

## Purpose
Owns the headless CLI for running and resuming flows from the terminal. Does NOT own orchestration logic, runner implementations, or state management (all delegated to `@forgeflow/engine` and `@forgeflow/state-store`).

## Entry Points
- `forgeflow run <flow-dir> [options]` — parse FLOW.json, load uploads, execute flow end-to-end
- `forgeflow resume <flow-dir> <run-id> --input <file> [options]` — resume a paused checkpoint run
- `createCliInterruptHandler()` — stdin-based interactive interrupt handler for all 5 interrupt types
- `createRunner(options)` — factory that returns MockRunner, ClaudeAgentRunner, or DockerAgentRunner based on `--mock`/`--local`/`--docker` flag
- `formatProgressEvent(event)` — converts ProgressEvent to human-readable console line

## Contracts & Invariants
- Default runner is `docker` (not mock, not local). The `--mock` flag is for testing without API calls.
- `resume` requires exactly two positional args (`<flow-dir>` and `<run-id>`) plus at least one `--input` flag. Missing any of these is a hard error.
- `run` exits with code 0 for both `completed` and `awaiting_input` statuses (both are `success: true`). Only failures exit with code 1.
- Skill search paths always start with `<flow-dir>/skills/` (flow-relative skills take priority), followed by any `--skills` dirs.
- State store path is always `~/.forgeflow/runs/` (uses `$HOME` or `$USERPROFILE` or `/tmp` fallback).
- The CLI interrupt handler creates a new `readline` interface per prompt call and closes it immediately after. This is intentional to avoid blocking the event loop between interrupts.
- `formatProgressEvent()` truncates message content to 200 chars for console readability.

## Anti-Patterns
- Do NOT add subcommands beyond `run` and `resume` without updating the help text in `index.ts`. The CLI uses raw `process.argv` parsing, not a framework.
- Do NOT use a persistent readline interface for interrupt handling. Each prompt creates and destroys its own `rl` instance to avoid stdin lifecycle issues.
- Do NOT forget to build the CLI before running integration tests: they invoke `dist/index.js` via `execFileSync('node', [CLI_PATH, ...])`.

## Dependencies
- Consumes: `@forgeflow/parser` (parseFlowJSON), `@forgeflow/state-store` (LocalStateStore), `@forgeflow/engine` (FlowOrchestrator, MockRunner, ClaudeAgentRunner, InterruptWatcher types), `@forgeflow/engine/docker` (DockerAgentRunner), `@forgeflow/types`
- Consumed by: end users via `npx forgeflow` or direct invocation

## Patterns
- **Thin wrapper**: The CLI contains zero orchestration logic. It parses args, wires up the engine, prints progress, and exits. All complexity lives in `@forgeflow/engine`.
- **Manual arg parsing**: No commander/yargs dependency. Positional args + `--flag value` pairs parsed in a while loop. `--input` and `--skills` are repeatable.
- **Resume shows next checkpoint**: After a `resume` returns `awaiting_input` (hit another checkpoint), the CLI loads the new checkpoint and prints the expected files with a ready-to-copy resume command.
- **Integration tests require dist build**: `cli.test.ts` spawns `node dist/index.js` as a child process. Tests will fail if the CLI hasn't been built first.
