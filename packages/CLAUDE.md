# Packages

## Purpose
11-package pnpm workspace monorepo. This node covers the dependency DAG, build order, and cross-cutting contracts that span multiple packages.

## Package Dependency DAG
```
types (leaf — zero runtime)
  ├→ parser (Zod validation)
  ├→ validator (FlowGraph + 11 rules)
  ├→ compiler (IR pipeline)
  ├→ state-store (persistence)
  └→ skill-resolver (skill loading)
        ↓
      engine (orchestrator + runners)
        ├→ cli (headless execution)
        └→ server (Express API + SSE)
              ├→ ui (React IDE)
              └→ desktop (Electron wrapper)
```

## Build Order
- Always build `types` first — everything depends on it
- Build `validator` and `compiler` before running engine tests (`pnpm --filter @forgeflow/compiler build` needed because engine imports via package name, resolving to dist/)
- `pnpm build` (root) builds in dependency order via `-r` flag

## Cross-Package Conventions
- Package naming: npm scope `@forgeflow/*`, workspace protocol `workspace:*`
- All packages use: `tsup src/index.ts --format esm --dts`
- Tests live in `__tests__/` directories alongside `src/`
- Cross-package test imports use relative paths (e.g., `../../parser/src/parser.js`)

## Cross-Cutting Contracts

**FlowGraph is the single source of truth.** Built once by `buildFlowGraph()` in the validator, consumed by validator rules, compiler pipeline, engine orchestrator, and server. Never rebuild or duplicate its traversal logic.

**Interrupt lifecycle spans 3 packages:**
1. Engine: `InterruptWatcher` detects `__INTERRUPT__` file in workspace → calls handler → handler returns answer → writes `__ANSWER__` file
2. Server: `RunManager` bridges engine handler to SSE — stores a Promise, emits interrupt event to SSE clients, `POST /interrupt-answer` resolves the Promise
3. UI: `RunContext` receives SSE interrupt event → dispatches to state → `InterruptFormRouter` renders the appropriate form

**SSE event replay on reconnect:** Server stores all events in NDJSON. When a client reconnects to `/runs/:runId/progress`, it replays all past events before streaming new ones. UI `RunContext` handles deduplication.

**ProgressEvent is a cross-cutting type.** Adding a new event type requires updates in engine (emitter), server (SSE relay + NDJSON persistence), and UI (RunContext reducer + EventStream display).

**DockerAgentRunner must be lazy-imported.** It pulls in dockerode/ssh2 native modules that crash Electron due to NODE_MODULE_VERSION mismatch. Engine, server, and desktop all use dynamic `import()` for it.

**Child wave ordering:** Children with sibling dependencies are auto-grouped into waves via topo sort. Wave 0 = no deps, wave N = depends on wave N-1. This is computed in the validator's FlowGraph and consumed by the compiler for prompt generation.

## Downlinks
- [types/CLAUDE.md](types/CLAUDE.md) — zero-runtime type declarations
- [parser/CLAUDE.md](parser/CLAUDE.md) — Zod schema validation
- [validator/CLAUDE.md](validator/CLAUDE.md) — 11-rule validation pipeline
- [compiler/CLAUDE.md](compiler/CLAUDE.md) — staged IR pipeline
- [state-store/CLAUDE.md](state-store/CLAUDE.md) — state persistence interface
- [engine/CLAUDE.md](engine/CLAUDE.md) — orchestrator + runners
- [skill-resolver/CLAUDE.md](skill-resolver/CLAUDE.md) — skill loading
- [cli/CLAUDE.md](cli/CLAUDE.md) — CLI commands
- [server/CLAUDE.md](server/CLAUDE.md) — Express API + SSE
- [ui/CLAUDE.md](ui/CLAUDE.md) — React IDE
- [desktop/CLAUDE.md](desktop/CLAUDE.md) — Electron wrapper
