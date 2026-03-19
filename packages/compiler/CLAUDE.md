# @forgeflow/compiler

## Purpose
Owns the two-stage IR pipeline that turns FlowGraph nodes into markdown prompts for phase agents. Does NOT build FlowGraph (that is the validator's job) and does NOT execute prompts (that is the engine's job).

## Entry Points
- `compilePhase(nodeId, graph)` — preferred API; returns `{ ir: PhaseIR, markdown: string }` for one node
- `compileChildPrompts(nodeId, graph)` — preferred API; returns `{ irs, markdowns }` for all descendant prompt files
- `resolvePhaseIR(node, graph, { isChild? })` — stage 1: pure FlowGraph to PhaseIR transform
- `generateMarkdown(ir)` — stage 2: pure PhaseIR to markdown string
- `FORGEFLOW_PHASE_SYSTEM_PROMPT` — static system prompt constant used by all phase agents
- `compilePhasePrompt(node, context)` — legacy API (deprecated, uses IR internally)
- `createCompileContext(graph, nodeId)` — bridge for legacy callers to derive CompileContext from FlowGraph

## Contracts & Invariants
- The compiler NEVER constructs a FlowGraph — it always receives one from the caller (built by `buildFlowGraph()` in the validator). Duplicating graph construction here would cause divergence.
- Both APIs (new FlowGraph-based and legacy CompileContext-based) must produce **identical markdown** for the same input. This is enforced by parity golden tests in `compile-phase.test.ts`.
- `resolvePhaseIR` and `generateMarkdown` are pure functions with zero side effects.
- Top-level nodes always get a budget (falling back to `flow.budget`). Child nodes only get a budget if one is explicitly declared on the node; otherwise `ir.budget` is `undefined` and the budget section is omitted from markdown.
- Skills are deduplicated: global skills first, then node-specific skills, via `Set`. Order is global-first, node-specific appended.
- Parent prompts reference children via a table pointing to `prompts/{childId}.md` files. Child instructions are NEVER inlined into the parent prompt — this is the O(n) token scaling guarantee.
- `resolveChildPromptIRs` walks descendants recursively — every child at every depth gets its own `{childId}.md` entry keyed by filename.
- Children are sorted by `parentSym.childTopoOrder` and assigned wave numbers computed from sibling I/O dependencies. Wave 0 = no sibling deps.

## Anti-Patterns
- Do NOT call `buildFlowGraph()` inside the compiler — always receive it as a parameter.
- Do NOT inline child instructions into parent markdown — use the prompt file reference table. Inlining causes O(n^depth) token explosion.
- Do NOT add new sections to `generateMarkdown()` without updating `FORGEFLOW_PHASE_SYSTEM_PROMPT` — the system prompt documents the workspace layout and protocol that agents follow, and the two must stay in sync.
- Do NOT assume wave ordering in the legacy `compilePhasePrompt` path — it hardcodes `wave: 0` for all children because it lacks FlowGraph data for sibling dependency analysis.

## Dependencies
- Consumes: `@forgeflow/types` (PhaseIR, AgentPhaseIR, CheckpointIR, ChildPromptIR, FlowGraph, FlowSymbol, ArtifactSchema, `artifactName()`)
- Consumed by: `@forgeflow/engine` (orchestrator compiles prompts before sandbox execution), `@forgeflow/server` (compile preview endpoint)

## Patterns
- **Two-stage pipeline**: `resolve.ts` converts FlowGraph data into a typed IR struct, `generate.ts` converts IR to markdown. This separation means IR can be inspected/returned to API callers without re-parsing markdown.
- **Legacy adapter**: `compiler.ts` contains `resolvePhaseIRFromContext()` which adapts the old `CompileContext` interface to produce the same IR. The legacy path hardcodes `wave: 0` and uses `hasInterrupts()` (recursive tree walk) instead of `FlowSymbol.interruptCapable`.
- **Wave computation**: `computeChildWaves()` builds a sibling output-to-producer map, then walks children in topo order assigning `wave = max(dep waves) + 1`. Single-wave renders as "Launch All N Concurrently"; multi-wave renders wave-by-wave with wait instructions.
- **Schema rendering**: `appendSchemaDetail()` formats `ArtifactSchema` into compact "Format: X — description" + "Fields: key (type)" lines, with `?` suffix for optional fields.
- **Test cross-package import**: Tests import `buildFlowGraph` from `../../validator/src/flow-graph.js` via relative path (not package name) — this avoids needing to build the validator before running compiler tests.
