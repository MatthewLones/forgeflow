# ForgeFlow Architecture

## Core Principle: Per-Phase Execution

ForgeFlow does **not** compile the entire flow into one giant prompt. Instead, the execution engine orchestrates phase-by-phase — each top-level node gets its own agent run in its own sandbox, with only the skills and inputs it needs.

```
FLOW.json → Engine reads DAG → For each phase:
  1. Compile per-phase prompt (node instructions + inputs + skills)
  2. Spin up sandbox
  3. Run agent (Agent SDK query())
  4. Collect outputs → serialize to state store
  5. Tear down sandbox
  6. Next phase (or checkpoint pause)
```

This gives us:
- **Clean context windows** — each phase starts fresh, no accumulated token debt
- **Resource savings** — Phase 1 (parsing) doesn't load the 28-file legal skill; Phase 2 (research) does
- **Natural serialization** — state is saved between every phase, not just at checkpoints
- **Fault isolation** — if Phase 2 fails, retry just Phase 2 (all Phase 1 outputs are safe in the state store)
- **Sandboxing** — each agent runs in isolation with only file system access to its workspace

## ForgeFlow as a Language

ForgeFlow is a domain-specific language for agent orchestration. This framing clarifies every architectural decision:

| Language Concept | ForgeFlow Equivalent |
|-----------------|---------------------|
| Source code | FLOW.json |
| IDE / Editor | Visual designer (React IDE with DAG canvas + agent editor) |
| Type checker / linter | Flow Validator (dependency resolution, schema matching, structural checks) |
| Compiler | Phase Compiler (node config → executable per-phase prompt) |
| Linker | Skill Dependency Resolver (resolves sub-skill trees) |
| Runtime / VM | Execution Engine (per-phase orchestrator) |
| Process / address space | Sandbox (Docker container or Vercel Sandbox) |
| Memory / heap | State Store (artifacts between phases) |
| System calls / signals | Interrupts (approval, Q&A, selection, review, escalation) |
| IPC / pipes | Bidirectional Sandbox Channel (filesystem watcher) |
| Libraries / imports | Skills (SKILL.md + references/) |
| Debugger | State Inspector + interrupt trace |
| stdout / stderr | Progress Streamer |

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Visual IDE (React 19 + Vite 6)                                     │
│  ┌──────────┬─────────────────────────────────────┬────────────┐    │
│  │  Agent   │  DagMiniView (React Flow canvas)    │  Forge AI  │    │
│  │ Explorer │  with breadcrumb drill-down          │  Copilot   │    │
│  │  (tree)  ├─────────────────────────────────────┤  (Claude-  │    │
│  │          │  EditorLayout (dockview-react)       │  powered)  │    │
│  │ Agents   │  AgentEditor │ SkillEditor │ RefView │            │    │
│  │ Skills   │  with ConfigBottomPanel              │            │    │
│  │ Refs     │  (I/O, Budget, Skills, Interrupts)   │            │    │
│  └──────────┴─────────────────────────────────────┴────────────┘    │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ saves FLOW.json, triggers runs
┌──────────────────▼───────────────────────────────────────────────────┐
│  Execution Engine (Node.js)                                          │
│  - Flow Validator: compiler-style type checking on FLOW.json         │
│  - Phase Compiler: node config → per-phase prompt + child prompts    │
│  - Sandbox Manager: create/teardown Docker containers per phase      │
│  - Agent Runner: prompt → Agent SDK query()                          │
│  - State Store: serialize between phases                             │
│  - Checkpoint Manager: pause/resume at boundaries                    │
│  - InterruptWatcher: real-time interrupt + output streaming          │
│  - Progress Streamer: events → frontend                              │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ creates/manages
┌──────────────────▼───────────────────────────────────────────────────┐
│  Sandbox (one per phase)                                             │
│  ┌────────────────────────────────────────────┐                      │
│  │  workspace/                                │                      │
│  │  ├── input/   ← from state store           │                      │
│  │  ├── output/  ← agent writes here          │                      │
│  │  ├── skills/  ← only this phase's skills   │                      │
│  │  └── prompts/ ← per-child prompt files     │                      │
│  │  Claude Agent SDK + per-phase prompt        │                      │
│  └────────────────────────────────────────────┘                      │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ reads/writes
┌──────────────────▼───────────────────────────────────────────────────┐
│  State Store                                                         │
│  Local:  ~/.forgeflow/runs/{id}/ on disk                             │
│  Cloud:  Postgres + S3/object storage                                │
└──────────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### The Three Primitives

**Skill** — A reusable package of domain knowledge + routing logic:
```
skill-name/
├── SKILL.md          ← Instructions: how to use this knowledge
├── references/       ← Domain knowledge files (markdown)
└── scripts/          ← Optional deterministic code
```

Skills are standalone. Multiple flows can reference the same skill. A "California Tax Code" skill can be used by both a "Tax Prep" flow and a "Tax Audit" flow. Skills compose other skills — a skill's `SKILL.md` can reference sub-skills. See [SKILL-FORMAT.md](SKILL-FORMAT.md).

**Node** — A unit of work in a flow. Three types:

| Type | Purpose | Example |
|------|---------|---------|
| **Agent** | Claude executes instructions with loaded skills | "Parse the contract and extract each clause" |
| **Checkpoint** | Flow pauses, presents data to user, waits for input | "Show risk analysis to attorney, wait for decisions" |
| **Merge** | Collects outputs from parallel children | "Combine research from 3 subagents" |

Each node has structured config (inputs, outputs, skills, budget) plus free-text instructions. Nodes can contain recursive sub-trees.

**Flow** — A DAG of nodes defined in `FLOW.json`. See [FLOW-FORMAT.md](FLOW-FORMAT.md).

### The Recursive Node Model

Nodes can contain sub-trees. The DAG canvas shows a linear flow of top-level nodes. Double-click any node to zoom into its internal structure — parallel children, nested sub-flows.

```
Top-level DAG:
[Parse Input] → [Research (3 kids)] → [⛔ Review] → [Generate]

Drill into "Research":
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

Children run in parallel by default. Parent nodes declare all children's outputs in their own `config.outputs`.

---

## Execution Model

### Phase Compiler

**Input:** A single `FlowNode` from `FLOW.json` + resolved inputs from the state store
**Output:** A per-phase markdown prompt that Claude follows for one phase

The compiler generates a focused prompt for each node as it's about to execute:

```markdown
# Phase: Parse Contract

You are executing one phase of a ForgeFlow workflow.

## Your Task
Read the contract PDF. Extract every clause as a structured object with:
clause number, title, full text, clause type. Identify all defined terms.

## Input Files
- input/contract.pdf

## Output Files (you MUST produce these)
- output/clauses_parsed.json

## Budget
- Max turns: 25
- Max cost: $3.00

## Rules
- Write all output files to the output/ directory
- Read input files from the input/ directory
- Verify each output file exists before finishing
- Stay within budget constraints
```

#### Per-Child Prompt Files

When a node has children, the compiler generates **per-child prompt files** instead of inlining all child instructions into the parent prompt. This keeps token usage O(n) per nesting level instead of O(n^depth).

The parent prompt gets a reference table:

```markdown
## Subagents — Launch All Concurrently

| Child | Prompt File | Outputs |
|-------|-------------|---------|
| Liability Analyst | prompts/analyze_liability.md | output/liability_findings.json |
| IP Analyst | prompts/analyze_ip.md | output/ip_findings.json |
| Termination Analyst | prompts/analyze_termination.md | output/termination_findings.json |

Launch all subagents concurrently using the Task tool. Pass each the contents of its prompt file.
After all complete, verify all output files exist.
```

Each child prompt file is self-contained with its own instructions, inputs, outputs, budget, and skills. If a child has its own children, those are referenced the same way — prompt files all the way down.

Workspace layout:
```
workspace/
├── input/              ← Files from state store
├── output/             ← Agent writes here
├── skills/             ← Only skills this phase needs
└── prompts/            ← Per-child prompt files (if node has children)
    ├── analyze_liability.md
    ├── analyze_ip.md
    └── analyze_termination.md
```

Subagents run **within** a phase (inside the same sandbox), spawned by Claude via the Task tool. Phase boundaries are managed by the engine.

### Flow Validator

Before any phase runs, the engine validates the entire FLOW.json — like a compiler's type-checking pass. This catches errors at design time, not runtime.

```typescript
interface ValidationResult {
  valid: boolean;
  errors: FlowDiagnostic[];     // Fatal — can't run
  warnings: FlowDiagnostic[];   // Suspicious — will run but might fail
  suggestions: FlowDiagnostic[];// Optimization hints
  executionPlan: ExecutionPlan;  // Resolved execution order (if valid)
}
```

**Structural checks:** DAG validation (no cycles), unique node IDs (including nested children), valid edge references, orphan/dead-end detection, checkpoint nodes require `presentation` config, only agent nodes have children.

**Dependency resolution:** Every input file must trace back to a source — either a user upload or a prior node's output. Helpful error messages with closest-match suggestions.

**Budget checks:** Sum of node budgets vs. flow budget, oversized budgets for simple tasks.

**Interrupt validation:** Review interrupts reference existing files, depth-2+ interrupts have interrupt-aware parent instructions.

**Output:** If valid, produces an `ExecutionPlan` with resolved execution order, fully resolved skill dependencies, estimated costs, and critical path.

### Flow Orchestrator

The `FlowOrchestrator` coordinates all phases:

```typescript
class FlowOrchestrator {
  constructor(runner: AgentRunner, stateStore: StateStore, options?: OrchestratorOptions) {}

  // Execute a flow from the beginning
  async execute(flow: FlowDefinition, userUploads: StateFile[]): Promise<RunResult>;

  // Resume a paused flow after the user provides checkpoint input
  async resume(flow: FlowDefinition, runId: string, checkpointInput: { fileName: string; content: Buffer }): Promise<RunResult>;

  // Shared phase loop (used by both execute and resume)
  private async executePhases(ctx: ExecuteContext): Promise<RunResult>;
}
```

**Execute flow:** Validates FLOW.json → initializes run state → saves user uploads → calls `executePhases()` from phase 0.

**Resume flow:** Loads saved RunState (verifies `awaiting_input`) → loads CheckpointState → saves user's answer as artifact → finds checkpoint in execution plan → calls `executePhases()` from checkpoint+1 with accumulated cost.

**Phase loop** (simplified):
```typescript
for (const phase of executionPlan.phases) {
  if (node.type === 'checkpoint') {
    // Save checkpoint state, return { status: 'awaiting_input' }
  }

  // Compile prompt, resolve skills, prepare workspace
  const prompt = compilePhasePrompt(node, context);

  // Start InterruptWatcher if node has interrupts
  if (interruptHandler && nodeHasInterrupts(node)) {
    interruptWatcher = new InterruptWatcher();
    await interruptWatcher.start({ workspacePath, onInterrupt, onProgress, nodeId, escalateTimeoutMs });
  }

  // Run the agent
  const result = await runner.runPhase({ nodeId, prompt, workspacePath, budget });

  await interruptWatcher?.stop();

  // Check for auto-escalation (interrupt handler timed out)
  if (interruptWatcher?.escalated) {
    // Save outputs, create synthetic checkpoint, return { status: 'awaiting_input' }
  }

  // Collect outputs → state store → cleanup workspace
}
```

### Agent Runners

The `AgentRunner` interface abstracts how a phase prompt is executed:

```typescript
interface AgentRunner {
  runPhase(options: {
    nodeId: string;
    prompt: string;
    workspacePath: string;
    budget: { maxTurns: number; maxBudgetUsd: number };
    onProgress?: (event: ProgressEvent) => void;
  }): Promise<PhaseResult>;
}
```

| Runner | Use case | How it works |
|--------|----------|-------------|
| `MockRunner` | Testing | Writes predefined output files, returns configured costs. No API calls. |
| `ClaudeAgentRunner` | Local development | Runs Claude Agent SDK `query()` directly on the host. Uses `permissionMode: 'bypassPermissions'`. |
| `DockerAgentRunner` | Production (local) | Builds a Docker image with Claude Code CLI, runs agent inside a container with mounted workspace volume. |

### State Store

All artifacts between phases go through the state store — the single source of truth for a run's data.

```typescript
interface StateStore {
  savePhaseOutputs(runId: string, phaseId: string, files: StateFile[]): Promise<void>;
  loadPhaseInputs(runId: string, inputNames: string[]): Promise<StateFile[]>;
  saveRunState(runId: string, state: RunState): Promise<void>;
  loadRunState(runId: string): Promise<RunState | null>;
  saveCheckpoint(runId: string, checkpoint: CheckpointState): Promise<void>;
  loadCheckpoint(runId: string): Promise<CheckpointState | null>;
  saveCheckpointAnswer(runId: string, fileName: string, content: Buffer): Promise<void>;
  saveUserUploads(runId: string, files: StateFile[]): Promise<void>;
}
```

**Local implementation:** `~/.forgeflow/runs/{runId}/` — `state.json`, `checkpoint.json`, `uploads/`, `artifacts/`. All JSON and filesystem-backed.

**Cloud implementation** (deferred): Postgres for metadata + S3 for artifacts. Same interface, different adapter.

### Sandbox Manager

Each phase runs in an isolated Docker container:

```
┌────────────────────────────────────┐
│  Docker Container (Phase N)        │
│  ├── workspace/                    │
│  │   ├── input/   ← from state store           │
│  │   ├── output/  ← agent writes here          │
│  │   └── skills/  ← only skills this node needs│
│  ├── Claude Agent SDK              │
│  └── per-phase prompt (.md)        │
└────────────────────────────────────┘
```

Between phases, the engine reads outputs from the sandbox, writes them to the state store, destroys the container, creates a new one for the next phase, and copies needed files in.

### Bidirectional Sandbox Channel

The sandbox has a **live, bidirectional filesystem channel** with the engine — not just a snapshot at the end.

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

Implementation: Docker mounted volumes + chokidar filesystem watcher.

### Checkpoint Manager

Checkpoints are phase boundaries where the engine pauses for user input:

```
Normal phase boundary:     serialize outputs → immediately start next phase
Checkpoint phase boundary: serialize outputs → wait for user → start next phase
```

When the engine reaches a checkpoint node:
1. All prior phase outputs are already in the state store
2. Engine emits a `checkpoint` event to the frontend with data to present
3. Engine sets run status to `awaiting_input` and saves `CheckpointState`
4. **No sandbox running — zero cost while waiting**
5. User takes 5 minutes or 5 days — doesn't matter

To resume: `orchestrator.resume()` loads saved state, saves user's answer as an artifact, and continues from the next phase.

**Auto-escalated checkpoints:** When an inline interrupt handler times out, the `InterruptWatcher` writes an `EscalatedAnswer` and the orchestrator creates a synthetic checkpoint. Resume works identically.

### Progress Streamer

The engine emits rich events throughout execution:

```typescript
type ProgressEvent =
  | { type: 'phase_started'; nodeId: string; nodeName: string; phaseNumber: number }
  | { type: 'phase_completed'; nodeId: string; outputFiles: string[]; cost: number; missingOutputs?: string[] }
  | { type: 'phase_failed'; nodeId: string; error: string }
  | { type: 'checkpoint'; checkpoint: CheckpointState }
  | { type: 'interrupt'; interrupt: Interrupt }
  | { type: 'interrupt_answered'; interruptId: string; nodeId: string; escalated: boolean }
  | { type: 'child_started'; childId: string; childName: string; parentPath: string[] }
  | { type: 'child_completed'; childId: string; childName: string; parentPath: string[]; outputFiles: string[] }
  | { type: 'file_written'; fileName: string; fileSize: number; nodeId: string }
  | { type: 'escalation_timeout'; interruptId: string; nodeId: string; timeoutMs: number }
  | { type: 'resume'; runId: string; checkpointNodeId: string }
  | { type: 'cost_update'; turns: number; usd: number }
  | { type: 'run_completed'; success: boolean; totalCost: { turns: number; usd: number } }
  | { type: 'message'; content: string };
```

### State Machine

```
ready
  → phase_running (Phase 1)
    → phase_complete (Phase 1)
      → phase_running (Phase 2)
        → phase_complete (Phase 2)
          → awaiting_input (Checkpoint)
            → phase_running (Phase 3)
              → completed
              → failed
```

Each transition is written to the state store and emitted as a progress event.

---

## Interrupt System

Interrupts are how agents request human input during flow execution. They fire from any depth in the recursive node tree and stream to the human in real-time via the bidirectional sandbox channel.

### Five Interrupt Types

**1. Approval** — Binary decision gate. Agent presents what it plans to do, waits for go/no-go.

```json
{
  "type": "approval",
  "title": "Approve Deliverable Generation",
  "proposal": "Generate 3 deliverables: redlined contract, negotiation memo, risk summary.",
  "evidence": ["risk_matrix.json", "attorney_decisions.json"],
  "options": ["approve", "reject", "modify"]
}
```

**2. Q&A** — Structured questions with typed inputs (text, number, choice, boolean).

```json
{
  "type": "qa",
  "title": "Plumbing Questions",
  "questions": [
    { "id": "q_pipe_size", "label": "Existing drain pipe size?", "inputType": "choice", "options": ["3\"", "4\"", "6\""], "required": true },
    { "id": "q_fixture_count", "label": "Current fixture unit count?", "inputType": "number", "required": true }
  ]
}
```

**3. Selection** — Pick from a list with descriptions and recommendations.

```json
{
  "type": "selection",
  "title": "Select Clauses to Negotiate",
  "items": [
    { "id": "clause_7", "label": "§7 Indemnification (HIGH risk)", "recommended": true },
    { "id": "clause_12", "label": "§12 IP Assignment (HIGH risk)", "recommended": true },
    { "id": "clause_15", "label": "§15 Non-Compete (MEDIUM risk)", "recommended": false }
  ],
  "minSelect": 1
}
```

**4. Review & Edit** — Agent presents a draft for human editing.

```json
{
  "type": "review",
  "title": "Review Response Letter",
  "draftFile": "response_letter_draft.md",
  "format": "markdown",
  "instructions": "Check all corrections are addressed. Verify code citations."
}
```

**5. Escalation** — Flag a finding for specialist attention.

```json
{
  "type": "escalation",
  "title": "Uncapped Liability — Partner Review Recommended",
  "severity": "critical",
  "finding": "Unlimited indemnification in §7.2 with no cap or carve-outs.",
  "suggestedAction": "Escalate to partner before proceeding."
}
```

Full TypeScript interfaces for all interrupt types are defined in `@forgeflow/types`.

### Interrupt Modes

**Inline mode (default):** Agent pauses in place, polls for answer, sandbox stays alive. Other subagents continue running. Best for quick questions (under 5 minutes).

```
Agent writes __INTERRUPT__law_agent.json
  → Engine detects via filesystem watcher
  → Engine streams to frontend immediately
  → Agent polls for __ANSWER__law_agent.json every 5s
  → Human answers → Engine writes answer into sandbox
  → Agent reads answer, continues
```

**Checkpoint mode:** Full serialization, sandbox torn down, zero cost while waiting. Best for long reviews, overnight approvals.

**Auto-escalate (smart default):** Starts inline. If the human doesn't respond within timeout (default 5 minutes), auto-converts to checkpoint — serialize state, tear down sandbox, human takes unlimited time. Resume follows checkpoint path.

### Nested Interrupts

When one subagent interrupts, siblings continue running. If the interrupt auto-escalates to checkpoint:
1. Engine collects all completed sibling outputs
2. Engine records which agent was interrupted
3. Sandbox torn down
4. On resume: new sandbox, parent only re-spawns the interrupted agent (siblings done)

### Progressive Output Streaming

Outputs stream to the state store as they're written, not just at phase end:

```
t=5s   city_findings.json written    → copied to state store immediately
t=8s   __INTERRUPT__law.json written → streamed to frontend immediately
t=12s  doc_observations.json written → copied to state store immediately
```

If the sandbox crashes at t=10s, city findings are already safe.

The `InterruptWatcher` monitors `output/` via chokidar and handles:
- `__INTERRUPT__*.json` → queued for sequential handler processing with optional auto-escalation timeout
- `__CHILD_START__*.json`, `__CHILD_DONE__*.json` → fire-and-forget progress events
- Regular files → emit `file_written` progress events

---

## UI Architecture

### Tech Stack

- **React 19** with TypeScript
- **Vite 6** for bundling (ESM-only)
- **Tailwind CSS 4** with custom design tokens
- **React Router 7** — `/ ` (dashboard) and `/workspace/:id` (editor)
- **dockview-react** — VS Code-like multi-panel tabbed editor
- **@xyflow/react** (React Flow) — DAG visualization
- **@dagrejs/dagre** — Graph auto-layout
- **CodeMirror 6** — Code/markdown editing with custom extensions

### Workspace Layout

```
┌────────────┬──────────────────────────────────────┬──────────┐
│            │  DagMiniView (React Flow canvas)     │          │
│  Agent     │  Collapsible, resizable, breadcrumb  │  Forge   │
│  Explorer  │  drill-down into child nodes         │  AI      │
│  (sidebar) ├──────────────────────────────────────┤  Copilot │
│            │  EditorLayout (dockview-react)        │  (right  │
│  • Agents  │  Tabbed multi-panel editor area      │  panel)  │
│  • Skills  │  ┌──────────────────────────────┐    │          │
│  • Refs    │  │ AgentEditor / SkillEditor    │    │          │
│            │  ├──────────────────────────────┤    │          │
│            │  │ ConfigBottomPanel             │    │          │
│            │  │ I/O │ Budget │ Skills │ ...   │    │          │
│            │  └──────────────────────────────┘    │          │
├────────────┴──────────────────────────────────────┴──────────┤
│  WorkspaceToolbar                                            │
└──────────────────────────────────────────────────────────────┘
```

All panels are resizable. Sidebar: 140-480px. DAG view: 64-400px, collapsible. AI panel: 280-600px, toggleable.

### Dashboard (/)

Project listing with grid cards showing name, description, node count, skill count, and checkpoints. "New Project" creates an empty flow and navigates to the workspace.

### AgentExplorer (Left Sidebar)

Tree-based navigator with three collapsible sections:

**Agents** — All top-level nodes in topological order with recursive `AgentTreeItem` components. Type glyphs: "A" (agent), "C" (checkpoint). Inline rename (double-click or F2). Expandable sub-agents. Context menu: Open, Rename, New Sub-Agent, Duplicate, Delete.

**Skills** — Available skills with sub-skill expansion. Circular reference protection. Context menu with Open action.

**References** — File tree with folder support and type icons (PDF, MD, JSON, TXT).

### DagMiniView (Top Panel)

Miniature DAG viewer using React Flow with custom node types (AgentNode, CheckpointNode, MergeNode) and custom FlowEdge:
- Single click: select node and open editor tab
- Double click: drill into node's children
- Breadcrumb navigation with "Root" and back button
- Auto-fit viewport on resize
- Dagre auto-layout for top-level nodes, parallel layout for children
- Conversion utilities in `lib/flow-to-reactflow.ts`

### EditorLayout (Center — dockview-react)

Multi-panel tabbed editor with three panel types:

**AgentEditor** — Node name input, type badge, `SlashCommandEditor` (CodeMirror 6) for instructions, and `ConfigBottomPanel` with tabs:
- **I/O** — Input/output file tag lists
- **Budget** — maxTurns, maxBudgetUsd controls
- **Skills** — Skill assignment
- **Interrupts** — Interrupt config (agent nodes only)
- **Sub-Agents** — Child agent list
- **Presentation** — Checkpoint presentation config

**SkillEditorPanel** — File tree navigation between SKILL.md and references. Three view modes: Edit (SkillSlashEditor with slash commands), Compiled (rendered markdown), Raw (plain CodeMirror). Import suggestions bar.

**ReferenceViewer** — Markdown, text, and JSON file viewer.

Keyboard shortcuts: `Cmd+W` close panel, `Cmd+\` split right, `Cmd+Shift+\` split down, `Cmd+1-9` focus group.

### Slash Command Editor

CodeMirror 6 editor with custom extensions for agent instructions and skill content:
- `/output` → Output table widget
- `/input` → Input table widget
- `/decision` → Decision tree widget
- `/guardrail` → Guardrail rules widget
- `//skill:name` → Skill reference (renders as chip)
- `@file` → File reference (renders as chip)
- Chip backspace handler for deleting entire references
- Block decorations for structured data tables

### State Management

Five React context providers form the state architecture:

| Context | Scope | Purpose |
|---------|-------|---------|
| `ProjectStore` | Global | CRUD for projects, flows, skills. Holds all project data. |
| `FlowContext` | Per-workspace | `useReducer` with 10+ actions: SELECT_NODE, ADD_NODE, REMOVE_NODE, UPDATE_NODE, ADD_EDGE, REMOVE_EDGE, ADD_CHILD, CREATE_AGENT_BY_NAME, etc. |
| `DagContext` | Per-workspace | DAG mini-view UI state: collapsed/expanded, breadcrumb stack for drill-down navigation. |
| `LayoutContext` | Per-workspace | Dockview API wrapper. Tab open/close/focus, tracks active selection (agent/skill/reference). |
| `SkillContext` | Per-skill-tab | File selection, content editing, dirty tracking, view mode (edit/compiled/raw). |

Provider nesting:
```
<ProjectStoreProvider>        (App.tsx — global)
  <FlowProvider>              (WorkspacePage — per-flow)
    <DagProvider>
      <LayoutProvider>
        <WorkspaceContent />
      </LayoutProvider>
    </DagProvider>
  </FlowProvider>
</ProjectStoreProvider>
```

`SkillProvider` is instantiated per-skill-tab inside `DockviewLayout`.

---

## Forge AI Copilot

### Vision

Forge is the Claude-powered AI copilot that sits alongside the visual editor. Users can conversationally ask Forge to:
- Add, modify, or remove nodes in a flow
- Write or improve agent instructions
- Explain what a node or skill does
- Debug configuration issues (missing inputs, budget problems)
- Suggest skills for a given task
- Validate a flow and explain errors

### Current State

The UI shell is built (`AISidePanel` component):
- Chat interface with message history
- Welcome message explaining capabilities
- Tool call indicators (name + status)
- Streaming animation
- Mock responses (will connect to real API)

### Planned Architecture

- Server-side: Express endpoint proxying to Claude API
- Client-side: Streaming chat with tool call visualization
- Tools available to Forge: `get_flow`, `update_node`, `add_node`, `remove_node`, `validate_flow`, `compile_prompt`, `list_skills`

---

## Package Dependency Graph

```
@forgeflow/types (zero runtime)
  │
  ├── @forgeflow/parser (Zod schemas)
  │     │
  │     └── @forgeflow/validator (semantic checks)
  │           │
  │           └── @forgeflow/compiler (prompt generation)
  │
  ├── @forgeflow/skill-resolver (SKILL.md loading)
  │
  ├── @forgeflow/state-store (StateStore interface)
  │
  └── @forgeflow/engine (orchestrator, runners, watcher)
        │  (depends on parser, validator, compiler,
        │   skill-resolver, state-store)
        │
        ├── @forgeflow/cli (forgeflow run/resume)
        │
        └── @forgeflow/server (Express API)
              │
              └── @forgeflow/desktop (Electron wrapper)

@forgeflow/ui (React IDE — imports @forgeflow/types only)
```

---

## Data Flow: Complete Example

A 4-node contract review flow:

```
1. User opens IDE, creates flow:
   Parse → Research (3 children) → ⛔ Checkpoint → Generate

2. User saves → FLOW.json

3. User uploads contract.pdf → saved to state store as user input

4. User clicks Run → engine starts:

   ┌─── Phase 1: Parse Contract ───────────────────────┐
   │ Engine creates sandbox                             │
   │   → copies contract.pdf into sandbox input/        │
   │   → no skills needed for this phase                │
   │ Agent runs: reads PDF, writes clauses_parsed.json  │
   │ Engine collects outputs → state store              │
   │ Engine destroys sandbox                            │
   │ Cost so far: $1.20, 8 turns                        │
   └───────────────────────────────────────────────────┘
        ↓ (state serialized to disk)
   ┌─── Phase 2: Research ─────────────────────────────┐
   │ Engine creates sandbox                             │
   │   → copies clauses_parsed.json into sandbox input/ │
   │   → loads contract-law-basics skill                │
   │ Agent spawns 3 subagents via Task tool             │
   │   → Subagent A writes liability_findings.json      │
   │   → Subagent B writes ip_findings.json             │
   │   → Subagent C writes termination_findings.json    │
   │ Engine collects all 3 outputs → state store        │
   │ Engine destroys sandbox                            │
   │ Cost so far: $12.50, 85 turns                      │
   └───────────────────────────────────────────────────┘
        ↓ (state serialized to disk)
   ┌─── Checkpoint: Attorney Review ───────────────────┐
   │ Engine loads presentation files from state store   │
   │ Engine emits checkpoint event → frontend           │
   │ NO SANDBOX RUNNING — zero cost while waiting       │
   │                                                    │
   │ Frontend shows risk analysis to attorney           │
   │ Attorney answers (5 min or 5 days later)           │
   │ Answers saved to state store                       │
   └───────────────────────────────────────────────────┘
        ↓ (user input saved to state store)
   ┌─── Phase 3: Generate Deliverables ────────────────┐
   │ Engine creates sandbox                             │
   │   → copies ALL prior outputs + attorney_decisions  │
   │   → loads contract-law-basics skill                │
   │ Agent generates redline, memo, risk summary        │
   │ Engine collects final outputs → state store        │
   │ Engine destroys sandbox                            │
   │ Total cost: $28.00, 180 turns                      │
   └───────────────────────────────────────────────────┘

5. Run complete → all artifacts in state store
```

---

## Local vs Cloud Architecture

The engine uses the same interface everywhere. Only adapters change:

| Concern | Local (MVP) | Cloud |
|---------|-------------|-------|
| Sandbox | Docker container per phase | Vercel Sandbox / Firecracker VM |
| State store | `~/.forgeflow/runs/{id}/` on disk | Postgres + S3 |
| Skill library | `~/.forgeflow/skills/` directory | Skill registry API |
| Progress events | EventEmitter / WebSocket | WebSocket / SSE |
| API key | User's `.env` file | Platform-managed per user |
| Auth | None (single user) | User accounts + API keys |

---

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Per-phase execution | Engine orchestrates, one agent per phase | Clean context, resource savings, natural serialization |
| Sandbox per phase | New container for each phase | Isolation, security, clean filesystem |
| Bidirectional sandbox channel | Filesystem watcher (chokidar) | Real-time interrupts, progressive output streaming, live monitoring |
| Flow validation before execution | Compiler-style type checking | Catch dependency errors, missing inputs, cycles at design time |
| 5 interrupt types | approval, qa, selection, review, escalation | Covers all human-in-the-loop patterns across domains |
| Inline + checkpoint modes | Auto-escalate via Promise.race | Quick questions stay fast, long pauses cost nothing |
| Progressive output streaming | `file_written` events from InterruptWatcher | Real-time visibility, fault recovery |
| Per-child prompt files | Prompts in `prompts/` directory, parent has ref table | O(n) tokens per level instead of O(n^depth) |
| Resume after checkpoint | `orchestrator.resume()` reloads state, continues | Supports pauses of minutes or days with zero cost |
| AgentRunner interface | Mock / Claude / Docker runners | Test without API, run locally, or sandbox |
| Skills loaded per phase | Only declared skills copied to sandbox | Minimal context, faster startup |
| Editor framework | dockview-react | VS Code-like multi-panel tabs, split views, drag-and-drop |
| DAG visualization | @xyflow/react + dagre | Mature, React-native, handles custom nodes well |
| Instruction editor | CodeMirror 6 | Extensible, supports custom slash commands and decorations |
| State management | React Context + useReducer | Clear action-based updates, no external library needed |
| AI copilot | Side panel chat | Non-intrusive, always accessible, does not block editing |
| Styling | Tailwind CSS 4 | Utility-first with custom design tokens |
