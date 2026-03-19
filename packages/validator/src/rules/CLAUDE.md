# Validator Rules

## Purpose
Owns the 6 structural validation rules implemented as first-class `ValidationRule` objects. Does NOT own the non-structural checks (those live in `passes/` and are wrapped in `rule-registry.ts`).

## Entry Points
- `nodeIdFormatRule` -- enforces snake_case via `/^[a-z][a-z0-9_]*$/` across ALL nodes (including children)
- `nodeIdUniqueRule` -- walks raw `flow.nodes` tree to detect duplicate IDs across nesting depths
- `edgeValidityRule` -- edges must reference top-level node IDs only (not children)
- `dagAcyclicRule` -- reads `graph.hasCycle` / `graph.cycleNodes` (no recomputation)
- `connectivityRule` -- orphan/dead-end detection; depends on `dag-acyclic`, skips if cycle present
- `nodeTypeRulesRule` -- type constraints: only agents may have children, checkpoints require presentation, agent/checkpoint require non-empty instructions

## Contracts & Invariants
- Every rule exports a single `ValidationRule` constant with a fully populated `descriptor` (id, category, dependencies, etc.).
- All rule IDs follow the `category/rule-name` naming convention (e.g., `structural/dag-acyclic`).
- Rules MUST only read from the `FlowGraph` -- they never mutate it.
- `connectivity` is the only structural rule with a dependency (`structural/dag-acyclic`). All others have `dependencies: []`.
- `nodeIdUniqueRule` cannot rely on `graph.symbols` for duplicate detection because the Map silently overwrites entries with the same key. It must walk `graph.flow.nodes` recursively.
- Connectivity checks only fire for flows with more than 1 node. Single-node flows are always valid.
- First node in topo order is exempt from "no incoming edges" check. Last node is exempt from "no outgoing edges" check.
- `nodeTypeRulesRule` emits both errors (hard constraints) and warnings (soft guidance like checkpoint without outputs, checkpoint with interrupts).

## Anti-Patterns
- Do NOT add rule dependencies unless the dependent rule truly produces garbage results without the upstream rule passing. Over-specifying deps causes unnecessary skip cascades.
- Do NOT recompute cycle detection or topo sort inside a rule -- `FlowGraph` already has `hasCycle`, `cycleNodes`, and `topoOrder`.
- Do NOT check child-specific constraints in edge-validity -- edges only connect top-level nodes. Children have no edges; they use implicit I/O-based wave ordering.

## Dependencies
- Consumes: `@forgeflow/types` (ValidationRule, FlowGraph, FlowDiagnostic), `../diagnostics.js` (createDiagnostic factory)
- Consumed by: `../rule-registry.ts` (imported into `createDefaultRegistry()`)

## Patterns
- Each rule file is self-contained: one file, one exported rule constant.
- All diagnostic creation goes through `createDiagnostic()` to ensure consistent shape (code, severity, message, location, optional suggestion/related).
- The `check()` function receives the full `FlowGraph` but typically only iterates `graph.symbols` or `graph.flow.nodes/edges`.
