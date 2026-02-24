# ForgeFlow Product Specification

## Overview

ForgeFlow is an open-source platform for building long-running AI agent workflows. Users define multi-phase flows visually (or in JSON/markdown), and the execution engine runs them via Claude Agent SDK with file-based state passing, parallel subagents, and human-in-the-loop checkpoints.

## Target Users

**Two layers:**

1. **Domain experts** (primary) — Tax accountants, lawyers, compliance officers, permit consultants. They understand their domain deeply but don't write code. They use the visual flow designer to build workflows, upload domain knowledge as skill reference files, and test flows with sample data.

2. **Power users / engineers** (secondary) — Can drop into raw markdown/JSON at any point. Edit FLOW.json directly, write SKILL.md files by hand, extend the execution engine.

Both users share the same platform — the visual layer generates the same FLOW.json and SKILL.md that power users edit directly.

## The Three Primitives

### 1. Skill

A reusable package of domain knowledge + routing logic.

```
skill-name/
├── SKILL.md          ← Instructions: how to use this knowledge
├── references/       ← Domain knowledge files (markdown)
└── scripts/          ← Optional deterministic code
```

Skills are **standalone**. They live in a library. Multiple flows can reference the same skill. A "California Tax Code" skill can be used by both a "Tax Prep" flow and a "Tax Audit" flow.

In MVP, users create skills manually as markdown directories. (Visual skill editor is a later feature.)

### 2. Node

A unit of work in a flow. Three types:

| Type | Purpose | Example |
|------|---------|---------|
| **Agent** | Claude executes instructions with loaded skills | "Parse the corrections letter and extract each item" |
| **Checkpoint** | Flow pauses, presents data to user, waits for input | "Show questions to contractor, wait for answers" |
| **Merge** | Collects outputs from parallel children | "Combine research from 3 subagents into one file" |

Each node has:
- **Structured config**: input files, output files, skills to load, budget
- **Instructions**: free-text natural language
- **Children** (optional): sub-nodes that run inside this node (recursive sub-tree)

### 3. Flow

A DAG (directed acyclic graph) of nodes.

```
flow-name/
├── FLOW.json         ← DAG definition (nodes, edges, config)
└── skills/           ← References to skill directories used by nodes
```

Note: There is no single generated `FLOW.md`. The engine compiles a **per-phase prompt** for each node as it executes. Each phase gets only its instructions, inputs, skills, and budget — not the entire flow.

## The Recursive Node Model

Nodes can contain sub-trees. The canvas shows a linear flow of top-level nodes. **Double-click any node** to zoom into its internal structure — parallel children, merge nodes, nested sub-flows.

```
Top-level canvas:
[Parse Input] → [Research (3 kids)] → [⛔ Review] → [Generate]

Click into "Research":
┌─────────────────────────────────────────┐
│  Research (parent)                      │
│  ┌────────┐  ┌────────┐  ┌────────┐   │
│  │State   │  │City    │  │Doc     │   │
│  │Law     │  │Rules   │  │Viewer  │   │
│  └───┬────┘  └───┬────┘  └───┬────┘   │
│      └───────────┼───────────┘         │
│           ┌──────▼──────┐              │
│           │   Merge     │              │
│           └─────────────┘              │
└─────────────────────────────────────────┘
```

Children run **in parallel** by default. The merge node collects their outputs before the parent continues.

## Flow Designer UI

### Layout

- **Left sidebar**: Node palette (drag to add), skill library browser
- **Center**: DAG canvas with nodes and edges
- **Right sidebar**: Node inspector (config form + instructions editor)

### Node Inspector (Right Sidebar)

```
┌─────────────────────────────────┐
│  Parse Corrections Letter       │
│  ────────────────────────────── │
│  Type: [Agent ▼]                │
│                                 │
│  ── Inputs ──                   │
│  [corrections_letter.png] [+]   │
│                                 │
│  ── Outputs ──                  │
│  [corrections_parsed.json] [+]  │
│                                 │
│  ── Skills ──                   │
│  [california-adu]          [+]  │
│                                 │
│  ── Budget ──                   │
│  Max turns: [20]                │
│  Max cost:  [$2.00]             │
│  Est. time: [30s]               │
│                                 │
│  ── Instructions ──             │
│  ┌─────────────────────────────┐│
│  │ Read the corrections letter ││
│  │ visually. Extract each...   ││
│  └─────────────────────────────┘│
│                                 │
│  [▼ Advanced: Output Schema]    │
│  [▼ Advanced: Raw Markdown]     │
└─────────────────────────────────┘
```

### Power User Mode

The "Advanced: Raw Markdown" section shows the generated prompt for this node. Power users can edit it directly. The visual form is the primary interface; the markdown is the escape hatch.

### Run Panel

- **Run button** with file upload area
- **Live progress**: which node is executing, agent messages streaming
- **State inspector**: click any completed node to view its output files
- **Cost meter**: running total of turns + dollars

## Execution Flow

1. User designs flow in the visual editor → saves `FLOW.json`
2. User uploads input files
3. User clicks "Run"
4. **Engine** reads `FLOW.json`, topologically sorts nodes, begins per-phase execution:
   - For each node: compile a per-phase prompt → spin up sandbox → run agent → collect outputs → serialize to state store → tear down sandbox
5. Each phase gets its own sandbox with **only the skills and inputs it needs**
6. State is serialized between **every** phase (not just checkpoints)
7. At checkpoints: engine pauses (no sandbox running, zero cost), shows data to user, waits for input
8. After user input: engine creates a new sandbox for the next phase with all prior outputs + user answers
9. On completion: all artifacts are in the state store, frontend shows results

The key insight: **the engine orchestrates between phases, Claude orchestrates within a phase** (spawning subagents via the Task tool for nodes with children).

## State Management

State is serialized to a **state store** between every phase — not just at checkpoints.

**Within a phase** (inside a sandbox):
```
workspace/
├── input/           ← Files copied from state store (user uploads + prior phase outputs)
├── output/          ← Agent writes here
└── skills/          ← Only skills this phase needs
```

**Between phases** (in the state store):
```
~/.forgeflow/runs/{runId}/          ← Local (MVP)
├── state.json                      ← Run metadata, status, cost tracking
├── checkpoint.json                 ← Checkpoint data (if paused)
├── inputs/                         ← User-uploaded files
└── artifacts/                      ← All phase outputs (accumulated)
    ├── clauses_parsed.json         ← From Phase 1
    ├── liability_findings.json     ← From Phase 2
    └── ...
```

Every node declares its `inputs` and `outputs`. The engine resolves inputs from user uploads + prior phase outputs in the state store, and copies only those files into the new sandbox.

This means:
- **Checkpoints are free** — no sandbox running while waiting for user input
- **Fault recovery** — if Phase 3 fails, all Phase 1-2 outputs are safe in the state store. Retry just Phase 3.
- **Resource savings** — each phase loads only the skills it declares, keeping context windows small
- **Cloud-ready** — swap the state store adapter from local disk to Postgres + S3

## Sandbox Isolation

Every agent phase runs in an isolated sandbox:

| Environment | Sandbox Technology | Notes |
|-------------|-------------------|-------|
| **Local (MVP)** | Docker container | Per-phase container with mounted workspace |
| **Cloud** | Vercel Sandbox / Firecracker VM | API-managed, per-phase lifecycle |

The sandbox provides:
- **File isolation** — agents can only read/write within their workspace
- **Process isolation** — agents can't affect the host or other runs
- **Clean state** — each phase starts with a fresh filesystem containing only its declared inputs and skills
- **Security** — especially important since agents execute code (Bash tool, scripts)

## Interrupt System — Human Input at Any Depth

Agents can request human input **during execution** — not just at checkpoint boundaries. Interrupts fire from any depth in the recursive node tree and stream to the frontend in real-time.

### Five Interrupt Types

| Type | Purpose | Example |
|------|---------|---------|
| **Approval** | Binary go/no-go gate | "Ready to generate 3 deliverables. Approve?" |
| **Q&A** | Structured questions with typed inputs | "What's the existing drain pipe size? (3", 4", 6")" |
| **Selection** | Pick from a list with recommendations | "8 clauses flagged. Which ones to negotiate?" |
| **Review & Edit** | Present a draft for human editing | "Draft response letter — review before sending" |
| **Escalation** | Flag a finding for specialist attention | "Uncapped liability clause — partner review recommended" |

### Interrupt Modes

**Inline mode (default):** Agent pauses in place, sandbox stays alive. Best for quick questions (under 5 minutes). The agent writes an interrupt signal file, then polls for an answer file. Other subagents continue running.

**Checkpoint mode:** Full serialization, sandbox torn down, zero cost while waiting. Best for long reviews, overnight approvals, multi-person routing.

**Auto-escalate (the smart default):** Starts as inline. If the human doesn't respond within a configurable timeout (default 5 minutes), the engine automatically converts to checkpoint mode — serializes state, tears down the sandbox, and the human can take unlimited time. This gives fast responses when the human is present, and zero cost when they're not.

### How Interrupts Work

```
Agent writes output/__INTERRUPT__{id}.json
  → Engine detects via filesystem watcher (bidirectional sandbox channel)
  → Engine streams interrupt to frontend immediately
  → Agent enters poll loop: checks for output/__ANSWER__{id}.json every 5s
  → Human answers on frontend
  → Engine writes __ANSWER__{id}.json into sandbox
  → Agent reads answer, continues
```

When a subagent interrupts, its siblings continue running. If all siblings finish and the interrupt is still pending, only the interrupted agent is idle.

See [INTERRUPTS.md](INTERRUPTS.md) for the full interrupt type system, TypeScript interfaces, nested interrupt protocol, and resume manifests.

## Flow Validator — Catch Errors Before Runtime

Before any phase runs, the engine validates the entire FLOW.json — like a compiler's type-checking pass. This catches errors at design time, not runtime.

**Structural checks:**
- DAG validation (no cycles)
- All node IDs unique (including nested children)
- All edges reference valid node IDs
- No orphan or dead-end nodes
- Only agent nodes have children
- Checkpoint nodes have `presentation` config

**Dependency resolution (the critical check):**
- Every input file must trace back to a source — either a user upload or a prior node's output
- Helpful error messages with closest-match suggestions

**Budget checks:**
- Sum of node budgets vs. flow budget (warning if exceeded)
- Oversized budgets for simple tasks (hint)

**Interrupt validation:**
- Review interrupts reference files that actually exist
- Depth-2+ interrupts have interrupt-aware parent instructions (warning)

**Output:** If valid, the validator produces an `ExecutionPlan` with resolved execution order, fully resolved skill dependencies, estimated costs, and critical path analysis.

## Bidirectional Sandbox Channel

The sandbox is not a black box that produces output at the end. It has a **live, bidirectional filesystem channel** with the engine throughout execution.

```
Engine ←→ mounted volume / filesystem watcher ←→ Sandbox
  │                                                  │
  ├── watches output/ for new files                  ├── agent writes output files
  ├── watches for __INTERRUPT__*.json                ├── agent writes interrupt signals
  ├── writes __ANSWER__*.json into sandbox           ├── agent polls for answer files
  └── reads cost/progress in real-time               └── agent logs to stdout
```

This enables:
- **Real-time interrupt streaming** — questions appear the moment an agent writes them
- **Inline agent pausing** — agent polls for an answer while context stays alive
- **Progressive output collection** — completed files stream to the state store immediately, not at phase end
- **Live monitoring** — cost, progress, and tool calls visible in real-time

**Implementation:** Locally, Docker mounted volumes + `fs.watch()`/chokidar. In cloud, filesystem polling API or webhook on file write events.

## Progressive Output Streaming

Output files stream to the state store **as they're written**, not just at phase end.

```
t=5s   city_findings.json written    → copied to state store immediately
t=8s   __INTERRUPT__law.json written → streamed to frontend immediately
t=12s  doc_observations.json written → copied to state store immediately
t=20s  law_findings.json written     → copied to state store immediately
```

Benefits:
- **Fault recovery** — if sandbox crashes at t=15s, city + doc findings are already safe
- **Real-time visibility** — frontend shows partial results as they arrive
- **Future pipelining** — next phase could theoretically start on partial inputs (not MVP)

## Budget System

Every flow and every node has budget constraints:

```json
{
  "budget": {
    "maxTurns": 500,
    "maxBudgetUsd": 50.00,
    "timeoutMs": 1800000
  }
}
```

- **maxTurns**: Maximum API round-trips before stopping
- **maxBudgetUsd**: Maximum dollar cost before stopping
- **timeoutMs**: Wall-clock timeout

The Agent SDK enforces these. If the budget is exceeded, the agent stops gracefully.

## MVP Deliverables

| # | Component | Status |
|---|-----------|--------|
| 1 | **FLOW.json format spec** — TypeScript types, validation rules | Done |
| 2 | **Flow validator** — Compiler-style type checking (dependency resolution, cycle detection, budget checks, interrupt validation) | Done |
| 3 | **Phase compiler** — Node config → per-phase markdown prompt + per-child prompt files | Done |
| 4 | **Execution engine** — Per-phase orchestration with execute + resume | Done |
| 5 | **Sandbox manager** — Docker container per phase (local MVP) | Done |
| 6 | **Bidirectional sandbox channel** — Filesystem watcher for real-time interrupts + progressive output streaming | Done |
| 7 | **State store** — Serialize artifacts between phases (local disk for MVP) | Done |
| 8 | **Checkpoint manager** — Pause at checkpoint + resume with user input | Done |
| 9 | **5 interrupt types** — Approval, Q&A, selection, review, escalation with inline + checkpoint + auto-escalate modes | Done |
| 10 | **Skill resolver** — Load SKILL.md + references from disk, search path resolution | Done |
| 11 | **CLI** — `forgeflow run` + `forgeflow resume` with mock/local/docker runners | Done |
| 12 | **Flow designer UI** — React app with DAG canvas, node inspector, recursive navigation | Not started |
| 13 | **Run viewer** — Real-time progress stream, interrupt panel, state inspector, cost tracking | Not started |

## What's NOT in MVP

- Visual skill editor (skills are manually written markdown directories)
- Marketplace / sharing / publishing
- Billing / usage tracking / metering
- Multi-tenant cloud hosting (architecture supports it — swap adapters)
- Multi-provider LLM support (Claude-only)
- Pipelining (starting next phase on partial inputs before current phase finishes)
- Interrupt routing to multiple users (MVP: single user answers all interrupts)
