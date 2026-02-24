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
┌───────────────────────────────────────────────────┐
│  Flow Designer (React web app)                    │
│  - DAG canvas with recursive nodes                │
│  - Node inspector panel                           │
│  - Skill library browser                          │
│  - Run viewer with state inspector                │
└──────────────────┬────────────────────────────────┘
                   │ saves FLOW.json, triggers runs
┌──────────────────▼────────────────────────────────┐
│  Execution Engine (Node.js)                       │
│  - Phase Compiler: node config → per-phase prompt │
│  - Sandbox Manager: create/teardown per phase     │
│  - Agent Runner: prompt → Agent SDK query()       │
│  - State Store: serialize between phases          │
│  - Checkpoint Manager: pause/resume at boundaries │
│  - Progress Streamer: events → frontend           │
└──────────────────┬────────────────────────────────┘
                   │ creates/manages
┌──────────────────▼────────────────────────────────┐
│  Sandbox (one per phase)                          │
│  ┌─────────────────────────────────┐              │
│  │  workspace/                     │              │
│  │  ├── input/   ← from state store│              │
│  │  ├── output/  ← agent writes    │              │
│  │  └── skills/  ← only this phase │              │
│  │  claude-code CLI + agent prompt │              │
│  └─────────────────────────────────┘              │
└───────────────────────────────────────────────────┘
                   │ reads/writes
┌──────────────────▼────────────────────────────────┐
│  State Store                                      │
│  Local:  ~/.forgeflow/runs/{id}/ on disk          │
│  Cloud:  Postgres + S3/object storage             │
└───────────────────────────────────────────────────┘
```

## Component Details

### 1. Phase Compiler

**Input:** A single `FlowNode` from `FLOW.json` + resolved inputs from the state store
**Output:** A per-phase markdown prompt that Claude follows for this one phase

The compiler does NOT generate one master document. It generates a focused prompt for each node as it's about to execute.

#### Per-Phase Prompt Structure

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

#### Per-Phase Prompt with Children (Subagents)

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

Each child prompt file (e.g., `prompts/analyze_liability.md`) is self-contained with its own instructions, inputs, outputs, budget, and skills. If a child has its own children, those are referenced the same way — prompt files all the way down.

The workspace layout:
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

### 2. Flow Validator

Before any phase runs, the engine validates the entire FLOW.json — like a compiler's type-checking pass. This catches errors at design time, not runtime.

```typescript
interface ValidationResult {
  valid: boolean;
  errors: FlowError[];        // Fatal — can't run
  warnings: FlowWarning[];    // Suspicious — will run but might fail
  suggestions: FlowInfo[];    // Optimization hints
  executionPlan: ExecutionPlan; // Resolved execution order (if valid)
}
```

#### Structural Checks

| Check | Severity | Example |
|-------|----------|---------|
| DAG validation (no cycles) | Error | Node A → B → C → A |
| All node IDs unique (including nested children) | Error | Two nodes both named "research" |
| All edges reference valid node IDs | Error | Edge from "parse" to "nonexistent" |
| No orphan nodes (unreachable) | Error | Node with no incoming edges (except first) |
| No dead-end nodes (except terminal) | Error | Node with no outgoing edges (except last) |
| Checkpoint nodes have `presentation` config | Error | Checkpoint without title/sections |
| Only agent nodes have children | Error | Checkpoint with children |
| Node IDs match `[a-z][a-z0-9_]*` | Error | Node ID "Parse Input" (spaces) |

#### Dependency Resolution

The critical check — every input file must trace back to a source:

```
For each node in topological order:
  For each file in node.config.inputs:
    Is it a user upload? → OK
    Is it declared as output of a prior node (by edge order)? → OK
    Otherwise → ERROR: unresolved input
```

```
ERROR: Node "generate_output" declares input "risk_matrix.json"
       but no prior node produces this file.
       Closest match: "liability_findings.json" (from "analyze_liability")

ERROR: Node "research_law" declares input "corrections_parsed.json"
       but parent node "research" does not have this in its inputs.
       Add "corrections_parsed.json" to the research node's inputs.
```

#### Budget Checks

```
WARNING: Sum of node budgets ($42.00) exceeds flow budget ($30.00).
         Phases may be cut short. Consider increasing flow budget or
         reducing individual node budgets.

WARNING: Node "parse_input" has budget of 100 turns but its instructions
         describe a single-step task. Typical parsing takes 10-20 turns.
```

#### Output Uniqueness

```
ERROR: Output file "findings.json" is declared by both
       "analyze_liability" and "analyze_ip".
       Each node must produce uniquely named output files.
```

#### Interrupt Validation

```
WARNING: Node "research_law" (depth 2) has an inline interrupt but
         its parent "research" has no interrupt handling in its instructions.
         The interrupt will still work via filesystem, but consider adding
         interrupt-aware instructions to the parent.

ERROR: Review interrupt in "generate_output" references draftFile
       "response_letter_draft.md" but no prior node produces this file.
```

#### Compilation Output

If validation passes, the validator produces an execution plan:

```typescript
interface ExecutionPlan {
  phases: {
    nodeId: string;
    order: number;
    inputsFrom: { file: string; source: 'user_upload' | string }[];
    skills: string[];                 // Fully resolved (including sub-skill deps)
    estimatedCost: { turns: number; usd: number };
    interruptCapable: boolean;        // Does this phase or its children have interrupts?
    children?: ExecutionPlan;         // Recursive for nodes with children
  }[];
  totalEstimatedCost: { turns: number; usd: number };
  criticalPath: string[];             // Longest dependency chain (bottleneck)
}
```

### 3. Sandbox Manager

Each phase runs in an isolated sandbox. The sandbox manager handles the lifecycle:

```typescript
interface SandboxManager {
  // Create a sandbox for a phase
  create(options: {
    phaseId: string;
    runId: string;
    skills: string[];           // Only skills this node needs
    inputFiles: StateFile[];    // From state store (prior phase outputs + user uploads)
  }): Promise<Sandbox>;

  // Collect outputs and tear down
  collect(sandbox: Sandbox): Promise<StateFile[]>;

  // Clean up
  destroy(sandbox: Sandbox): Promise<void>;
}
```

#### Local Sandbox (MVP)

For local development, each phase gets a Docker container:

```
┌─────────────────────────────────────┐
│  Docker Container (Phase N)         │
│  ├── workspace/                     │
│  │   ├── input/   ← copied from state store     │
│  │   ├── output/  ← agent writes here           │
│  │   └── skills/  ← only skills this node needs │
│  ├── claude-code CLI                │
│  └── agent prompt (per-phase .md)   │
└─────────────────────────────────────┘
```

The state store lives on the host filesystem at `~/.forgeflow/runs/{runId}/`. Between phases, the engine:
1. Reads output files from the sandbox's `workspace/output/`
2. Writes them to the state store
3. Destroys the container
4. Creates a new container for the next phase
5. Copies the needed files from the state store into the new sandbox's `workspace/input/`

#### Cloud Sandbox

For hosted deployment, swap Docker for Vercel Sandbox (or Firecracker VMs):

```
┌─────────────────────────────────────┐
│  Vercel Sandbox (Phase N)           │
│  ├── workspace/                     │
│  │   ├── input/   ← downloaded from S3           │
│  │   ├── output/  ← agent writes here            │
│  │   └── skills/  ← pulled from skill registry   │
│  ├── claude-code CLI                │
│  └── agent prompt (per-phase .md)   │
└─────────────────────────────────────┘
```

Same engine code, different adapters.

### 4. Bidirectional Sandbox Channel

The sandbox is not a black box that produces output at the end. It has a **live, bidirectional filesystem channel** with the engine throughout execution.

```
Engine ←→ mounted volume / filesystem watcher ←→ Sandbox
  │                                                  │
  ├── watches output/ for new files                  ├── agent writes output files
  ├── watches for __INTERRUPT__*.json                ├── agent writes interrupt signals
  ├── writes __ANSWER__*.json into sandbox           ├── agent polls for answer files
  └── reads cost/progress in real-time               └── agent logs to stdout
```

This channel enables four capabilities:

**Real-time interrupt streaming:** The moment a subagent writes `__INTERRUPT__law_agent.json`, the engine detects it and streams the question to the frontend. No waiting for the phase to end.

**Inline agent pausing:** The agent writes its interrupt file, then enters a poll loop checking for `__ANSWER__law_agent.json`. Its context window stays alive. Other subagents continue running.

**Progressive output collection:** When `city_findings.json` is written at t=5s, it streams to the state store immediately. If the sandbox crashes at t=15s, that file is already safe.

**Live monitoring:** The engine watches for new files, tool calls, and cost updates in real-time. The frontend can show exactly what's happening inside the sandbox.

Implementation:
- **Local (Docker):** Mounted volume — engine watches the host-side mount point with `fs.watch()` or `chokidar`
- **Cloud (Vercel Sandbox):** Filesystem polling API or webhook on file write events

See [INTERRUPTS.md](INTERRUPTS.md) for the full interrupt protocol, including inline mode, checkpoint mode, and auto-escalation.

### 5. Agent Runner

Executes one phase at a time. The `AgentRunner` interface abstracts how a phase prompt is executed, allowing different implementations:

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

**Three implementations:**

| Runner | Use case | How it works |
|--------|----------|-------------|
| `MockRunner` | Testing | Writes predefined output files, returns configured costs. No API calls. |
| `ClaudeAgentRunner` | Local development | Runs Claude Agent SDK `query()` directly on the host. |
| `DockerAgentRunner` | Production (local) | Builds a Docker image with Claude Code CLI, runs agent inside a container with mounted workspace volume. |

`ClaudeAgentRunner` uses the Agent SDK:

```typescript
const result = await query({
  prompt: options.prompt,
  options: {
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: options.budget.maxTurns,
    tools: { type: 'preset', preset: 'claude_code' },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: PHASE_SYSTEM_PROMPT },
    cwd: options.workspacePath,
    model: 'claude-sonnet-4-6',
  },
});
```

`DockerAgentRunner` builds a one-time Docker image (`forgeflow-sandbox:latest`) and creates a container per phase with the workspace mounted as a volume. The agent runs inside the container; the engine watches the host-side mount point for output files and interrupt signals.

### 6. State Store

The state store holds all artifacts between phases. It's the single source of truth for a run's data.

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

interface StateFile {
  name: string;           // e.g., "clauses_parsed.json"
  content: Buffer;        // File contents
  producedByPhase: string; // Which phase created this
}
```

#### Local Implementation

```typescript
class LocalStateStore implements StateStore {
  // State lives at: ~/.forgeflow/runs/{runId}/
  //   ├── state.json          ← Run metadata
  //   ├── checkpoint.json     ← Checkpoint data (if paused)
  //   ├── inputs/             ← User-uploaded files
  //   └── artifacts/          ← All phase outputs
  //       ├── clauses_parsed.json
  //       ├── liability_findings.json
  //       └── ...
}
```

#### Cloud Implementation

```typescript
class CloudStateStore implements StateStore {
  // Run metadata: Postgres `runs` table
  // Artifacts: S3 bucket at s3://forgeflow-runs/{runId}/{filename}
  // Checkpoint data: Postgres `checkpoints` table
}
```

### 7. Checkpoint Manager

Checkpoints are phase boundaries where the engine also pauses for user input. The mechanism is the same as any phase boundary (serialize state), plus a wait.

```
Normal phase boundary:     serialize outputs → immediately start next phase
Checkpoint phase boundary: serialize outputs → wait for user → start next phase
```

```typescript
interface CheckpointState {
  runId: string;
  checkpointNodeId: string;
  status: 'waiting' | 'answered';
  presentFiles: string[];       // Output files to show the user
  waitingForFile: string;       // File the user needs to provide
  completedPhases: string[];    // All phases completed so far
  costSoFar: { turns: number; usd: number };
  presentation: {
    title: string;
    sections: string[];
  };
}
```

When the engine reaches a checkpoint node:
1. All prior phase outputs are already in the state store
2. Engine reads the checkpoint node's `config.inputs` from the state store
3. Engine emits a `checkpoint` event to the frontend with the data to present
4. Engine sets run status to `awaiting_input` and saves `CheckpointState`
5. Engine returns `{ status: 'awaiting_input' }` — **no sandbox running, zero cost**
6. User takes 5 minutes or 5 days — doesn't matter

To resume after a checkpoint, call `orchestrator.resume(flow, runId, checkpointInput)`:
1. Loads saved `RunState` (verifies `awaiting_input` status)
2. Loads `CheckpointState` to get `costSoFar` and `completedPhases`
3. Saves user's answer as an artifact in the state store
4. Re-validates flow and finds checkpoint position in execution plan
5. Continues execution from the phase after the checkpoint, carrying forward accumulated cost

**Auto-escalated checkpoints:** When an inline interrupt handler times out, the `InterruptWatcher` writes an `EscalatedAnswer` and the orchestrator creates a synthetic checkpoint. The run pauses with `awaiting_input` just like a normal checkpoint, and `resume()` picks up from the next phase.

### 8. Progress Streamer

Emits events from the execution engine to the frontend:

```typescript
type ProgressEvent =
  | { type: 'phase_started'; nodeId: string; nodeName: string; phaseNumber: number }
  | { type: 'phase_completed'; nodeId: string; outputFiles: string[]; cost: number; missingOutputs?: string[] }
  | { type: 'message'; content: string }
  | { type: 'checkpoint'; checkpoint: CheckpointState }
  | { type: 'interrupt'; interrupt: Interrupt }
  | { type: 'interrupt_answered'; interruptId: string; nodeId: string; escalated: boolean }
  | { type: 'cost_update'; turns: number; usd: number }
  | { type: 'run_completed'; success: boolean; totalCost: { turns: number; usd: number } }
  | { type: 'phase_failed'; nodeId: string; error: string }
  | { type: 'child_started'; childId: string; childName: string; parentPath: string[] }
  | { type: 'child_completed'; childId: string; childName: string; parentPath: string[]; outputFiles: string[] }
  | { type: 'resume'; runId: string; checkpointNodeId: string }
  | { type: 'file_written'; fileName: string; fileSize: number; nodeId: string }
  | { type: 'escalation_timeout'; interruptId: string; nodeId: string; timeoutMs: number };
```

| Local (MVP) | Cloud |
|-------------|-------|
| EventEmitter / WebSocket to localhost | WebSocket / SSE to client |
| Frontend polls or subscribes directly | Load balancer routes to correct instance |

### 9. Flow Orchestrator

The `FlowOrchestrator` coordinates all phases. It supports both initial execution and resuming from checkpoints:

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

The `InterruptWatcher` monitors the workspace `output/` directory using chokidar and handles:
- `__INTERRUPT__*.json` → queued for sequential handler processing with optional auto-escalation timeout
- `__CHILD_START__/*.json`, `__CHILD_DONE__*.json` → fire-and-forget progress events
- `__ANSWER__*.json` → ignored (written by the watcher itself)
- Regular files → emit `file_written` progress events for real-time streaming

## State Machine

```
ready
  → sandbox_creating (Phase 1)
    → phase_running (Phase 1)
      → phase_complete (Phase 1)
        → sandbox_creating (Phase 2)
          → phase_running (Phase 2)
            → phase_complete (Phase 2)
              → awaiting_input (Checkpoint)
                → sandbox_creating (Phase 3)
                  → phase_running (Phase 3)
                    → completed
                    → failed
```

Each transition:
1. Written to state store (local JSON file or database row)
2. Emitted as a progress event to the frontend
3. Gates what actions are available (can't answer checkpoint before it's reached)

## Data Flow: Complete Example

```
1. User opens flow designer, creates 4-node flow:
   Parse → Research (3 children) → ⛔ Checkpoint → Generate

2. User saves → FLOW.json written to flows/my-flow.json

3. User uploads contract.pdf → saved to state store as user input

4. User clicks Run → engine starts executeFlow():

   ┌─── Phase 1: Parse Contract ───────────────────────┐
   │ Engine creates sandbox                             │
   │   → copies contract.pdf into sandbox input/        │
   │   → no skills needed for this phase                │
   │ Agent runs: reads PDF, writes clauses_parsed.json  │
   │ Engine collects outputs → state store              │
   │ Engine destroys sandbox                            │
   │ Cost so far: $1.20, 8 turns                        │
   └───────────────────────────────────────────────────┘
        ↓ (state serialized to disk/DB)
   ┌─── Phase 2: Research ─────────────────────────────┐
   │ Engine creates sandbox                             │
   │   → copies clauses_parsed.json into sandbox input/ │
   │   → loads contract-law-basics skill into sandbox   │
   │ Agent runs: spawns 3 subagents via Task tool       │
   │   → Subagent A writes liability_findings.json      │
   │   → Subagent B writes ip_findings.json             │
   │   → Subagent C writes termination_findings.json    │
   │ Engine collects all 3 outputs → state store        │
   │ Engine destroys sandbox                            │
   │ Cost so far: $12.50, 85 turns                      │
   └───────────────────────────────────────────────────┘
        ↓ (state serialized to disk/DB)
   ┌─── Checkpoint: Attorney Review ───────────────────┐
   │ Engine reads checkpoint node config                │
   │ Engine loads presentation files from state store   │
   │ Engine emits checkpoint event → frontend           │
   │ NO SANDBOX RUNNING — zero cost while waiting       │
   │                                                    │
   │ Frontend shows risk analysis to attorney           │
   │ Attorney answers questions (5 min later, or 5 days)│
   │ Answers saved to state store as attorney_decisions  │
   └───────────────────────────────────────────────────┘
        ↓ (user input saved to state store)
   ┌─── Phase 3: Generate Deliverables ────────────────┐
   │ Engine creates sandbox                             │
   │   → copies ALL prior outputs + attorney_decisions  │
   │   → loads contract-law-basics skill                │
   │ Agent runs: generates redline, memo, risk summary  │
   │ Engine collects final outputs → state store        │
   │ Engine destroys sandbox                            │
   │ Total cost: $28.00, 180 turns                      │
   └───────────────────────────────────────────────────┘

5. Run complete → frontend shows results in state inspector
```

## Local vs Cloud Architecture

The execution engine uses the same interface everywhere. Only the adapters change:

| Concern | Local (MVP) | Cloud |
|---------|-------------|-------|
| **Sandbox** | Docker container per phase | Vercel Sandbox / Firecracker VM |
| **State store** | `~/.forgeflow/runs/{id}/` on disk | Postgres + S3 |
| **Skill library** | `~/.forgeflow/skills/` directory | Skill registry API |
| **Progress events** | EventEmitter / WebSocket to localhost | WebSocket / SSE to client |
| **API key** | User's `.env` file | Platform-managed per user |
| **Auth** | None (single user) | User accounts + API keys |
| **Billing** | None (user pays Anthropic directly) | Per-run metering |
| **Isolation** | Docker provides process isolation | VM-level isolation |
| **Flow storage** | `~/.forgeflow/flows/` directory | Postgres `flows` table |

The engine interface stays the same — swap `LocalStateStore` for `CloudStateStore`, `DockerSandboxManager` for `VercelSandboxManager`, and you're running in the cloud.

## System Prompt (Per-Phase)

Each phase's agent gets this appended to its system prompt:

```
You are executing one phase of a ForgeFlow workflow inside an isolated sandbox.

RULES:
- Write all output files to the output/ directory
- Read input files from the input/ directory
- Skills are available in skills/ (loaded into the sandbox for this phase)
- For parallel subagents: use the Task tool to spawn concurrent agents
- Verify each output file exists before finishing
- Stay within the budget constraints listed in the prompt
- You are executing ONE phase — do not attempt to run subsequent phases
- If you have children (subagents), launch them all concurrently and wait for completion
```

## Key Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Per-phase execution | Engine orchestrates, one agent per phase | Clean context, resource savings, natural serialization |
| Sandbox per phase | New container for each phase | Isolation, security, clean filesystem |
| Bidirectional sandbox channel | Filesystem watcher (chokidar), not just end-of-phase collection | Real-time interrupts, progressive output streaming, live monitoring |
| Flow validation before execution | Compiler-style type checking on FLOW.json | Catch dependency errors, missing inputs, cycles at design time |
| 5 interrupt types | approval, qa, selection, review, escalation | Covers all human-in-the-loop patterns across domains |
| Inline + checkpoint interrupt modes | Auto-escalate from inline → checkpoint on timeout via Promise.race | Quick questions stay fast, long pauses cost nothing |
| Progressive output streaming | InterruptWatcher emits `file_written` events for all output files | Real-time visibility, future fault recovery |
| State store abstraction | Interface with local/cloud adapters | Same engine code works everywhere |
| Per-child prompt files | Child prompts written to `prompts/` directory, parent has reference table | O(n) tokens per level instead of O(n^depth) with inlining |
| Resume after checkpoint | `orchestrator.resume()` reloads state and continues from checkpoint+1 | Supports long pauses (minutes, days) with zero cost |
| AgentRunner interface | MockRunner / ClaudeAgentRunner / DockerAgentRunner | Test without API, run locally, or run in Docker sandbox |
| Skills loaded per phase | Only declared skills copied to sandbox | Minimal context, faster startup |
