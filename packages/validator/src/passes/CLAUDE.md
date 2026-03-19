# Validator Passes

## Purpose
Owns 5 non-structural validation pass functions (output uniqueness, dependency resolution, budget, interrupts, schema compatibility) plus the legacy monolithic `checkStructural`. Does NOT own rule registration -- the passes are wrapped as `ValidationRule` objects in `rule-registry.ts`.

## Entry Points
- `checkOutputUniqueness(graph)` -- detects duplicate output filenames across unrelated nodes; allows parent-child sharing via ancestor check
- `checkDependencies(graph, userUploadFiles)` -- verifies every input traces to a user upload or prior-node output; wave-aware for children
- `checkBudget(graph)` -- warns on budget overflows (children > parent, sum of nodes > flow); suggests per-node budgets
- `checkInterrupts(graph)` -- rejects interrupts on checkpoint nodes; warns when nested nodes have interrupts but parent instructions don't mention handling
- `checkSchemaCompat(graph)` -- warns on format mismatches and missing required fields between producer/consumer ArtifactSchemas
- `checkStructural(graph)` -- LEGACY monolithic pass (all 6 structural checks in one function). Kept for backward compat; new code should use individual rules in `rules/`.

## Contracts & Invariants
- All pass functions take `FlowGraph` (not `FlowDefinition`) as first argument. They never call `buildFlowGraph()` internally.
- `checkDependencies` receives `userUploadFiles` as a separate arg. The rule wrapper in `rule-registry.ts` sources this from `options?.userUploadFiles ?? graph.userUploadFiles`.
- Output uniqueness allows parent+child to share an output filename. The `isAncestor()` check uses `FlowSymbol.descendantIds`. For >2 nodes, it checks if ONE node is ancestor of ALL others.
- Dependency resolution walks children in `sym.childTopoOrder` (not declaration order), accumulating each child's outputs as available to subsequent siblings.
- Budget checks use `suggestion` severity for missing budgets and `warning` severity for budget overflows. No budget issue is ever an `error`.
- Schema compatibility diagnostics are ALL warnings -- they never block execution. Field check is JSON-only and defaults `required` to `true` when unset.
- Interrupt check uses keyword heuristic ("interrupt", "pause", "ask", "approval") in parent instructions to detect awareness of child interrupts.

## Anti-Patterns
- Do NOT add new validation logic as a new function in this directory. Create a rule in `rules/` instead and register it in `rule-registry.ts`.
- Do NOT call `checkStructural()` directly in new code -- it duplicates what the 6 individual structural rules already do. It exists only for legacy test compatibility.
- Do NOT treat budget warnings as blocking errors -- they are advisory. The engine's FlowOrchestrator enforces actual budget limits at runtime.

## Dependencies
- Consumes: `@forgeflow/types` (FlowGraph, FlowDiagnostic, ArtifactSchema), `../diagnostics.js` (createDiagnostic, findClosestMatch)
- Consumed by: `../rule-registry.ts` (wraps each pass function as a ValidationRule)

## Patterns
- Each pass function returns `FlowDiagnostic[]` -- pure functions with no side effects.
- `checkDependencies` uses `findClosestMatch()` (Levenshtein) to provide "did you mean?" suggestions for unresolved inputs.
- `checkOutputUniqueness` deduplicates node IDs before checking to avoid false positives when the same node appears multiple times in the ancestor chain.
- `structural.ts` is a 1:1 duplicate of the 6 rules in `rules/` -- if you change one, the other is stale. Prefer changing the rules.
