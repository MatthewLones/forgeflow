# @forgeflow/validator

## Purpose
Owns the FlowGraph symbol table, 11-rule validation pipeline, and execution plan derivation. Does NOT own parsing (that's `@forgeflow/parser`) or prompt generation (that's `@forgeflow/compiler`).

## Entry Points
- `buildFlowGraph(flow)` -- builds the single-source-of-truth symbol table from a FlowDefinition. O(N+E) complexity.
- `validateFlow(flow, options?)` -- backwards-compatible simple API, returns `ValidationResult`
- `validateFlowDetailed(flow, options?)` -- returns `ValidationPipelineResult` with per-rule introspection, timing, and the FlowGraph
- `createDefaultRegistry()` -- returns fresh array of all 11 rules (safe to modify)
- `createRegistry(base, { additions?, removals? })` -- compose custom rule sets
- `buildExecutionPlan(graph)` -- derives `ExecutionPlan` from a validated FlowGraph (called internally only when zero errors)

## Contracts & Invariants
- FlowGraph is built ONCE per validation run. All 11 rules and the compiler consume the same instance -- never rebuild it.
- Node IDs must be globally unique across ALL nesting depths. The FlowGraph Map silently deduplicates, so `node-id-unique` walks the raw `flow.nodes` tree to catch collisions.
- `availableAtPhase` tracks cumulative file availability in topo order. User uploads seed the set before the first node.
- `childTopoOrder` is computed from implicit sibling I/O edges (not explicit annotations). If no inter-sibling deps exist, it defaults to declaration order.
- `childCycle` is set by topo-sorting sibling dependency edges. The `CHILD_CYCLE` diagnostic is emitted by the dependency pass, not the graph builder.
- Parent-child output sharing is allowed (aggregation pattern). Output uniqueness only flags UNRELATED nodes sharing the same filename.
- Execution plan is ONLY built when there are zero errors. Warnings do not block plan generation.
- Inline ArtifactSchemas always take precedence over `flow.artifacts` registry schemas.

## Anti-Patterns
- Do NOT call `buildFlowGraph()` more than once for the same flow -- pass the graph instance through.
- Do NOT add validation logic directly to `flow-graph.ts` -- it builds data, it does not diagnose. Diagnostics belong in rules or passes.
- Do NOT create new validation as a monolithic pass in `passes/`. New rules go in `rules/` with the `ValidationRule` interface and a declared dependency list.
- Do NOT assume `topoIndex` is set on child nodes -- it is only set on top-level nodes. Children have `topoIndex: -1`.

## Dependencies
- Consumes: `@forgeflow/types` (FlowGraph, FlowSymbol, ArtifactEntry, ValidationRule, etc.)
- Consumed by: `@forgeflow/compiler`, `@forgeflow/engine`, `@forgeflow/server`, `@forgeflow/cli`

## Patterns
- Rule runner topo-sorts rules by their `descriptor.dependencies` and skips downstream rules when an upstream rule emits errors (unless `continueOnDependencyFailure` is set).
- Rules with a dependency on a rule NOT in the registry treat that dependency as satisfied (graceful degradation).
- `diagnostics.ts` provides `createDiagnostic()` factory and `findClosestMatch()` for Levenshtein-based typo suggestions -- used by dependency resolution.
- The `passes/` directory contains older pass functions wrapped as rules in `rule-registry.ts`. New validation should use the `rules/` pattern directly.

## Downlinks
- `src/rules/CLAUDE.md` -- 6 structural validation rules (first-class `ValidationRule` objects)
- `src/passes/CLAUDE.md` -- 5 legacy pass functions wrapped as rules (output, dependency, budget, interrupt, schema-compat)
