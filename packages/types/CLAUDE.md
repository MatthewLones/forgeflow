# @forgeflow/types

## Purpose
Owns all shared TypeScript type declarations for the monorepo. Does NOT own any runtime logic, classes, or functions -- sole exception: `artifactName()` utility in `node.ts`.

## Entry Points
- `artifactName(ref)` -- normalizes `ArtifactRef` (string | ArtifactSchema) to a plain filename string
- `index.ts` -- barrel re-export of all types; every new type MUST be re-exported here

## Contracts & Invariants
- This package is zero-runtime. The `dist/index.js` output must contain only the `artifactName` function and re-exports. Adding classes, constants, or stateful code here breaks the leaf-node contract and bloats every downstream package.
- `FlowNode.children` is recursive to arbitrary depth. Any code processing nodes must handle unbounded nesting.
- `ArtifactRef = string | ArtifactSchema`. Both forms are valid in `config.inputs` and `config.outputs`. Always normalize via `artifactName()` before comparing artifact names.
- Node IDs must match `^[a-z][a-z0-9_]*$` (snake_case, starts with letter). This is enforced at the parser layer but the type is `string` -- don't assume format in type-only code.
- `FlowGraph` is immutable after construction. All collection properties are `Readonly*` types. Never mutate a FlowGraph; rebuild it instead.
- `FlowSymbol.topoIndex` is `-1` for child nodes (only top-level nodes get a real topo index).
- `PhaseIR` is a discriminated union on `kind`: `'agent'` or `'checkpoint'`. Always narrow before accessing type-specific fields.
- `ProgressEvent` is a discriminated union on `type`. New event types must be added to this union and handled by all SSE consumers (see packages/CLAUDE.md cross-cutting contracts).
- `InterruptAnswer` union includes `EscalatedAnswer` for auto-escalation timeouts -- this is not a user-facing answer type.

## Anti-Patterns
- Do NOT add runtime code (functions, classes, side effects) to this package -- it will break the zero-runtime guarantee. If you need a utility, it belongs in the package that consumes it.
- Do NOT import from sub-paths (`@forgeflow/types/node`). Only import from the package root (`@forgeflow/types`). The barrel in `index.ts` is the sole public API.

## Dependencies
- Consumes: nothing (leaf node)
- Consumed by: every other package in the monorepo

## Patterns
- Types are organized by domain into separate files: `node.ts` (flow structure), `flow.ts` (top-level definition), `flow-graph.ts` (semantic analysis), `compile-ir.ts` (compiler IR), `engine.ts` (execution/progress), `interrupt.ts` (interrupt protocol), `validation.ts` (rule pipeline), `skill.ts`, `git.ts`, `errors.ts`, `execution.ts` (plan/result)
- `ArtifactEntry.consumerIds` is a `Set<string>`, not an array -- this is intentional for O(1) lookup but means it won't serialize to JSON without conversion
- `CheckpointState.waitingForFile` is deprecated in favor of `expectedFiles` array -- new code should only use `expectedFiles`
- Child wave ordering is encoded in `ChildReference.wave` (compile-ir) and computed from `FlowSymbol.childTopoOrder` (flow-graph) -- these are the two halves of the same concept
