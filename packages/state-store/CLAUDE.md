# State Store

## Purpose
Defines the `StateStore` persistence interface and provides `LocalStateStore`, a filesystem-backed implementation for run state, checkpoints, and artifacts. Does NOT own run orchestration logic or event streaming (those live in engine and server).

## Entry Points
- `StateStore` (interface) — the contract all implementations must satisfy
- `LocalStateStore(basePath)` — filesystem implementation rooted at `basePath/{runId}/`

## Contracts & Invariants
- **Artifacts use a flat namespace.** All phase outputs land in `artifacts/` regardless of which phase produced them. Later phases overwrite earlier files with the same name (last-write-wins).
- **Uploads and artifacts are separate directories** but `loadPhaseInputs` searches both: artifacts first, then uploads. Artifacts always take precedence over uploads with the same name.
- **Extension fallback is always applied.** When an exact filename match fails, `loadPhaseInputs` and `readArtifact` try appending common extensions (`.json`, `.md`, `.txt`, `.csv`, `.pdf`, `.png`, etc.) because agents frequently add extensions to bare artifact names. The returned `StateFile.name` is always the *declared* artifact name, not the resolved filename on disk.
- **Checkpoint migration.** `loadCheckpoint` auto-migrates the old `waitingForFile: string` format to the new `expectedFiles[]` array format. Code must not assume `expectedFiles` is always present in stored JSON.
- **Directories are created on demand.** Every write method calls `mkdir({ recursive: true })` — callers never need to pre-create directories.
- **Null means not found.** `loadRunState` and `loadCheckpoint` return `null` on missing files or parse errors, never throw.
- **Checkpoint answers are written to artifacts/, not a separate location.** This means checkpoint answers are immediately available as inputs to subsequent phases via `loadPhaseInputs`.

## Anti-Patterns
- Do NOT: assume artifact filenames have extensions — agents may produce `company_profile` with no extension, matching an artifact declared as `company_profile`
- Do NOT: read artifacts directly from the filesystem instead of going through the interface — the extension fallback logic is non-trivial and must be consistent
- Do NOT: rely on `producedByPhase` from loaded files — it is set to the literal string `'loaded'` on read, not the original producing phase

## Dependencies
- Consumes: `@forgeflow/types` (StateFile, RunState, CheckpointState)
- Consumed by: `@forgeflow/engine` (orchestrator), `@forgeflow/cli` (run + resume commands), `@forgeflow/server` (RunManager)

## Patterns
- **Directory layout per run:** `{basePath}/{runId}/state.json`, `checkpoint.json`, `artifacts/*`, `uploads/*`
- **tryReadFile returns null on any error** — all fs errors are swallowed into null/empty results. This is intentional; callers treat missing data as "not yet produced."
- **`listArtifacts` walks recursively** — artifacts can contain subdirectories (created when `file.name` contains `/`), and listing traverses all of them.
- **Default basePath** in production is `~/.forgeflow/runs/` — set by engine/CLI/server, not by this package.
