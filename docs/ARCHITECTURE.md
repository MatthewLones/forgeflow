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
| Process / address space | Sandbox (Docker container per phase) |
| Memory / heap | State Store (artifacts between phases) |
| System calls / signals | Interrupts (approval, Q&A, selection, review, escalation) |
| IPC / pipes | Bidirectional Sandbox Channel (filesystem watcher) |
| Libraries / imports | Skills (SKILL.md + references/) |
| Debugger | Run Dashboard + state inspector |
| stdout / stderr | Progress Streamer (SSE) |
| Version control | Per-project Git repos + GitHub integration |

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
│  │          ├─────────────────────────────────────┤            │    │
│  │          │  GitPanel │ RunPanel │ Validation    │            │    │
│  └──────────┴─────────────────────────────────────┴────────────┘    │
│  WorkspaceToolbar │ SettingsOverlay │ ExportDialog                   │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ API calls (fetch) to localhost:3001
┌──────────────────▼───────────────────────────────────────────────────┐
│  Server API (Express 5, port 3001)                                   │
│  Routes: projects, skills, flows, runs, references, copilot, git,   │
│          github, health                                              │
│  Services: ProjectStore, RunManager, CopilotManager, GitManager,    │
│            GitHubService, WorkspaceCleaner                           │
│  SSE: run progress streaming, copilot token streaming               │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ orchestrates execution
┌──────────────────▼───────────────────────────────────────────────────┐
│  Execution Engine (Node.js)                                          │
│  - Flow Validator: pluggable 11-rule pipeline on FlowGraph           │
│  - Phase Compiler: staged IR pipeline (FlowGraph → PhaseIR → md)    │
│  - Agent Runner: MockRunner / ClaudeAgentRunner / DockerAgentRunner  │
│  - InterruptWatcher: real-time interrupt + output streaming          │
│  - Progress Streamer: events → server → SSE → frontend              │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ creates/manages per-phase
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
│  State Store + Git                                                   │
│  Runs:     ~/.forgeflow/runs/{id}/    (artifacts, state, checkpoints)│
│  Projects: ~/.forgeflow/projects/{id}/ (FLOW.json, skills, .git/)   │
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

Skills are standalone. Multiple flows can reference the same skill. Skills compose other skills — a skill's `SKILL.md` can reference sub-skills. See [SKILL-FORMAT.md](SKILL-FORMAT.md).

**Node** — A unit of work in a flow. Two types:

| Type | Purpose | Example |
|------|---------|---------|
| **Agent** | Claude executes instructions with loaded skills | "Parse the contract and extract each clause" |
| **Checkpoint** | Flow pauses, presents data to user, waits for input | "Show risk analysis to attorney, wait for decisions" |

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
│  └────────┘  └────────┘  └────────┘   │
│       (all wave 0 — concurrent)        │
└─────────────────────────────────────────┘
```

Children run concurrently by default. Parent nodes declare all children's outputs in their own `config.outputs`.

### Wave-Based Child Ordering

When children have sibling I/O dependencies, the engine automatically groups them into **waves** via topological sort:

- **Wave 0** — children with no sibling dependencies (run concurrently)
- **Wave N** — children whose inputs depend on Wave N-1 outputs (wait, then run)
- Cycles between siblings are rejected with `CHILD_CYCLE`

No annotations needed — wave assignment is computed from `config.inputs` and `config.outputs` declarations. The compiler generates wave-aware instructions: single wave = "Launch All N Concurrently", multiple waves = sequential wave execution with wait instructions.

---

## Execution Model

### Phase Compiler (Staged IR Pipeline)

The compiler uses a staged intermediate representation (IR) to generate per-phase prompts:

```
FlowGraph → resolvePhaseIR() → PhaseIR → generateMarkdown() → markdown
```

**Stage 1: Build FlowGraph** — The validator builds a symbol table from `FlowDefinition` in a single O(N+E) pass. Each `FlowSymbol` contains: depth, parentId, childIds, descendantIds, topoIndex, predecessors/successors, declared inputs/outputs, schemas, child topo order, and child cycle detection. The `FlowGraph` is the single source of truth consumed by all downstream passes.

**Stage 2: Resolve PhaseIR** — `resolvePhaseIR(node, graph)` produces a structured IR:
- `AgentPhaseIR` for agent nodes: resolved inputs (with source attribution), outputs, skills, budget, children (with wave assignments), interrupt section
- `CheckpointIR` for checkpoint nodes: files to present, expected inputs, presentation config

**Stage 3: Generate Markdown** — `generateMarkdown(ir)` converts the IR into executable prompt text. Includes the system prompt (execution environment instructions), task instructions, I/O declarations with schema details, budget constraints, skill references, and children sections.

**Per-child prompt files:** When a node has children, `compileChildPrompts(nodeId, graph)` generates individual markdown files. The parent prompt gets a reference table:

```markdown
## Subagents — Launch All Concurrently

| Child | Prompt File | Outputs |
|-------|-------------|---------|
| Liability Analyst | prompts/analyze_liability.md | output/liability_findings.json |
| IP Analyst | prompts/analyze_ip.md | output/ip_findings.json |

Launch all subagents concurrently using the Task tool.
```

Each child prompt file is self-contained. If a child has its own children, those are referenced the same way — prompt files all the way down. Token usage is O(n) per nesting level, not O(n^depth).

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

### Flow Validator (Pluggable Pipeline)

Before any phase runs, the engine validates the entire FLOW.json using a **pluggable rule pipeline**:

**FlowGraph** — A semantic symbol table built once from `FlowDefinition`:
- `FlowSymbol` per node: depth, parentId, childIds, descendantIds, topoIndex, predecessors/successors, declaredInputs/Outputs, inputSchemas/outputSchemas, childTopoOrder, childCycle
- `ArtifactEntry` per artifact: producerId, consumerIds, schema (from inline `ArtifactSchema` or `flow.artifacts` registry)
- Derived: topoOrder, hasCycle, cycleNodes, availableAtPhase, userUploadFiles

**11 rules** in 4 categories, topologically sorted by dependencies:

| Category | Rules | Dependencies |
|----------|-------|-------------|
| Structural | node-id-format, node-id-unique, edge-validity, dag-acyclic, connectivity, node-type-rules | connectivity depends on dag-acyclic |
| Type System | output-uniqueness, schema-compatibility | schema-compatibility depends on output-uniqueness |
| Dataflow | dependency-resolution | depends on dag-acyclic + connectivity + output-uniqueness |
| Resource | budget-check | none |
| Runtime | interrupt-validity | none |

**Rule runner:** Sorts rules by dependencies, executes in order, skips rules whose dependencies failed. Returns per-rule diagnostics and timing.

```typescript
// Simple validation
const result = validateFlow(flowDefinition);

// Detailed pipeline introspection
const detailed = validateFlowDetailed(flowDefinition, options);
// detailed.ruleResults: per-rule diagnostics, timing, skip reasons
```

If valid, produces an `ExecutionPlan` with resolved execution order, input sources per phase, estimated costs, and critical path.

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

**Execute flow:** Validates FLOW.json → builds FlowGraph → initializes run state → saves user uploads → calls `executePhases()` from phase 0.

**Resume flow:** Loads saved RunState (verifies `awaiting_input`) → loads CheckpointState → saves user's answer as artifact → finds checkpoint in execution plan → calls `executePhases()` from checkpoint+1 with accumulated cost.

**Phase loop** (simplified):
```typescript
for (const phase of executionPlan.phases) {
  if (node.type === 'checkpoint') {
    // Save checkpoint state, return { status: 'awaiting_input' }
  }

  // Compile prompt via IR pipeline, resolve skills, prepare workspace
  const { markdown } = compilePhase(nodeId, graph);

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

  // Collect outputs → validate against expected → state store → cleanup workspace
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
| `ClaudeAgentRunner` | Local development | Runs Claude Agent SDK `query()` directly on the host. Uses `permissionMode: 'bypassPermissions'`. Exponential backoff retry (5 attempts) for rate limits. |
| `DockerAgentRunner` | Production (sandboxed) | Runs agent inside a Docker container with mounted workspace volume. Uses `dockerode` for container management. Streams JSONL progress events from stdout. Auto-builds image if missing. |

Docker runner is imported separately to avoid pulling in native dependencies at startup:
```typescript
import { DockerAgentRunner } from '@forgeflow/engine/docker';
```

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

### Sandbox Manager

Each phase runs in an isolated Docker container:

```
┌────────────────────────────────────┐
│  Docker Container (Phase N)        │
│  ├── workspace/                    │
│  │   ├── input/   ← from state    │
│  │   ├── output/  ← agent writes  │
│  │   ├── skills/  ← phase skills  │
│  │   └── prompts/ ← child prompts │
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

Events flow: Engine → RunManager → SSE → Frontend. The `RunManager` stores events in memory and replays them on SSE reconnect.

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

## Server API

The server is an Express 5 application that bridges the UI with the execution engine, copilot, and version control.

### Configuration

- Port 3001 (configurable via `PORT` env)
- CORS enabled for cross-origin UI access
- JSON body limit 50mb
- `ANTHROPIC_API_KEY` loaded from `packages/server/.env` (gitignored)

### Route Modules

| Module | Base Path | Purpose |
|--------|-----------|---------|
| health | `/api/health` | Server status |
| projects | `/api/projects` | Project CRUD, flow save/load, export/import |
| skills | `/api/projects/:id/skills` | Skill CRUD per project |
| flows | `/api/validate`, `/api/compile` | Validation and compile preview |
| runs | `/api/projects/:id/run`, `/api/runs/:id` | Execution, SSE progress, interrupt bridge |
| references | `/api/projects/:id/references` | Reference file management |
| copilot | `/api/copilot` | Forge AI copilot sessions |
| git | `/api/projects/:id/git` | Git operations per project |
| github | `/api/github` | GitHub OAuth and repo management |

### Key Services

**ProjectStore** — Filesystem CRUD at `~/.forgeflow/projects/{id}/`:
- `project.json` — project metadata
- `FLOW.json` — flow definition
- `skills/` — skill directories
- `references/` — reference files
- Seeds default "Legal Contract Review" project on first access

**RunManager** — Singleton managing active runs:
- Maps runId → active orchestrator + SSE clients + pending interrupt Promise
- SSE streaming with event replay on reconnect
- Interrupt bridge: engine's InterruptHandler → RunManager stores Promise → SSE emits interrupt → POST resolves Promise
- Startup cleanup: marks orphaned runs as failed

**CopilotManager** — Agent SDK sessions per project (see Forge AI Copilot section)

**GitManager** — Per-project Git operations (see Git Version Control section)

**GitHubService** — GitHub OAuth and repository management (see Git Version Control section)

**WorkspaceCleaner** — Background cleanup of old workspace directories (24h TTL by default, configurable via `WORKSPACE_TTL_HOURS`)

### SSE Streaming

Two SSE endpoints for real-time updates:

- `GET /api/runs/:runId/progress` — Run events (phase start/complete, interrupts, file writes, cost updates, completion)
- `GET /api/copilot/:sessionId/progress` — Copilot token-level streaming (content_block_delta, text_delta)

Both support reconnection: events are stored in memory and replayed when a new connection is established.

---

## Git Version Control & GitHub Integration

ForgeFlow provides per-project Git version control and GitHub remote hosting directly in the IDE.

### Per-Project Git Repos

Each project gets its own Git repository at `~/.forgeflow/projects/{id}/.git`. The `GitManager` service handles all operations using `simple-git`:

- **Initialization** — `ensureInit()` creates the repo, writes `.gitignore` (references/, copilot-chats/, *.log, .DS_Store), and creates an initial commit
- **Staging** — `stageAll()`, `stageFiles(paths)`, `unstageFiles(paths)`
- **Commits** — `commit(message)` returns the commit hash
- **History** — `log(limit)` returns commit objects, `diff(hash?)` returns per-file diffs
- **Branches** — `branches()`, `createBranch(name)`, `switchBranch(name)`
- **Remote** — `push()`, `pull()`, `setRemote(url)`, `getRemote()`
- **Reset** — `resetToCommit(hash)` for hard reset

**Concurrency:** Per-project mutex prevents `index.lock` conflicts from concurrent API calls. Stale lock files are auto-cleaned on startup.

### Git Types

```typescript
interface GitStatusFile { path: string; status: 'M'|'A'|'D'|'?'|'R'|'MM'|'UU'; staged: boolean }
interface GitStatus { initialized: boolean; branch: string; tracking: string|null; ahead: number; behind: number; files: GitStatusFile[]; hasRemote: boolean }
interface GitCommit { hash: string; message: string; author: string; date: string; filesChanged: number }
interface GitBranch { name: string; current: boolean; tracking?: string }
interface GitDiffEntry { file: string; insertions: number; deletions: number; diff: string }
```

### GitPanel UI

The `GitPanel` is a collapsible bottom panel in the workspace with 4 tabs:

| Tab | Content |
|-----|---------|
| **Changes** | Staged/unstaged file list with individual stage/unstage toggles |
| **Commit** | Commit message textarea with Cmd+Enter shortcut, last commit info |
| **History** | Commit log with expandable diffs and "Reset to this commit" action |
| **Branches** | Branch list with create/switch, current branch indicator |

The panel shows a branch indicator with ahead/behind counts in the header. Push/pull buttons appear when a remote is configured. Status auto-refreshes every 5 seconds when the panel is visible.

### GitHub Integration

- **OAuth flow** — `GET /api/github/auth-url` returns the GitHub authorize URL (callback auto-detected from Referer header). `POST /api/github/callback` exchanges the code for an access token.
- **Token persistence** — Stored at `~/.forgeflow/github-token.json`
- **Repo operations** — List user repos, create new repos, link as remote (token injected into HTTPS URL for auth)
- **UI** — `GitHubConnectDialog` triggers OAuth popup, shows repo list, enables linking. `GitHubCallbackPage` handles the OAuth redirect.

### API Endpoints

**Git** (`/api/projects/:id/git/`): status, init, stage, unstage, commit, log, diff, branches, create-branch, switch-branch, push, pull, reset, set-remote, get-remote

**GitHub** (`/api/github/`): status, auth-url, callback, repos, create repo, link repo, disconnect

---

## .forge Bundle Format

`.forge` is a portable project bundle format for sharing and archiving ForgeFlow projects.

**Binary format:** 7-byte magic header (`FORGE\x01\x00`) + gzip-compressed minified JSON

**Payload structure:**
```typescript
{
  v: 1,                                          // Format version
  flow: FlowDefinition,                          // The complete flow
  skills: Record<string, Record<string, string | { $b64: string }>>,  // Skill files
  references: Record<string, string | { $b64: string }>               // Reference files
}
```

- Text files stored as strings
- Binary files stored as `{ $b64: "base64..." }`
- No redundant `project.json` — metadata derived from `flow` on import
- ID collision handled by auto-suffixing (`_1`, `_2`, etc.)

**API:** `GET /api/projects/:id/export` produces the bundle, `POST /api/projects/import` (multer) imports it.

**UI:** Export button in workspace toolbar opens `ExportDialog` with filename input. Import button on the dashboard page.

---

## Forge AI Copilot

Forge is the Claude-powered AI copilot that sits alongside the visual editor. Users can conversationally ask Forge to build, modify, validate, and debug workflows.

### Architecture

**Server:** `CopilotManager` service manages Agent SDK `query()` sessions per project. Each session has an in-process MCP server providing 13 tools:

| Category | Tools |
|----------|-------|
| Read | `get_flow`, `get_project_info`, `get_skill`, `validate_flow`, `compile_preview` |
| Write | `add_node`, `update_node`, `remove_node`, `add_edge`, `add_child`, `save_flow`, `create_skill`, `update_skill` |
| User | `ask_user` (with optional multiple-choice options) |

**No maxTurns limit** — set to 200 (effectively unlimited). The budget cap (`maxBudgetUsd: 1.0`) is the real safety net.

**SSE streaming:** Token-level updates via SDK `stream_event` messages (`content_block_delta` / `text_delta`). Consolidated text is persisted for history replay.

**Session persistence:** `copilot-events.ndjson` per project, auto-loaded on mount.

### Mutating Tools

When `save_flow`, `add_node`, `update_node`, `remove_node`, `add_edge`, `add_child`, `create_skill`, or `update_skill` succeed, a `copilot_flow_changed` event is emitted. The UI catches this and reloads the flow from the server to stay in sync.

### UI Features

- Chat interface with message history and streaming display
- Interactive chips for interrupt types, skills, and artifacts
- "Other" option on multi-choice `ask_user` responses
- Fun starter prompts for new sessions
- Multi-chat support: create, switch, archive, and delete conversations
- Tool call indicators showing which MCP tool is executing

---

## Settings & Keyboard Shortcuts

### Keyboard Shortcuts

40+ shortcuts across 6 categories: General, Tabs, Toolbar, Layout, Nodes, Navigation. Platform-aware: Cmd on macOS, Ctrl on Windows/Linux.

**Remapping:** Users can remap any shortcut via the Settings overlay. Remaps are persisted to localStorage (`forgeflow:shortcut-remaps`). Individual shortcuts or all shortcuts can be reset to defaults. Browser-reserved shortcuts are flagged with a warning (they work in the Electron desktop app).

### Settings Overlay

The `SettingsOverlay` component has two tabs:

| Tab | Content |
|-----|---------|
| **Keyboard Shortcuts** | All shortcuts grouped by category, click-to-capture remap UI, reset buttons |
| **Guide** | 7-section interactive reference: How It Works, Composable Nodes, Node Design, Docker Sandbox, Interrupts, Artifacts, References |

The Guide tab has a left sidebar with section navigation and uses `IntersectionObserver` to track the active section as the user scrolls.

---

## Desktop App

The `@forgeflow/desktop` package wraps the UI and server into an Electron 35 desktop application using `electron-vite`.

- **Bundling** — UI dist is served as static files, server runs as an embedded process
- **File association** — `.forge` files open ForgeFlow when double-clicked
- **Platform targets** — macOS (dmg, zip), Windows (nsis, portable), Linux (AppImage, deb)
- **Dev mode** — `pnpm dev:desktop` runs UI + Electron concurrently
- **Distribution** — `pnpm dist:desktop` builds platform-specific installers

---

## UI Architecture

### Tech Stack

- **React 19** with TypeScript
- **Vite 6** for bundling (ESM-only)
- **Tailwind CSS 4** with custom design tokens
- **React Router 7** — 5 routes
- **dockview-react** — VS Code-like multi-panel tabbed editor
- **@xyflow/react** (React Flow) — DAG visualization
- **@dagrejs/dagre** — Graph auto-layout
- **CodeMirror 6** — Code/markdown editing with custom extensions
- **Electron 35** + electron-vite — Desktop app

### Pages

| Page | Route | Description |
|------|-------|-------------|
| `DashboardPage` | `/` | Project listing, create project, import `.forge` |
| `WorkspacePage` | `/workspace/:id` | Full IDE with all panels |
| `RunDashboardPage` | `/projects/:id/runs/:runId` | Live run observability |
| `RunListPage` | `/projects/:id/runs` | Run history for a project |
| `GitHubCallbackPage` | `/github/callback` | OAuth callback handler |

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
│  GitPanel (collapsible bottom, 4 tabs)                       │
├──────────────────────────────────────────────────────────────┤
│  WorkspaceToolbar                                            │
└──────────────────────────────────────────────────────────────┘
```

All panels are resizable. Sidebar: 140-480px. DAG view: 64-400px, collapsible. AI panel: 280-600px, toggleable. Git panel: 100-400px, collapsible.

### AgentExplorer (Left Sidebar)

Tree-based navigator with three collapsible sections:

**Agents** — All top-level nodes in topological order with recursive `AgentTreeItem` components. Type glyphs: "A" (agent), "C" (checkpoint). Inline rename (double-click or F2). Expandable sub-agents. Context menu: Open, Rename, New Sub-Agent, Duplicate, Delete.

**Skills** — Available skills with sub-skill expansion. Circular reference protection. Context menu: Open, Rename, Delete, New Skill.

**References** — File tree with folder support and type icons (PDF, MD, JSON, TXT). Upload, create folder, rename, delete via context menu.

### DagMiniView (Top Panel)

Miniature DAG viewer using React Flow with custom node types (AgentNode, CheckpointNode) and custom FlowEdge:
- Single click: select node and open editor tab
- Double click: drill into node's children
- Breadcrumb navigation with "Root" and back button
- Auto-fit viewport on resize
- Dagre auto-layout for top-level nodes, parallel layout for children

### EditorLayout (Center — dockview-react)

Multi-panel tabbed editor with panel types:

**AgentEditor** — Node name input, type badge, `SlashCommandEditor` (CodeMirror 6) for instructions, and `ConfigBottomPanel` with tabs: I/O, Budget, Skills, Interrupts, Sub-Agents, Presentation.

**SkillEditorPanel** — File tree navigation between SKILL.md and references. Three view modes: Edit, Compiled (rendered markdown), Raw. Import suggestions bar.

**Additional panels** — ValidationPanel, CompilePreviewPanel, OutputViewer, RunPanel, RunHistoryPanel, ReferenceViewer.

### Slash Command Editor

CodeMirror 6 editor with custom extensions for agent instructions and skill content:
- `/output` → Output table widget
- `/input` → Input table widget
- `/decision` → Decision tree widget
- `/guardrail` → Guardrail rules widget
- `//skill:name` → Skill reference (renders as chip)
- `@file` → File reference (renders as chip)

### State Management

Nine React context providers form the state architecture:

| Context | Scope | Purpose |
|---------|-------|---------|
| `ProjectStore` | Global | CRUD for projects, flows, skills, references. API integration. |
| `FlowContext` | Per-workspace | `useReducer` with 20+ actions: SELECT_NODE, ADD_NODE, REMOVE_NODE, UPDATE_NODE, ADD_EDGE, REMOVE_EDGE, ADD_CHILD, ADD_ARTIFACT, UPDATE_ARTIFACT, MARK_CLEAN, etc. |
| `DagContext` | Per-workspace | DAG mini-view UI state: collapsed/expanded, breadcrumb stack for drill-down navigation. |
| `LayoutContext` | Per-workspace | Dockview API wrapper. Tab open/close/focus, tracks active selection (agent/skill/reference). |
| `RunContext` | Per-workspace | Active run state. SSE progress streaming, node/phase status, interrupt handling. |
| `CopilotContext` | Per-workspace | Copilot chat state, SSE token streaming, session management, multi-chat. |
| `GitContext` | Per-workspace | Git operations, status, commits, branches, GitHub connection. |
| `SkillContext` | Per-skill-tab | File selection, content editing, dirty tracking, view mode (edit/compiled/raw). |

Provider nesting:
```
<ProjectStoreProvider>        (App.tsx — global)
  <FlowProvider>              (WorkspacePage — per-flow)
    <DagProvider>
      <LayoutProvider>
        <RunProvider>
          <CopilotProvider>
            <GitProvider>
              <WorkspaceContent />
            </GitProvider>
          </CopilotProvider>
        </RunProvider>
      </LayoutProvider>
    </DagProvider>
  </FlowProvider>
</ProjectStoreProvider>
```

`SkillProvider` is instantiated per-skill-tab inside `DockviewLayout`.

---

## Package Dependency Graph

```
@forgeflow/types (zero runtime)
  │
  ├── @forgeflow/parser (Zod schemas)
  │     │
  │     └── @forgeflow/validator (pluggable pipeline, FlowGraph)
  │           │
  │           └── @forgeflow/compiler (staged IR pipeline)
  │
  ├── @forgeflow/skill-resolver (SKILL.md loading)
  │
  ├── @forgeflow/state-store (StateStore interface)
  │
  └── @forgeflow/engine (orchestrator, runners, watcher)
        │  (depends on parser, validator, compiler,
        │   skill-resolver, state-store, chokidar, dockerode)
        │
        ├── @forgeflow/cli (forgeflow run/resume)
        │
        └── @forgeflow/server (Express 5 API)
              │  (+ copilot: @anthropic-ai/claude-agent-sdk)
              │  (+ git: simple-git)
              │  (+ github: @octokit/rest)
              │
              └── @forgeflow/desktop (Electron wrapper)

@forgeflow/ui (React IDE — imports @forgeflow/types only, API via fetch)
```

---

## Data Flow: Complete Example

A 4-node contract review flow:

```
1. User opens IDE, creates flow:
   Parse → Research (3 children) → ⛔ Checkpoint → Generate

2. User saves → FLOW.json (auto-saved to server, git-tracked)

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
   → viewable in Run Dashboard
   → downloadable from output viewer
```

---

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Per-phase execution | Engine orchestrates, one agent per phase | Clean context, resource savings, natural serialization |
| Sandbox per phase | New container for each phase | Isolation, security, clean filesystem |
| Bidirectional sandbox channel | Filesystem watcher (chokidar) | Real-time interrupts, progressive output streaming, live monitoring |
| Staged IR pipeline | resolve → generate | Separation of concerns, testable IR, enables live compile preview |
| FlowGraph symbol table | Built once, consumed everywhere | Eliminates duplicated analysis, O(N+E) |
| Pluggable validator | 11 rules with dependency ordering | Extensible, composable, skip-on-failure |
| Wave-based children | Auto-computed from I/O declarations | No manual annotation, handles parallelism + ordering |
| Flow validation before execution | Compiler-style type checking | Catch dependency errors, missing inputs, cycles at design time |
| 5 interrupt types | approval, qa, selection, review, escalation | Covers all human-in-the-loop patterns across domains |
| Inline + checkpoint modes | Auto-escalate via Promise.race | Quick questions stay fast, long pauses cost nothing |
| Per-child prompt files | Prompts in `prompts/` directory, parent has ref table | O(n) tokens per level instead of O(n^depth) |
| Resume after checkpoint | `orchestrator.resume()` reloads state, continues | Supports pauses of minutes or days with zero cost |
| AgentRunner interface | Mock / Claude / Docker runners | Test without API, run locally, or sandbox |
| Per-project Git repos | simple-git, per-project mutex | Version control without external dependencies |
| GitHub integration | @octokit/rest, OAuth flow | First-class remote hosting |
| .forge bundles | Magic header + gzip JSON | Portable, small, self-contained project sharing |
| Keyboard shortcuts | Remappable, localStorage persistence | User customization without config files |
| Editor framework | dockview-react | VS Code-like multi-panel tabs, split views, drag-and-drop |
| DAG visualization | @xyflow/react + dagre | Mature, React-native, handles custom nodes well |
| Instruction editor | CodeMirror 6 | Extensible, supports custom slash commands and decorations |
| State management | React Context + useReducer | Clear action-based updates, no external library needed |
| AI copilot | Agent SDK + MCP tools, side panel | Full flow manipulation via conversation |
| Styling | Tailwind CSS 4 | Utility-first with custom design tokens |
