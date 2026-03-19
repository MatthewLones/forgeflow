# ForgeFlow

## Purpose
Open-source IDE + runtime for AI agent workflows. Repo dir is `flowforge` on disk (renamed to ForgeFlow in Phase 2). Does NOT include cloud deployment or multi-user collaboration yet.

## Build & Dev
- `pnpm install` then `pnpm build` to bootstrap (build order matters — see `packages/CLAUDE.md`)
- `pnpm dev` — runs server (port 3001) + UI (Vite, port 5173) concurrently
- `pnpm test` — vitest across all packages (~234 tests)
- `pnpm dev:desktop` — Electron app with embedded UI
- API key: `packages/server/.env` or `~/.forgeflow/.env` (gitignored)
- Data lives at `~/.forgeflow/` (projects, runs, workspaces)
- To re-seed example project: delete `~/.forgeflow/projects/` and restart server

## Three Primitives
- **Skills** = reusable domain knowledge (SKILL.md + references/ + scripts/). Standalone, composable.
- **Nodes** = units of work. Agent nodes run Claude in a sandbox. Checkpoint nodes pause with zero cost.
- **Flows** = DAGs of nodes defined in FLOW.json. Engine executes phase-by-phase.

Skills are NOT children. Children are inline sub-agent work units declared inside a parent node. This distinction is fundamental.

## Per-Phase Execution Model
Each node runs in a fresh sandbox (Docker container). The engine orchestrates BETWEEN phases; Claude orchestrates WITHIN a phase. State serializes through the filesystem between every phase — clean context windows and fault isolation.

## Global Invariants
- `@forgeflow/types` is zero-runtime, pure TypeScript declarations. NEVER add functions, classes, or values there (sole exception: `artifactName()` utility).
- `FlowGraph` (built by `buildFlowGraph()` in the validator) is the single source of truth for all semantic analysis. Validator, compiler, and engine all consume it. Never duplicate graph traversal logic.
- FlowNode.children is recursive — children can nest indefinitely.
- `ArtifactRef = string | ArtifactSchema` — config.inputs/outputs accept both forms. Use `artifactName()` to normalize.

## Tech Stack
- pnpm workspace monorepo, 11 packages at `packages/*`
- TypeScript + tsup (ESM only) + vitest
- Do NOT use `composite: true` in tsconfig — breaks tsup DTS generation

## Intent Layer
This repo uses a hierarchical CLAUDE.md system (Intent Layer). Each CLAUDE.md covers its directory and all subdirectories. When you enter any directory, all ancestor CLAUDE.md files auto-load, giving you a T-shaped context view. On `git push`, a hook identifies which nodes may need updating.

## Downlinks
- [packages/CLAUDE.md](packages/CLAUDE.md) — package dependency DAG, build order, cross-cutting contracts
- [docs/CLAUDE.md](docs/CLAUDE.md) — documentation map
