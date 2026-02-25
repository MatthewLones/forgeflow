# FLOW.json Format Specification

## Overview

A `FLOW.json` file defines a complete agent workflow as a directed acyclic graph (DAG) of nodes. The execution engine reads this DAG and executes it **phase-by-phase** — each top-level node gets its own sandboxed agent run with a per-phase compiled prompt. State is serialized to a state store between every phase.

## TypeScript Types

```typescript
// --- Node Types ---

type NodeType = "agent" | "checkpoint" | "merge";

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
  inputs: string[];          // Files this node reads (relative to workspace)
  outputs: string[];         // Files this node produces (relative to output/)
  skills: string[];          // Skill names to load for this node
  budget?: NodeBudget;       // Per-node budget (optional if using flow-level budget)
  estimatedDuration?: string; // Human-readable estimate: "30s", "2min", "5min"
  presentation?: CheckpointPresentation; // Only for checkpoint nodes
  interrupts?: InterruptConfig[];        // Interrupt types this node may fire (optional)
}

interface FlowNode {
  id: string;                // Unique identifier (snake_case)
  type: NodeType;            // "agent", "checkpoint", or "merge"
  name: string;              // Display name on canvas
  instructions: string;      // Free-text: what the agent should do
  config: NodeConfig;
  children: FlowNode[];      // Sub-nodes (run in parallel inside this node)
}

// --- Edge ---

interface FlowEdge {
  from: string;              // Source node ID
  to: string;                // Target node ID
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
}
```

## Validation Rules

### Nodes
- `id` must be unique across all nodes (including children at all depths)
- `id` must match `[a-z][a-z0-9_]*` (snake_case)
- `type` must be one of: `"agent"`, `"checkpoint"`, `"merge"`
- `instructions` must be non-empty for `agent` and `checkpoint` nodes
- `config.inputs` — each entry must either:
  - Exist in `input/` (user upload), OR
  - Be declared as an `output` of a prior node (by edge order)
- `config.outputs` — each entry must be unique across the entire flow
- `config.skills` — each entry must be a valid skill directory name
- `children` — only `agent` nodes may have children; `checkpoint` and `merge` must have `children: []`

### Edges
- `from` and `to` must reference valid top-level node IDs
- Edges must not create cycles (the graph must be a DAG)
- Every node except the first must have at least one incoming edge
- Every node except the last must have at least one outgoing edge

### Children (Parallel Subagents)
- Children of a node run in **parallel** by default
- Each child must have distinct output files (no overlapping outputs)
- A child's inputs must come from the parent's inputs or prior phases
- Children inherit global skills + parent's skills unless they override

### Budget
- Flow-level budget is required
- Node-level budget is optional but recommended
- Sum of node budgets should not exceed flow-level budget (warning, not error)

## File Conventions

### Input Files
- Placed in `workspace/input/` by the user before running
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
- Checkpoint signal: `__CHECKPOINT__.json` (reserved, transient)

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

### Merge Node

A merge node is implicit when a parent has children — the parent itself acts as the merge point. Explicit merge nodes are for complex cases where you need custom merge logic.

```json
{
  "id": "merge_research",
  "type": "merge",
  "name": "Merge Research Results",
  "instructions": "Read all research output files. Cross-reference findings. Produce a unified categorization.",
  "config": {
    "inputs": ["law_findings.json", "city_findings.json", "doc_observations.json"],
    "outputs": ["categorized.json"],
    "skills": [],
    "budget": { "maxTurns": 40, "maxBudgetUsd": 5.00 }
  },
  "children": []
}
```

## Compilation Rules

The engine does **not** compile the entire FLOW.json into a single document. Instead, it compiles a **per-phase prompt** for each node as it's about to execute:

1. **Topological sort**: Nodes are ordered by edge dependencies
2. **Per-phase prompt**: Each node gets its own focused markdown prompt containing:
   - The node's instructions
   - Input file declarations (resolved from state store)
   - Output file declarations (what the agent must produce)
   - Budget constraints for this phase
   - Skills available (only those declared for this node + global skills)
3. **Nodes with children**: The per-phase prompt includes subagent instructions — Claude spawns them via the Task tool within the same sandbox
4. **Checkpoint nodes**: The engine handles these directly (serialize state, pause for user input) — no agent run needed
5. **State between phases**: After each phase completes, outputs are collected from the sandbox and saved to the state store. The sandbox is torn down. The next phase gets a fresh sandbox with only its declared inputs.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full per-phase compilation algorithm, sandbox lifecycle, state store design, and interrupt system (all 5 types, inline/checkpoint/auto-escalate modes).

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

The `ProjectStore` persists the flow. The same FLOW.json format can be hand-edited or produced by the CLI — the visual editor is one way to create it, not the only way.
