# ForgeFlow Pipeline: From JSON to Running Agents

This document is a deep technical walkthrough of what happens when you press **Validate** or **Compile** in the ForgeFlow IDE — every data structure, algorithm, and transformation from the raw `FLOW.json` all the way to a running agent in a Docker container.

ForgeFlow is, architecturally, a **programming language toolchain**:

```
Source Code    →  Parser  →  AST  →  Semantic Analysis  →  IR  →  Code Gen  →  Runtime
 (FLOW.json)    (Zod)    (FlowDef)   (FlowGraph)       (PhaseIR) (Markdown)  (Orchestrator)
```

Each stage is a separate package with its own tests and clear boundaries. This document walks through each one.

---

## Table of Contents

1. [Stage 1: Parsing (Source → AST)](#stage-1-parsing)
2. [Stage 2: Semantic Analysis (AST → Symbol Table)](#stage-2-semantic-analysis)
3. [Stage 3: Validation (11 Pluggable Rules)](#stage-3-validation)
4. [Stage 4: Execution Planning](#stage-4-execution-planning)
5. [Stage 5: IR Resolution (Symbol Table → PhaseIR)](#stage-5-ir-resolution)
6. [Stage 6: Code Generation (PhaseIR → Markdown)](#stage-6-code-generation)
7. [Stage 7: Runtime Execution](#stage-7-runtime-execution)
8. [End-to-End Example](#end-to-end-example)
9. [Key Algorithms](#key-algorithms)
10. [File Map](#file-map)

---

## Stage 1: Parsing

**Package:** `@forgeflow/parser`
**Input:** Raw JSON string or file path
**Output:** `FlowDefinition` (the AST)
**Analogy:** Lexer + parser in a traditional compiler

The parser validates the **syntactic structure** of a FLOW.json file using Zod schemas. It answers: "Is this valid JSON that matches the expected shape?"

```
FLOW.json string
    │
    ▼
 parseFlowJSON(jsonString)
    │
    ├── JSON.parse()              ← syntax check
    ├── flowDefinitionSchema      ← Zod structural validation
    │   ├── id, name, version     ← required fields
    │   ├── nodes[]               ← recursive FlowNode schema (z.lazy)
    │   ├── edges[]               ← { from, to } pairs
    │   ├── skills[]              ← string array
    │   └── budget                ← { maxTurns, maxBudgetUsd, timeoutMs }
    │
    ▼
 ParseResult { success, flow: FlowDefinition | null, errors: FlowDiagnostic[] }
```

### What the Parser Validates

- Node IDs match pattern `/^[a-z][a-z0-9_]*$/` (snake_case)
- Budget values are positive numbers
- `ArtifactRef` is either a plain string (`"report.json"`) or a full schema object (`{ name: "report.json", format: "json", fields: [...] }`)
- Recursive `FlowNode` structure (children can nest indefinitely via `z.lazy()`)
- Checkpoint nodes have `presentation` config
- All required fields present, correct types

### What the Parser Does NOT Validate

- Whether edges reference real nodes (that's the validator)
- Whether the graph has cycles (that's the validator)
- Whether input files are actually produced by some node (that's the validator)
- Whether budgets are reasonable (that's the validator)

The parser is deliberately narrow — it only rejects malformed input. Everything semantic is deferred to the validator, which has the full graph available.

### Key Type: FlowDefinition

```typescript
interface FlowDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  nodes: FlowNode[];           // top-level nodes only
  edges: FlowEdge[];           // { from, to } between top-level nodes
  skills: string[];            // global skills available to all nodes
  budget: FlowBudget;          // flow-level budget (fallback for nodes)
  artifacts?: Record<string, ArtifactSchema>;  // optional schema registry
}

interface FlowNode {
  id: string;
  type: 'agent' | 'checkpoint';
  name: string;
  instructions: string;        // free-text (the "source code" for this agent)
  config: NodeConfig;
  children: FlowNode[];        // recursive! children can have children
}
```

Nodes are trees. Edges are between top-level nodes only. This is a critical design decision — the DAG is flat at the top level, but each node can contain an arbitrarily deep sub-tree of child agents.

### Two Dependency Models

The system uses **two different dependency models** depending on the nesting level:

**Top-level nodes** have **explicit edges** declared by the user in `flow.edges`. These are what the user draws on the canvas. They define execution order and can encode ordering constraints that aren't artifact-based (e.g., "run B after A" even without shared files). The orchestrator executes top-level nodes sequentially in topological order.

**Child nodes** have **implicit edges** derived from their I/O declarations. There is no `edges` array for children — they live inside a parent node, not in the top-level DAG. The system infers dependency edges by matching inputs to outputs among siblings: if child B declares an input that child A declares as an output, then A must run before B. This is computed automatically during semantic analysis (Step 1b of `buildFlowGraph()`).

Both levels use the same `topologicalSort()` algorithm (Kahn's) for cycle detection and ordering. The difference is only in where the edges come from — explicit declaration vs I/O inference.

| Aspect | Top-level nodes | Child nodes |
|--------|----------------|-------------|
| Edge source | Explicit `flow.edges` array | Implicit from I/O matching |
| Defined by | User (drawn on canvas) | Computed automatically |
| Cycle detection | `FlowGraph.hasCycle` | `FlowSymbol.childCycle` |
| Execution order | `FlowGraph.topoOrder` | `FlowSymbol.childTopoOrder` |
| Ordering | Sequential phases (orchestrator) | Grouped into waves (compiled prompt) |
| Non-artifact ordering | Supported (edge without shared files) | Not supported (I/O only) |

---

## Stage 2: Semantic Analysis

**Package:** `@forgeflow/validator`
**Input:** `FlowDefinition`
**Output:** `FlowGraph` (the symbol table)
**Analogy:** Name resolution + type checking in a compiler
**File:** `packages/validator/src/flow-graph.ts`

The `buildFlowGraph()` function performs a single O(N+E) pass over the entire flow definition and produces a rich symbol table that every subsequent stage consumes. This is the most important data structure in the system.

```
FlowDefinition
    │
    ▼
 buildFlowGraph(flow)
    │
    ├── 1. Walk all nodes recursively (depth-first)
    │   └── For each node, build a FlowSymbol:
    │       ├── depth (0 = top-level, 1 = child, 2 = grandchild, ...)
    │       ├── parentId / childIds / descendantIds
    │       ├── declaredInputs / declaredOutputs (normalized filenames)
    │       ├── inputSchemas / outputSchemas (Maps for typed artifacts)
    │       └── interruptCapable (true if node OR any descendant has interrupts)
    │
    ├── 1b. Build child dependency edges and topo-sort siblings
    │   └── For each parent with children:
    │       ├── Infer edges: if child B's input matches child A's output → A → B
    │       ├── topologicalSort(childIds, childEdges)
    │       ├── Sets childTopoOrder on FlowSymbol (default: declaration order)
    │       └── Sets childCycle = true if siblings have circular deps
    │
    ├── 2. Topological sort on top-level nodes (Kahn's algorithm)
    │   └── Sets topoIndex on each top-level FlowSymbol
    │   └── Detects cycles → sets hasCycle, cycleNodes
    │
    ├── 3. Build adjacency maps
    │   └── predecessors / successors for each top-level node
    │   └── outgoing / incoming edge lists
    │
    ├── 4. Build artifact registry
    │   └── For each output file → ArtifactEntry { producerId, consumerIds, schema }
    │   └── Merges inline ArtifactSchema with flow.artifacts registry
    │
    ├── 5. Infer user uploads
    │   └── Entry nodes (no incoming edges) with inputs not produced by any node
    │
    └── 6. Compute availableAtPhase
        └── For each top-level node: set of files available before it runs
    │
    ▼
 FlowGraph {
   flow: FlowDefinition,         // original AST (for back-reference)
   symbols: Map<string, FlowSymbol>,  // ALL nodes at ALL depths
   topoOrder: string[],          // top-level execution order
   hasCycle: boolean,
   cycleNodes: string[],
   artifacts: Map<string, ArtifactEntry>,
   userUploadFiles: string[],
   availableAtPhase: Map<string, Set<string>>,
   outgoing / incoming: Map<string, string[]>,
 }
```

### Why a Symbol Table?

Before the FlowGraph existed, every pass through the system (validator, compiler, execution planner, orchestrator) rebuilt its own helper maps:

```
// This was duplicated 3+ times across packages:
function buildOutputMap(flow) { /* walk all nodes, collect outputs */ }
function hasInterrupts(node) { /* recursive tree walk */ }
function topologicalSort(nodes, edges) { /* Kahn's algorithm */ }
```

The FlowGraph eliminated all of this. It's built once, and every consumer reads from it:

| Consumer | What it reads from FlowGraph |
|----------|------------------------------|
| Validator rules | `symbols`, `artifacts`, `topoOrder`, `hasCycle`, `availableAtPhase` |
| Execution planner | `topoOrder`, `artifacts`, `symbols.interruptCapable`, `incoming` |
| Compiler (IR resolver) | `symbols.declaredInputs`, `artifacts.producerId`, `symbols.interruptCapable` |
| Orchestrator | `symbols.declaredInputs`, `symbols.interruptCapable` |

### Key Type: FlowSymbol

```typescript
interface FlowSymbol {
  node: FlowNode;              // back-reference to AST node
  depth: number;               // 0 = top-level
  parentId: string | null;
  childIds: string[];          // direct children only
  descendantIds: string[];     // all descendants (recursive)
  topoIndex: number;           // position in execution order (-1 for children)
  predecessors: string[];      // top-level nodes that must complete first
  successors: string[];        // top-level nodes that depend on this
  interruptCapable: boolean;   // this node OR any descendant has interrupts
  declaredInputs: string[];    // normalized filenames
  declaredOutputs: string[];   // normalized filenames
  inputSchemas: ReadonlyMap<string, ArtifactSchema>;
  outputSchemas: ReadonlyMap<string, ArtifactSchema>;
  childTopoOrder: readonly string[];  // children sorted by sibling dependencies
  childCycle: boolean;                // true if children have circular deps
}
```

---

## Stage 3: Validation

**Package:** `@forgeflow/validator`
**Input:** `FlowGraph`
**Output:** `FlowDiagnostic[]` (errors, warnings, suggestions)
**Analogy:** Type checker + linter with pluggable rules
**File:** `packages/validator/src/rule-runner.ts`

Validation uses a **pluggable rule pipeline** — 11 independent rules that each inspect the FlowGraph and produce diagnostics. Rules can declare dependencies on other rules, and the runner topologically sorts them.

```
FlowGraph
    │
    ▼
 runValidationPipeline(graph, rules)
    │
    ├── 1. Filter enabled rules
    ├── 2. Topologically sort rules by dependencies
    └── 3. For each rule (in dependency order):
        ├── Check if dependencies had errors → skip if so
        ├── rule.check(graph) → FlowDiagnostic[]
        └── Track which rules had errors
    │
    ▼
 ValidationPipelineResult {
   result: ValidationResult,    // { valid, errors, warnings, suggestions, executionPlan }
   ruleResults: [{              // per-rule introspection
     ruleId, status, diagnostics, durationMs, skippedReason?
   }],
   graph: FlowGraph,
   totalDurationMs
 }
```

### The 11 Default Rules

Rules are organized by category. Each rule is a standalone module with a `check(graph): FlowDiagnostic[]` function.

#### Structural Rules (6)

| Rule ID | What it checks | Depends on |
|---------|---------------|------------|
| `structural/node-id-format` | All node IDs match snake_case pattern | — |
| `structural/node-id-unique` | No duplicate IDs (including across nesting levels) | — |
| `structural/edge-validity` | All edges reference existing top-level nodes | — |
| `structural/dag-acyclic` | Graph has no cycles (uses FlowGraph.hasCycle) | — |
| `structural/connectivity` | No orphans or dead-ends (all nodes reachable) | `dag-acyclic` |
| `structural/node-type-rules` | Type-specific constraints (checkpoint has presentation, only agents have children, non-empty instructions) | — |

#### Type System Rules (2)

| Rule ID | What it checks | Depends on |
|---------|---------------|------------|
| `type-system/output-uniqueness` | Each filename produced by exactly one node | — |
| `type-system/schema-compatibility` | Producer and consumer schemas match (format, fields) | `output-uniqueness` |

#### Data Flow Rules (1)

| Rule ID | What it checks | Depends on |
|---------|---------------|------------|
| `dataflow/dependency-resolution` | Every input file traces to a producer or user upload; file is available before the consuming phase runs; child sibling cycles detected (`CHILD_CYCLE`); children walk in topo order with outputs accumulating | `dag-acyclic`, `connectivity`, `output-uniqueness` |

#### Resource Rules (1)

| Rule ID | What it checks | Depends on |
|---------|---------------|------------|
| `resource/budget-check` | Node budgets don't exceed flow budget; budget values are reasonable | — |

#### Runtime Rules (1)

| Rule ID | What it checks | Depends on |
|---------|---------------|------------|
| `runtime/interrupt-validity` | Interrupt configs are valid for node type; interrupt-capable nodes have appropriate parent instructions | — |

### Rule Dependency Resolution

Rules themselves form a DAG. The runner uses Kahn's algorithm (same one used for the flow graph) to topologically sort rules:

```
                        ┌─ node-id-format
                        ├─ node-id-unique
 Independent:           ├─ edge-validity
                        ├─ node-type-rules
                        ├─ output-uniqueness
                        ├─ budget-check
                        └─ interrupt-validity

 Depends on acyclic:    ├─ connectivity
                        │
 Depends on uniqueness: ├─ schema-compatibility
                        │
 Depends on 3 rules:    └─ dependency-resolution
```

If `dag-acyclic` finds a cycle, `connectivity` and `dependency-resolution` are automatically skipped (they'd produce meaningless errors on a cyclic graph).

### Composable Registries

Custom rule sets can be composed for different contexts:

```typescript
const strictRules = createRegistry(defaultRules, {
  additions: [myCustomRule],
  removals: ['resource/budget-check'],  // skip budget checks in dev
});
```

### Key Type: FlowDiagnostic

```typescript
interface FlowDiagnostic {
  code: string;                // e.g. 'CYCLE_DETECTED', 'UNRESOLVED_INPUT'
  severity: 'error' | 'warning' | 'suggestion';
  message: string;             // human-readable
  location?: {
    nodeId?: string;
    field?: string;            // dot-path like 'config.inputs'
    edgeIndex?: number;
  };
  suggestion?: string;         // how to fix it
  related?: string[];          // related node IDs
}
```

---

## Stage 4: Execution Planning

**Package:** `@forgeflow/validator`
**Input:** `FlowGraph`
**Output:** `ExecutionPlan`
**Analogy:** Instruction scheduling / register allocation in a compiler
**File:** `packages/validator/src/execution-plan.ts`

If validation passes with no errors, the rule runner calls `buildExecutionPlan()` to produce a concrete execution schedule.

```
FlowGraph
    │
    ▼
 buildExecutionPlan(graph)
    │
    ├── 1. For each node in topoOrder:
    │   ├── Resolve inputsFrom: [{file, source}]
    │   │   └── source = graph.artifacts.get(file)?.producerId ?? 'user_upload'
    │   ├── Merge skills: [...flow.skills, ...node.config.skills] (deduped)
    │   ├── estimatedCost: { turns, usd } from node budget
    │   ├── interruptCapable: from FlowSymbol
    │   └── children: recursive PhaseInfo[] (if node has children)
    │
    ├── 2. Sum total estimated cost across all phases
    │
    └── 3. Compute critical path (longest-path dynamic programming)
    │
    ▼
 ExecutionPlan {
   phases: PhaseInfo[],              // ordered execution schedule
   totalEstimatedCost: { turns, usd },
   criticalPath: string[],          // bottleneck node sequence
 }
```

### Critical Path Algorithm

The critical path identifies which sequence of nodes determines the minimum total execution time. It uses dynamic programming on the topological order:

```
For each node in topoOrder:
  cost[node] = max(cost[predecessor] for all predecessors) + node.budget.usd
  predecessor[node] = argmax predecessor

Find node with max cost[node]
Trace predecessor chain back to start
```

This gives the UI actionable information: "These 3 nodes are your bottleneck. Optimizing anything else won't speed up the flow."

### Key Type: PhaseInfo

```typescript
interface PhaseInfo {
  nodeId: string;
  order: number;                // 0-based position in execution order
  inputsFrom: Array<{
    file: string;
    source: string;             // producerId or 'user_upload'
  }>;
  skills: string[];             // deduplicated global + node skills
  estimatedCost: { turns: number; usd: number };
  interruptCapable: boolean;
  children?: PhaseInfo[];       // recursive for child nodes
}
```

---

## Stage 5: IR Resolution

**Package:** `@forgeflow/compiler`
**Input:** `FlowNode` + `FlowGraph`
**Output:** `PhaseIR` (structured intermediate representation)
**Analogy:** AST → IR lowering in LLVM
**File:** `packages/compiler/src/resolve.ts`

The IR resolver transforms a FlowNode (the AST node) plus data from the FlowGraph (the symbol table) into a structured, self-contained `PhaseIR` object. This is a **pure function** with no side effects.

```
FlowNode + FlowGraph
    │
    ▼
 resolvePhaseIR(node, graph, { isChild? })
    │
    ├── If checkpoint node:
    │   └── CheckpointIR {
    │       kind: 'checkpoint',
    │       filesToPresent: InputFileEntry[],
    │       expectedInputs: OutputFileEntry[],
    │       presentation
    │     }
    │
    └── If agent node:
        └── AgentPhaseIR {
            kind: 'agent',
            isChild: boolean,
            inputs: InputFileEntry[],    ← with source attribution
            outputs: OutputFileEntry[],
            skills: SkillEntry[],        ← deduplicated, with paths
            budget?: NodeBudget,         ← optional for children
            children: ChildReference[],  ← references to prompt files
            interrupt: { enabled },      ← from FlowSymbol
            rules: string[],
          }
```

### Input Source Attribution

For each input file, the resolver determines where it comes from:

```typescript
const source = graph.artifacts.get(file)?.producerId ?? 'user_upload';
const sourceLabel = source === 'user_upload' ? 'user upload' : `from ${source}`;

// Result: { file: 'data.json', source: 'parse_step', sourceLabel: 'from parse_step' }
```

This is important for the generated markdown — when an agent reads `input/data.json`, it knows it came from the `parse_step` phase.

### Budget Resolution

Budget handling differs between top-level and child nodes:

```
Top-level node:  node.config.budget ?? flow.budget    (always has a budget)
Child node:      node.config.budget ?? undefined       (optional — parent manages)
```

A child without an explicit budget inherits the parent's budget implicitly (the parent monitors total cost). Only children with explicit budgets get a `## Budget` section in their prompt.

### Children as Prompt File References

Children are NOT inlined into the parent IR. Instead, each child becomes a `ChildReference`:

```typescript
interface ChildReference {
  index: number;           // 1-based display index
  id: string;              // child node ID
  name: string;            // display name
  promptFile: string;      // 'prompts/{id}.md'
  outputs: string[];       // what this child will produce
  wave: number;            // 0 = no sibling deps, 1+ = depends on earlier wave
}
```

This is a critical design decision for token efficiency. See [Token Scaling](#token-scaling).

### Recursive Child Resolution

`resolveChildPromptIRs()` walks the entire descendant tree and produces a flat map:

```
Parent (has 2 children, one has 2 grandchildren)
    │
    ▼
 resolveChildPromptIRs(parentNode, graph)
    │
    ├── child_a → resolvePhaseIR(child_a, graph, { isChild: true })
    │   ├── grandchild_x → resolvePhaseIR(grandchild_x, graph, { isChild: true })
    │   └── grandchild_y → resolvePhaseIR(grandchild_y, graph, { isChild: true })
    └── child_b → resolvePhaseIR(child_b, graph, { isChild: true })
    │
    ▼
 ChildPromptIR {
   children: Map<string, PhaseIR>
     'child_a.md'      → AgentPhaseIR (references grandchild_x.md, grandchild_y.md)
     'child_b.md'       → AgentPhaseIR (no children)
     'grandchild_x.md'  → AgentPhaseIR (leaf)
     'grandchild_y.md'  → AgentPhaseIR (leaf)
 }
```

The map is flat — every descendant at every depth gets its own entry. The nesting is preserved through `ChildReference` links in each parent's IR.

---

## Stage 6: Code Generation

**Package:** `@forgeflow/compiler`
**Input:** `PhaseIR`
**Output:** Markdown string (the executable prompt)
**Analogy:** IR → machine code in a compiler
**File:** `packages/compiler/src/generate.ts`

The code generator is a **pure function**: `generateMarkdown(ir: PhaseIR) → string`. It takes the structured IR and renders it into the markdown format that Claude will execute as instructions.

### Agent Prompt Structure

```markdown
# Phase: {name}                          ← or "# Subagent: {name}" for children

You are executing one phase of the "{flowName}" workflow.   ← omitted for children

## Your Task
{instructions}

## Input Files                           ← omitted if empty
- input/{file} ({sourceLabel})           ← source attribution for top-level only
                                         ← children just get "input/{file}"

## Output Files (you MUST produce these) ← omitted if empty
- output/{file}

## Skills Available                      ← omitted if empty
- {name} (in {path})

## Budget                                ← omitted for children without explicit budget
- Max turns: {maxTurns}
- Max cost: ${maxBudgetUsd}

## Rules
- Write all output files to the output/ directory
- Read input files from the input/ directory
- Verify each output file exists before finishing
- Stay within budget constraints

## Subagents — Launch All {N} Concurrently    ← if all children are wave 0
| # | Name | ID | Prompt File |                 (no sibling dependencies)
|---|------|----|-------------|
| 1 | {name} | {id} | prompts/{id}.md |
| 2 | {name} | {id} | prompts/{id}.md |

## Subagents — {W} Waves                      ← if children have sibling deps
### Wave 1 — Launch Concurrently               (multiple waves)
| # | Name | ID | Prompt File |
| 1 | {name} | {id} | prompts/{id}.md |
### Wave 2 — Launch After Wave 1 Completes
| 3 | {name} | {id} | prompts/{id}.md |

Launch subagents using the Task tool...

### Progress Tracking                          ← child start/done markers
echo '{}' > output/__CHILD_START__{id}.json
echo '{}' > output/__CHILD_DONE__{id}.json

## Interrupt Protocol                          ← only if interrupt.enabled
Write interrupt: output/__INTERRUPT__{id}.json
Poll for answer: output/__ANSWER__{id}.json (every 5s)
```

### Top-Level vs Child Differences

| Aspect | Top-level | Child |
|--------|-----------|-------|
| Header | `# Phase: {name}` | `# Subagent: {name}` |
| Flow context | "You are executing one phase of..." | Omitted |
| Input source labels | `input/data.json (from parse_step)` | `input/data.json` (no attribution) |
| Budget | Always present (node or flow fallback) | Only if child has explicit budget |

### Wave-Ordered Subagent Launch

When children have sibling dependencies (child B's input is child A's output), the compiler groups them into **waves** based on dependency depth:

- **Wave 0**: Children with no sibling dependencies (can all run concurrently)
- **Wave 1**: Children that depend on at least one wave-0 child's output
- **Wave N**: Children that depend on at least one wave-(N-1) child's output

Wave numbers are computed by `computeChildWaves()` in `resolve.ts`, which processes children in `childTopoOrder` and assigns each child `wave = max(wave of its sibling dependencies) + 1`.

The code generator adapts the prompt format based on wave count:

- **Single wave** (all wave 0): generates backward-compatible "Launch All N Concurrently" header
- **Multiple waves**: generates wave-by-wave sections with explicit "Wait for ALL Wave N subagents to complete before proceeding to Wave N+1" instructions

This is how the runtime enforces ordering — the parent agent (Claude) reads the compiled prompt and uses the Task tool to spawn children in the correct wave sequence. The engine doesn't manage child ordering; it's all encoded in the prompt.

### Checkpoint Prompt Structure

```markdown
# Checkpoint: {name}

> This is a checkpoint — execution pauses here for human input.

## Instructions
{instructions}

## Files to Present
- {file} ({sourceLabel})

## Expected User Input
- {file}

## Presentation
**Title:** {title}
**Sections:** {sections.join(', ')}
```

### Token Scaling

The per-child prompt file approach is critical for token efficiency:

**Without prompt files (inlining):**
```
Parent prompt contains:
  - Parent instructions
  - Child A full instructions + config
  - Child B full instructions + config
  - Grandchild X full instructions + config  ← duplicated in child A's section
  - Grandchild Y full instructions + config  ← duplicated in child A's section

Token count: O(n^depth) — exponential growth with nesting
```

**With prompt files (ForgeFlow's approach):**
```
Parent prompt: Parent instructions + reference table (child names + file paths)
child_a.md:    Child A instructions + reference table (grandchild names + file paths)
child_b.md:    Child B instructions (leaf)
grandchild_x.md: Grandchild X instructions (leaf)
grandchild_y.md: Grandchild Y instructions (leaf)

Token count: O(n) per level — linear growth
```

Each agent only reads its own prompt file. The parent launches children via the Task tool, passing each child's prompt file path. Children do the same for grandchildren.

---

## Stage 7: Runtime Execution

**Package:** `@forgeflow/engine`
**Input:** `FlowDefinition` + user uploads
**Output:** `RunResult` + artifacts in state store
**Analogy:** The runtime / virtual machine
**File:** `packages/engine/src/orchestrator.ts`

The `FlowOrchestrator` ties everything together. It validates, compiles, and executes each phase in sequence.

```
FlowDefinition + user uploads
    │
    ▼
 FlowOrchestrator.execute(flow, uploads)
    │
    ├── 1. validateFlow(flow) → ExecutionPlan
    ├── 2. Initialize RunState, save to StateStore
    ├── 3. Save user uploads to StateStore
    └── 4. executePhases(ctx) — the main loop
            │
            for each phase in ExecutionPlan:
            │
            ├── If checkpoint node:
            │   ├── Create CheckpointState
            │   ├── Save to StateStore
            │   ├── Emit 'checkpoint' event
            │   └── Return { status: 'awaiting_input' }
            │
            └── If agent node:
                ├── buildFlowGraph(flow)          ← built once, reused
                ├── compilePhase(nodeId, graph)    ← IR → markdown
                ├── compileChildPrompts(...)       ← if has children
                ├── loadPhaseInputs(...)           ← from state store
                ├── resolveSkills(...)             ← from search paths
                ├── prepareWorkspace(...)          ← create sandbox dirs
                │   ├── workspace/{runId}/{phaseId}/
                │   │   ├── input/    ← files from state store
                │   │   ├── output/   ← agent writes here
                │   │   ├── skills/   ← only this phase's skills
                │   │   └── prompts/  ← child prompt files
                │
                ├── Start InterruptWatcher (if interrupt-capable)
                │   └── Watches output/ for signal files
                │
                ├── runner.runPhase(prompt, workspace, budget)
                │   ├── MockRunner:         write mock outputs
                │   ├── ClaudeAgentRunner:   Agent SDK query()
                │   └── DockerAgentRunner:   Docker container
                │
                ├── Check for escalation
                │   └── If interrupt timed out → synthetic checkpoint
                │
                ├── collectOutputs(workspace)
                ├── validateOutputs(actual, expected)  ← warning only
                ├── stateStore.savePhaseOutputs(...)
                └── cleanupWorkspace(...)
```

### The Workspace

Each phase gets an isolated workspace directory:

```
/tmp/forgeflow-workspaces/{runId}/{phaseId}/
├── input/                     ← artifacts from prior phases (via state store)
│   ├── contract.pdf           ← user upload
│   └── clauses_parsed.json    ← output from phase 1
├── output/                    ← agent writes results here
│   ├── analysis.json          ← expected output
│   ├── __INTERRUPT__q1.json   ← interrupt signal (agent → engine)
│   ├── __ANSWER__q1.json      ← interrupt answer (engine → agent)
│   ├── __CHILD_START__c1.json ← child progress marker
│   └── __CHILD_DONE__c1.json  ← child progress marker
├── skills/                    ← only skills this phase needs
│   └── legal-basics/
│       ├── SKILL.md
│       └── references/
│           ├── contract-law.md
│           └── liability-checklist.md
└── prompts/                   ← child prompt files (if node has children)
    ├── analyze_liability.md
    └── analyze_ip.md
```

### Agent Runners

Three implementations of the same interface:

```typescript
interface AgentRunner {
  runPhase(options: {
    nodeId: string;
    prompt: string;             // the compiled markdown
    workspacePath: string;      // isolated workspace
    budget: { maxTurns, maxBudgetUsd };
    onProgress?: (event) => void;
  }): Promise<PhaseResult>;
}
```

| Runner | When to use | How it works |
|--------|-------------|--------------|
| `MockRunner` | Testing (183 tests use this) | Writes predefined files to `output/`, returns mock cost. Zero API calls. |
| `ClaudeAgentRunner` | Local development | Runs Agent SDK `query()` on host. `permissionMode: 'bypassPermissions'`. Tracks turns + cost from SDK stream. |
| `DockerAgentRunner` | Production | Docker container with mounted workspace volume. Agent SDK runs inside container. Full isolation. |

### Interrupt Watcher

The `InterruptWatcher` uses chokidar to monitor `output/` for signal files in real-time:

```
Agent writes to output/
    │
    ▼
 chokidar detects file (stabilityThreshold: 200ms)
    │
    ├── __INTERRUPT__*.json  → Parse, enqueue for sequential handler
    │   └── Handler called → writes __ANSWER__*.json
    │   └── If timeout + inline mode → auto-escalate to checkpoint
    │
    ├── __CHILD_START__*.json → Emit child_started event
    ├── __CHILD_DONE__*.json  → Emit child_completed event
    ├── __ANSWER__*.json      → Ignore (we wrote it)
    └── Regular files         → Emit file_written event
```

Interrupts are processed **sequentially** (queue) to prevent race conditions. Auto-escalation uses `Promise.race(handler, timeout)`.

### State Store

All data between phases flows through the state store:

```
Phase 1 outputs → StateStore → Phase 2 inputs
                      ↕
                 RunState (status, cost, completed phases)
                 CheckpointState (paused runs)
                 User uploads
```

Local implementation: `~/.forgeflow/runs/{runId}/` with JSON files on disk.

### Resume After Checkpoint

```
orchestrator.resume(flow, runId, { fileName, content })
    │
    ├── Load RunState (verify status === 'awaiting_input')
    ├── Load CheckpointState
    ├── Save user's answer as artifact
    ├── Update checkpoint.status = 'answered'
    ├── Re-validate flow → get ExecutionPlan
    ├── Find checkpoint index in plan
    ├── RunState.status = 'running'
    └── executePhases(startingPhaseIndex: checkpointIndex + 1)
```

Zero cost while waiting for human input. The run can be resumed minutes or days later.

---

## End-to-End Example

Here's a complete trace of a 3-node flow: `parse → research (2 children) → generate`

### 1. FLOW.json (Source Code)

```json
{
  "id": "contract_review",
  "name": "Contract Review",
  "nodes": [
    {
      "id": "parse",
      "type": "agent",
      "name": "Parse Contract",
      "instructions": "Extract all clauses from the contract.",
      "config": {
        "inputs": ["contract.pdf"],
        "outputs": ["clauses.json"],
        "skills": [],
        "budget": { "maxTurns": 25, "maxBudgetUsd": 3 }
      },
      "children": []
    },
    {
      "id": "research",
      "type": "agent",
      "name": "Research",
      "instructions": "Coordinate parallel legal research.",
      "config": {
        "inputs": ["clauses.json"],
        "outputs": ["liability.json", "ip.json"],
        "skills": ["legal-basics"],
        "budget": { "maxTurns": 100, "maxBudgetUsd": 15 }
      },
      "children": [
        {
          "id": "liability",
          "type": "agent",
          "name": "Liability Analyst",
          "instructions": "Analyze liability and indemnification clauses.",
          "config": {
            "inputs": ["clauses.json"],
            "outputs": ["liability.json"],
            "skills": ["legal-basics"],
            "budget": { "maxTurns": 30, "maxBudgetUsd": 4 }
          },
          "children": []
        },
        {
          "id": "ip_analyst",
          "type": "agent",
          "name": "IP Analyst",
          "instructions": "Analyze intellectual property clauses.",
          "config": {
            "inputs": ["clauses.json"],
            "outputs": ["ip.json"],
            "skills": [],
            "budget": { "maxTurns": 30, "maxBudgetUsd": 4 }
          },
          "children": []
        }
      ]
    },
    {
      "id": "generate",
      "type": "agent",
      "name": "Generate Report",
      "instructions": "Produce the final risk report.",
      "config": {
        "inputs": ["liability.json", "ip.json"],
        "outputs": ["report.md"],
        "skills": [],
        "budget": { "maxTurns": 50, "maxBudgetUsd": 5 }
      },
      "children": []
    }
  ],
  "edges": [
    { "from": "parse", "to": "research" },
    { "from": "research", "to": "generate" }
  ],
  "skills": ["legal-basics"],
  "budget": { "maxTurns": 200, "maxBudgetUsd": 25, "timeoutMs": 600000 }
}
```

### 2. Parser Output (AST)

```
parseFlowJSON(json) → { success: true, flow: FlowDefinition }
```

All 5 nodes (3 top-level + 2 children) parsed. Zod validates types, patterns, required fields.

### 3. FlowGraph (Symbol Table)

```
buildFlowGraph(flow) → FlowGraph:

symbols (5 entries):
  'parse'     → { depth: 0, topoIndex: 0, declaredInputs: ['contract.pdf'], declaredOutputs: ['clauses.json'], interruptCapable: false }
  'research'  → { depth: 0, topoIndex: 1, declaredInputs: ['clauses.json'], declaredOutputs: ['liability.json', 'ip.json'], interruptCapable: false, childIds: ['liability', 'ip_analyst'] }
  'generate'  → { depth: 0, topoIndex: 2, declaredInputs: ['liability.json', 'ip.json'], declaredOutputs: ['report.md'], interruptCapable: false }
  'liability' → { depth: 1, parentId: 'research', topoIndex: -1 }
  'ip_analyst'→ { depth: 1, parentId: 'research', topoIndex: -1 }

topoOrder: ['parse', 'research', 'generate']
hasCycle: false
artifacts:
  'clauses.json'   → { producerId: 'parse', consumerIds: {'research'} }
  'liability.json'  → { producerId: 'research', consumerIds: {'generate'} }
  'ip.json'         → { producerId: 'research', consumerIds: {'generate'} }
  'report.md'       → { producerId: 'generate', consumerIds: {} }
userUploadFiles: ['contract.pdf']
```

### 4. Validation (11 Rules)

```
runValidationPipeline(graph, defaultRules) →

Rule results:
  ✅ structural/node-id-format      — all IDs match pattern
  ✅ structural/node-id-unique      — no duplicates
  ✅ structural/edge-validity       — all edges valid
  ✅ structural/dag-acyclic         — no cycles
  ✅ structural/connectivity        — fully connected
  ✅ structural/node-type-rules     — all type constraints met
  ✅ type-system/output-uniqueness  — each file produced once
  ✅ type-system/schema-compatibility — no schema conflicts
  ✅ dataflow/dependency-resolution — all inputs resolvable
  ✅ resource/budget-check          — budgets reasonable
  ✅ runtime/interrupt-validity     — no interrupt configs to check

Result: { valid: true, errors: [], warnings: [], executionPlan: ... }
```

### 5. Execution Plan

```
buildExecutionPlan(graph) →

phases:
  [0] parse    — inputsFrom: [{file: 'contract.pdf', source: 'user_upload'}], skills: ['legal-basics'], cost: $3
  [1] research — inputsFrom: [{file: 'clauses.json', source: 'parse'}], skills: ['legal-basics'], cost: $15
      children:
        [0] liability — inputsFrom: [{file: 'clauses.json', source: 'parent'}], skills: ['legal-basics'], cost: $4
        [1] ip_analyst — inputsFrom: [{file: 'clauses.json', source: 'parent'}], cost: $4
  [2] generate — inputsFrom: [{file: 'liability.json', source: 'research'}, {file: 'ip.json', source: 'research'}], cost: $5

totalEstimatedCost: { turns: 175, usd: 23 }
criticalPath: ['parse', 'research', 'generate']
```

### 6. IR Resolution + Code Generation

**Parent prompt for `research` phase:**

```
compilePhase('research', graph) →

  resolvePhaseIR(researchNode, graph) → AgentPhaseIR {
    kind: 'agent',
    isChild: false,
    name: 'Research',
    inputs: [{ file: 'clauses.json', source: 'parse', sourceLabel: 'from parse' }],
    outputs: [{ file: 'liability.json' }, { file: 'ip.json' }],
    skills: [{ name: 'legal-basics', path: 'skills/legal-basics/' }],
    budget: { maxTurns: 100, maxBudgetUsd: 15 },
    children: [
      { index: 1, id: 'liability', name: 'Liability Analyst', promptFile: 'prompts/liability.md', outputs: ['liability.json'] },
      { index: 2, id: 'ip_analyst', name: 'IP Analyst', promptFile: 'prompts/ip_analyst.md', outputs: ['ip.json'] },
    ],
    interrupt: { enabled: false },
  }

  generateMarkdown(ir) → "# Phase: Research\n\nYou are executing one phase of the \"Contract Review\" workflow.\n\n## Your Task\n..."
```

**Child prompt file `liability.md`:**

```
compileChildPrompts('research', graph) →

  resolveChildPromptIRs(researchNode, graph) → {
    children: Map {
      'liability.md'  → AgentPhaseIR { kind: 'agent', isChild: true, name: 'Liability Analyst', ... },
      'ip_analyst.md' → AgentPhaseIR { kind: 'agent', isChild: true, name: 'IP Analyst', ... },
    }
  }
```

### 7. Runtime Execution

```
Phase 1: parse
  ├── prepareWorkspace → input/contract.pdf
  ├── runner.runPhase(prompt, workspace, budget)
  ├── agent writes output/clauses.json
  ├── collectOutputs → ['clauses.json']
  └── stateStore.savePhaseOutputs('parse', [clauses.json])

Phase 2: research
  ├── prepareWorkspace → input/clauses.json, skills/legal-basics/, prompts/liability.md, prompts/ip_analyst.md
  ├── runner.runPhase(prompt, workspace, budget)
  │   └── Agent reads prompt, spawns 2 subagents via Task tool:
  │       ├── Subagent 1: reads prompts/liability.md → writes output/liability.json
  │       └── Subagent 2: reads prompts/ip_analyst.md → writes output/ip.json
  ├── collectOutputs → ['liability.json', 'ip.json']
  └── stateStore.savePhaseOutputs('research', [liability.json, ip.json])

Phase 3: generate
  ├── prepareWorkspace → input/liability.json, input/ip.json
  ├── runner.runPhase(prompt, workspace, budget)
  ├── agent writes output/report.md
  ├── collectOutputs → ['report.md']
  └── stateStore.savePhaseOutputs('generate', [report.md])

RunResult: { success: true, status: 'completed', totalCost: { turns: 150, usd: 20 }, outputFiles: ['clauses.json', 'liability.json', 'ip.json', 'report.md'] }
```

---

## Key Algorithms

### Topological Sort (Kahn's BFS)

Used in: FlowGraph builder, rule runner, critical path

```
1. Compute in-degree for each node
2. Queue all nodes with in-degree 0
3. While queue is not empty:
   a. Dequeue node, add to sorted order
   b. For each successor:
      - Decrement in-degree
      - If in-degree reaches 0, enqueue
4. If sorted.length < total nodes → cycle exists
```

Complexity: O(N + E)

### Critical Path (Longest-Path DP)

Used in: execution plan builder

```
1. For each node in topological order:
   cost[node] = max(cost[pred] for pred in incoming) + node.budgetUsd
   bestPred[node] = argmax(cost[pred])

2. endNode = argmax(cost[node] for all nodes)

3. Trace back: endNode → bestPred[endNode] → bestPred[...] → null
```

Complexity: O(N + E)

### Interrupt Queue (Sequential + Auto-Escalation)

Used in: InterruptWatcher

```
1. File detected in output/ → classify by prefix
2. __INTERRUPT__ files → push to queue
3. Process queue sequentially (prevents race conditions):
   a. Call onInterrupt handler
   b. If timeout configured and mode === 'inline':
      Promise.race(handler, setTimeout(timeoutMs))
      - Handler wins → write __ANSWER__ normally
      - Timeout wins → write EscalatedAnswer, set escalated flag
   c. Else: await handler directly
```

---

## File Map

```
packages/
├── types/src/
│   ├── index.ts              ← all type exports
│   ├── flow-definition.ts    ← FlowNode, FlowDefinition, FlowEdge, ArtifactRef
│   ├── flow-graph.ts         ← FlowGraph, FlowSymbol, ArtifactEntry
│   ├── compile-ir.ts         ← PhaseIR, AgentPhaseIR, CheckpointIR, ChildPromptIR
│   ├── execution.ts          ← ExecutionPlan, PhaseInfo, RunState, RunResult
│   ├── validation.ts         ← ValidationRule, FlowDiagnostic, ValidationResult
│   ├── interrupts.ts         ← Interrupt types (Approval, QA, Selection, Review, Escalation)
│   └── events.ts             ← ProgressEvent discriminated union
│
├── parser/src/
│   ├── schema.ts             ← Zod schemas (recursive FlowNode via z.lazy)
│   └── parser.ts             ← parseFlowJSON, parseFlowFile, parseFlowObject
│
├── validator/src/
│   ├── flow-graph.ts         ← buildFlowGraph (the symbol table builder)
│   ├── rule-runner.ts        ← runValidationPipeline (topological rule execution)
│   ├── rule-registry.ts      ← createDefaultRegistry, createRegistry
│   ├── execution-plan.ts     ← buildExecutionPlan (with critical path DP)
│   ├── diagnostics.ts        ← createDiagnostic helper
│   ├── validator.ts          ← validateFlow, validateFlowDetailed (public API)
│   └── rules/
│       ├── node-id-format.ts
│       ├── node-id-unique.ts
│       ├── edge-validity.ts
│       ├── dag-acyclic.ts
│       ├── connectivity.ts
│       ├── node-type-rules.ts
│       ├── output-uniqueness.ts
│       ├── schema-compatibility.ts
│       ├── dependency-resolution.ts
│       ├── budget-check.ts
│       └── interrupt-validity.ts
│
├── compiler/src/
│   ├── resolve.ts            ← resolvePhaseIR, resolveChildPromptIRs
│   ├── generate.ts           ← generateMarkdown (IR → markdown)
│   ├── compiler.ts           ← compilePhase, compileChildPrompts (high-level API)
│   └── index.ts              ← public exports (new + legacy)
│
├── engine/src/
│   ├── orchestrator.ts       ← FlowOrchestrator (execute, resume, executePhases)
│   ├── runner.ts             ← AgentRunner interface + MockRunner + ClaudeAgentRunner + DockerAgentRunner
│   ├── workspace.ts          ← prepareWorkspace, collectOutputs, cleanupWorkspace
│   └── interrupt-watcher.ts  ← InterruptWatcher (chokidar + sequential queue)
│
├── state-store/src/
│   ├── store.ts              ← StateStore interface
│   └── local.ts              ← LocalStateStore (filesystem at ~/.forgeflow/runs/)
│
├── skill-resolver/src/
│   └── resolver.ts           ← resolveSkills (search path resolution, SKILL.md + refs + scripts)
│
├── server/src/
│   ├── routes/flows.ts       ← POST /api/validate, POST /api/compile/preview (returns IR + markdown)
│   ├── routes/projects.ts    ← Project CRUD
│   ├── routes/runs.ts        ← Run execution, SSE streaming, interrupt bridge
│   └── services/
│       ├── project-store.ts  ← Filesystem CRUD at ~/.forgeflow/projects/
│       └── run-manager.ts    ← Active run tracking, SSE broadcast, interrupt Promise bridge
│
└── cli/src/
    └── cli.ts                ← forgeflow run / forgeflow resume commands
```

### Test Counts (183 total)

| Package | Tests | What they cover |
|---------|-------|-----------------|
| Parser | 12 | Schema validation, error formatting, recursive nodes |
| Validator | 81 | FlowGraph builder, all 11 rules, rule runner, execution plan |
| Compiler | 47 | Legacy API (17), IR resolver (16), markdown generator (8), new API parity (6) |
| Engine | 43 | Orchestrator (11), workspace (13), runners (3), InterruptWatcher (16) |
