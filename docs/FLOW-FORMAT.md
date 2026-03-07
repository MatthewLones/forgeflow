# FLOW.json Format Specification

## Overview

A `FLOW.json` file defines a complete agent workflow as a directed acyclic graph (DAG) of nodes. The execution engine reads this DAG and executes it **phase-by-phase** — each top-level node gets its own sandboxed agent run with a per-phase compiled prompt. State is serialized to a state store between every phase.

## TypeScript Types

> Canonical source: `@forgeflow/types` (`packages/types/src/node.ts` and `packages/types/src/flow.ts`)

```typescript
// --- Node Types ---

type NodeType = "agent" | "checkpoint";

// --- Artifact Types ---

type ArtifactFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/** A field definition within a JSON artifact schema */
interface ArtifactField {
  key: string;               // Field key name, e.g., "clause_id"
  type: ArtifactFieldType;
  description: string;       // Human-readable description
  required?: boolean;        // Default: true
}

/** Supported artifact file formats */
type ArtifactFormat = 'json' | 'markdown' | 'text' | 'csv' | 'pdf' | 'image' | 'binary';

/** Full artifact schema describing a file's structure and purpose */
interface ArtifactSchema {
  name: string;              // Filename, e.g., "clauses_parsed.json"
  format: ArtifactFormat;
  description: string;       // What this file contains
  fields?: ArtifactField[];  // Top-level field definitions (only for format='json')
}

/** An input or output entry: either a plain filename or a full artifact schema */
type ArtifactRef = string | ArtifactSchema;

/** Normalize a string or ArtifactSchema to just the filename */
function artifactName(artifact: ArtifactRef): string;

// --- Node Config ---

interface NodeBudget {
  maxTurns: number;          // Max API round-trips for this node
  maxBudgetUsd: number;      // Max dollar cost for this node
}

interface CheckpointPresentation {
  title: string;             // Header shown to user at checkpoint
  sections: string[];        // Named sections to render (e.g., "questions", "auto_fixable")
}

interface InterruptConfig {
  type: 'approval' | 'qa' | 'selection' | 'review' | 'escalation';
  mode?: 'inline' | 'checkpoint';  // Default: 'inline' with auto-escalate
  timeoutMs?: number;              // Auto-escalate timeout (default: 300000 = 5min)
}

interface NodeConfig {
  inputs: ArtifactRef[];     // Files this node reads (relative to workspace)
  outputs: ArtifactRef[];    // Files this node produces (relative to output/)
  skills: string[];          // Skill names to load for this node
  budget?: NodeBudget;       // Per-node budget (optional if using flow-level budget)
  estimatedDuration?: string; // Human-readable estimate: "30s", "2min", "5min"
  presentation?: CheckpointPresentation; // Only for checkpoint nodes
  interrupts?: InterruptConfig[];        // Interrupt types this node may fire
}

interface FlowNode {
  id: string;                // Unique identifier (snake_case: [a-z][a-z0-9_]*)
  type: NodeType;            // "agent" or "checkpoint"
  name: string;              // Display name on canvas
  description?: string;      // Optional short description (shown in tooltips)
  instructions: string;      // Free-text: what the agent should do
  config: NodeConfig;
  children: FlowNode[];      // Sub-nodes (run within this node's phase)
}

// --- Edge ---

interface FlowEdge {
  from: string;              // Source node ID
  to: string;                // Target node ID
  auto?: boolean;            // True if auto-created from artifact dependencies
}

// --- Flow ---

interface FlowBudget {
  maxTurns: number;          // Total max turns for the entire flow
  maxBudgetUsd: number;      // Total max cost for the entire flow
  timeoutMs: number;         // Wall-clock timeout in milliseconds
}

interface FlowDefinition {
  id: string;                // Unique flow identifier
  name: string;              // Display name
  version: string;           // Semver string
  description: string;       // One-line description
  skills: string[];          // Global skills (available to all nodes)
  budget: FlowBudget;        // Flow-level budget constraints
  nodes: FlowNode[];         // All top-level nodes
  edges: FlowEdge[];         // Connections between top-level nodes
  artifacts?: Record<string, ArtifactSchema>; // Flow-level artifact registry
  artifactFolders?: string[];                 // Explicitly created empty folders
  layout?: Record<string, { x: number; y: number }>; // Saved node positions
}
```

## Artifact References

Inputs and outputs accept two forms:

**Plain string** — just the filename:
```json
{ "inputs": ["contract.pdf"], "outputs": ["clauses_parsed.json"] }
```

**Full ArtifactSchema** — structured metadata:
```json
{
  "inputs": ["contract.pdf"],
  "outputs": [
    {
      "name": "clauses_parsed.json",
      "format": "json",
      "description": "Structured clause data extracted from the contract",
      "fields": [
        { "key": "clauses", "type": "array", "description": "Parsed clause objects", "required": true },
        { "key": "total_clauses", "type": "number", "description": "Total clause count" }
      ]
    }
  ]
}
```

Both forms are valid anywhere an `ArtifactRef` is expected. Use `artifactName()` to normalize to just the filename.

### Flow-Level Artifact Registry

You can define schemas once at the flow level and reference artifacts by name in node configs:

```json
{
  "artifacts": {
    "clauses_parsed.json": {
      "name": "clauses_parsed.json",
      "format": "json",
      "description": "Structured clause data",
      "fields": [
        { "key": "clauses", "type": "array", "description": "Parsed clause objects" },
        { "key": "total_clauses", "type": "number", "description": "Total clause count" }
      ]
    }
  },
  "nodes": [
    {
      "id": "parse_input",
      "config": {
        "outputs": ["clauses_parsed.json"]
      }
    }
  ]
}
```

When a node references `"clauses_parsed.json"` by string, the validator and compiler look up the full schema from `flow.artifacts`. Inline schemas on a node take precedence over registry entries.

## Validation Rules

### Nodes
- `id` must be unique across all nodes (including children at all depths)
- `id` must match `[a-z][a-z0-9_]*` (snake_case)
- `type` must be one of: `"agent"`, `"checkpoint"`
- `instructions` must be non-empty for all nodes
- `config.inputs` — each entry must either:
  - Exist in `input/` (user upload), OR
  - Be declared as an `output` of a prior node (by edge order)
- `config.outputs` — each entry must be unique across the entire flow
- `config.skills` — each entry must be a valid skill directory name
- `children` — only `agent` nodes may have children; `checkpoint` nodes must have `children: []`

### Edges
- `from` and `to` must reference valid top-level node IDs
- Edges must not create cycles (the graph must be a DAG)
- Every node except the first must have at least one incoming edge
- Every node except the last must have at least one outgoing edge

### Children (Subagents)

Children run within their parent's phase sandbox. By default, children with no sibling dependencies run concurrently (wave 0). The validator automatically computes **wave-based ordering** from sibling I/O:

- Children whose inputs depend on another child's outputs are placed in later waves
- Wave 0 = no sibling deps (concurrent), Wave N = depends on Wave N-1 outputs
- Cycles between sibling dependencies are rejected with `CHILD_CYCLE`
- No explicit annotation needed — computed from `config.inputs` and `config.outputs`

Example: if child A outputs `analysis.json` and child B inputs `analysis.json`, B runs in wave 1 (after A's wave 0 completes).

Each child must have distinct output files (no overlapping outputs). Children inherit global skills + parent's skills unless they override.

### Budget
- Flow-level budget is required
- Node-level budget is optional but recommended
- Sum of node budgets should not exceed flow-level budget (warning, not error)

### Validation Pipeline

The validator uses a **pluggable rule pipeline** with 11 rules in 4 categories:

| Category | Rules |
|----------|-------|
| Structural (6) | node-id-format, node-id-unique, edge-validity, dag-acyclic, connectivity, node-type-rules |
| Type System (2) | output-uniqueness, schema-compatibility |
| Dataflow (1) | dependency-resolution |
| Resource (1) | budget-check |
| Runtime (1) | interrupt-validity |

Rules declare dependencies on other rules and are topologically sorted. If a rule's dependency fails, it is skipped. Use `validateFlowDetailed()` for per-rule introspection.

## File Conventions

### Input Files
- Placed in `workspace/input/` by the engine before the phase runs
- Referenced in node configs as just the filename: `"corrections_letter.png"`
- The execution engine resolves to full path: `workspace/input/corrections_letter.png`

### Output Files
- Written by agents to `workspace/output/`
- Referenced as just the filename: `"corrections_parsed.json"`
- Resolves to: `workspace/output/corrections_parsed.json`
- All nodes share the same output directory (flat namespace)

### Naming Conventions
- JSON data files: `snake_case.json`
- Markdown deliverables: `snake_case.md`
- Binary outputs: `snake_case.{ext}`

## Node Type Details

### Agent Node

An agent node runs Claude with the given instructions and skills. If it has children, Claude spawns subagents for each child.

```json
{
  "id": "parse_input",
  "type": "agent",
  "name": "Parse Corrections Letter",
  "instructions": "Read the corrections letter visually. Extract each correction item as a structured JSON object. Preserve exact original wording.",
  "config": {
    "inputs": ["corrections_letter.png"],
    "outputs": ["corrections_parsed.json"],
    "skills": [],
    "budget": { "maxTurns": 20, "maxBudgetUsd": 2.00 },
    "estimatedDuration": "30s"
  },
  "children": []
}
```

### Agent Node with Children (Parallel Subagents)

```json
{
  "id": "research",
  "type": "agent",
  "name": "Research Phase",
  "instructions": "Coordinate parallel research subagents. Each writes its own output file. After all complete, verify files exist.",
  "config": {
    "inputs": ["corrections_parsed.json"],
    "outputs": ["law_findings.json", "city_findings.json", "doc_observations.json"],
    "skills": ["california-adu", "adu-city-research"],
    "budget": { "maxTurns": 100, "maxBudgetUsd": 15.00 },
    "estimatedDuration": "90s"
  },
  "children": [
    {
      "id": "research_law",
      "type": "agent",
      "name": "Law Researcher",
      "instructions": "Look up every code section cited in corrections...",
      "config": {
        "inputs": ["corrections_parsed.json"],
        "outputs": ["law_findings.json"],
        "skills": ["california-adu"],
        "budget": { "maxTurns": 30, "maxBudgetUsd": 3.00 }
      },
      "children": []
    },
    {
      "id": "research_city",
      "type": "agent",
      "name": "City Researcher",
      "instructions": "Run WebSearch to find city-specific rules...",
      "config": {
        "inputs": ["corrections_parsed.json"],
        "outputs": ["city_findings.json"],
        "skills": ["adu-city-research"],
        "budget": { "maxTurns": 20, "maxBudgetUsd": 2.00 }
      },
      "children": []
    },
    {
      "id": "research_docs",
      "type": "agent",
      "name": "Document Viewer",
      "instructions": "Read referenced document pages visually...",
      "config": {
        "inputs": ["corrections_parsed.json"],
        "outputs": ["doc_observations.json"],
        "skills": [],
        "budget": { "maxTurns": 25, "maxBudgetUsd": 3.00 }
      },
      "children": []
    }
  ]
}
```

### Agent Node with Artifact Schemas

```json
{
  "id": "parse_input",
  "type": "agent",
  "name": "Parse Contract",
  "instructions": "Read the contract and extract structured clause data.",
  "config": {
    "inputs": ["contract.pdf"],
    "outputs": [
      {
        "name": "clauses_parsed.json",
        "format": "json",
        "description": "Structured clause data from the contract",
        "fields": [
          { "key": "clauses", "type": "array", "description": "Array of clause objects", "required": true },
          { "key": "defined_terms", "type": "array", "description": "List of defined terms" },
          { "key": "total_clauses", "type": "number", "description": "Total clause count" }
        ]
      }
    ],
    "skills": [],
    "budget": { "maxTurns": 25, "maxBudgetUsd": 3.00 }
  },
  "children": []
}
```

### Checkpoint Node

```json
{
  "id": "human_review",
  "type": "checkpoint",
  "name": "Expert Review",
  "instructions": "Present categorized items and questions to the user. Show breakdown: auto-fixable, needs input, needs professional.",
  "config": {
    "inputs": ["categorized.json", "questions.json"],
    "outputs": ["answers.json"],
    "skills": [],
    "presentation": {
      "title": "Phase 1 Complete — Analysis",
      "sections": ["questions", "auto_fixable", "professional"]
    }
  },
  "children": []
}
```

## Compilation Pipeline

The engine does **not** compile the entire FLOW.json into a single document. Instead, it uses a **staged IR pipeline** to compile a per-phase prompt for each node:

```
FlowGraph → resolvePhaseIR() → PhaseIR → generateMarkdown() → markdown
```

1. **Build FlowGraph**: The validator builds a symbol table from the FlowDefinition — one pass, O(N+E). This is the single source of truth consumed by all downstream passes.
2. **Topological sort**: Nodes are ordered by edge dependencies.
3. **Resolve PhaseIR**: For each node, `resolvePhaseIR(node, graph)` produces a structured intermediate representation (`AgentPhaseIR` or `CheckpointIR`) containing resolved inputs with source attribution, outputs, skills, budget, children with wave assignments, and interrupt configuration.
4. **Generate markdown**: `generateMarkdown(ir)` converts the IR into the executable per-phase prompt. Wave-aware: single wave = "Launch All N Concurrently", multiple waves = wave-by-wave with wait instructions.
5. **Per-child prompt files**: For nodes with children, `compileChildPrompts(nodeId, graph)` generates individual prompt files in `workspace/prompts/`. The parent prompt gets a reference table. Each child file is self-contained.
6. **Checkpoint nodes**: Handled directly by the engine (serialize state, pause for user input) — no agent run needed.
7. **State between phases**: After each phase completes, outputs are collected from the sandbox and saved to the state store. The sandbox is torn down. The next phase gets a fresh sandbox with only its declared inputs.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full execution model, sandbox lifecycle, state store design, and interrupt system.

## How the UI Creates FLOW.json

The ForgeFlow IDE maintains a `FlowDefinition` in memory via `FlowContext` (a React `useReducer`). Every UI action dispatches to the reducer:

| UI Action | Reducer Action | Effect on FLOW.json |
|-----------|---------------|---------------------|
| Add node on DAG canvas | `ADD_NODE` | New entry in `nodes[]` |
| Draw edge between nodes | `ADD_EDGE` | New entry in `edges[]` |
| Edit instructions in AgentEditor | `UPDATE_NODE` | Updates `node.instructions` |
| Modify config in ConfigBottomPanel | `UPDATE_NODE` | Updates `node.config.*` |
| Add sub-agent | `ADD_CHILD` | New entry in `node.children[]` |
| Create agent from slash command | `CREATE_AGENT_BY_NAME` | New node + edge |
| Delete node | `REMOVE_NODE` | Removes from `nodes[]` and `edges[]` |
| Add artifact schema | `ADD_ARTIFACT` | New entry in `flow.artifacts` |
| Update artifact schema | `UPDATE_ARTIFACT` | Updates `flow.artifacts[name]` |

The `ProjectStore` persists the flow via the server API. Auto-save triggers 800ms after changes. The same FLOW.json format can be hand-edited or produced by the CLI — the visual editor is one way to create it, not the only way.
