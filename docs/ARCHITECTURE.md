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

When a node has children, the prompt tells Claude to spawn subagents within this phase:

```markdown
# Phase: Research

You are executing one phase of a ForgeFlow workflow.

## Your Task
Coordinate 3 parallel research subagents. Each writes its own output file.

## Input Files
- input/clauses_parsed.json (from prior phase)

## Output Files (you MUST produce ALL of these)
- output/liability_findings.json
- output/ip_findings.json
- output/termination_findings.json

## Skills Available
- contract-law-basics (in skills/contract-law-basics/)

## Budget
- Max turns: 120
- Max cost: $15.00

## Subagents — Launch All 3 Concurrently

### Subagent 1: Liability & Indemnification Analyst
**Skills:** contract-law-basics
**Inputs:** output/clauses_parsed.json
**Outputs:** output/liability_findings.json
**Budget:** 35 turns, $4.00

Review all indemnification, limitation of liability, warranty, and insurance
clauses. For each: assess if terms are one-sided...

### Subagent 2: IP & Confidentiality Analyst
[...]

### Subagent 3: Termination & Governance Analyst
[...]

Launch all three concurrently using the Task tool. Each writes its own output file.
After all complete, verify all output files exist.
```

The key difference: subagents run **within** a phase (inside the same sandbox), spawned by Claude via the Task tool. Phase boundaries are managed by the engine.

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

Executes one phase at a time via Claude Agent SDK.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

interface PhaseRunOptions {
  prompt: string;                // Per-phase compiled prompt
  workspacePath: string;         // Sandbox workspace root
  budget: { maxTurns: number; maxBudgetUsd: number };
  onProgress: (event: ProgressEvent) => void;
}

async function runPhase(options: PhaseRunOptions): Promise<PhaseResult> {
  const result = await query({
    prompt: options.prompt,
    options: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: options.budget.maxTurns,
      maxBudgetUsd: options.budget.maxBudgetUsd,
      tools: { type: 'preset', preset: 'claude_code' },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: FLOWFORGE_PHASE_SYSTEM_PROMPT,
      },
      settingSources: ['project'],
      cwd: options.workspacePath,
      model: 'claude-opus-4-6',
    },
  });

  let finalResult = null;

  for await (const msg of result) {
    if (msg.type === 'assistant') {
      options.onProgress({ type: 'message', content: extractText(msg) });
    } else if (msg.type === 'result') {
      finalResult = msg;
    }
  }

  return {
    success: finalResult?.subtype === 'success',
    cost: finalResult?.total_cost_usd ?? 0,
    turns: finalResult?.num_turns ?? 0,
    outputFiles: listOutputFiles(options.workspacePath),
  };
}
```

### 6. State Store

The state store holds all artifacts between phases. It's the single source of truth for a run's data.

```typescript
interface StateStore {
  // Save output files from a completed phase
  savePhaseOutputs(runId: string, phaseId: string, files: StateFile[]): Promise<void>;

  // Load input files needed for a phase (from user uploads + prior phase outputs)
  loadPhaseInputs(runId: string, phaseId: string, inputNames: string[]): Promise<StateFile[]>;

  // Save/load run metadata (status, cost, completed phases)
  saveRunState(runId: string, state: RunState): Promise<void>;
  loadRunState(runId: string): Promise<RunState>;

  // Save/load checkpoint data (for human-in-the-loop pauses)
  saveCheckpoint(runId: string, checkpoint: CheckpointState): Promise<void>;
  loadCheckpoint(runId: string): Promise<CheckpointState | null>;
  saveCheckpointAnswer(runId: string, answerFile: StateFile): Promise<void>;
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
4. Engine sets run status to `awaiting_input`
5. **No sandbox running** — zero cost while waiting
6. User takes 5 minutes or 5 days — doesn't matter
7. User provides input → written to state store as the checkpoint's output file
8. Engine sets run status back to `processing`
9. Engine creates a new sandbox for the next phase, with all prior outputs + user input

### 8. Progress Streamer

Emits events from the execution engine to the frontend:

```typescript
type ProgressEvent =
  | { type: 'phase_started'; nodeId: string; nodeName: string; phaseNumber: number }
  | { type: 'phase_completed'; nodeId: string; outputFiles: string[]; cost: number }
  | { type: 'message'; content: string }          // Agent text output within a phase
  | { type: 'tool_call'; toolName: string }        // Agent tool usage
  | { type: 'subagent_spawned'; childId: string }  // Subagent within a phase
  | { type: 'checkpoint'; checkpoint: CheckpointState }
  | { type: 'interrupt'; interrupt: Interrupt }    // Real-time interrupt from any depth
  | { type: 'output_streamed'; file: string; nodeId: string }  // Progressive output
  | { type: 'cost_update'; turns: number; usd: number }
  | { type: 'run_completed'; result: RunResult }
  | { type: 'phase_failed'; nodeId: string; error: string };
```

| Local (MVP) | Cloud |
|-------------|-------|
| EventEmitter / WebSocket to localhost | WebSocket / SSE to client |
| Frontend polls or subscribes directly | Load balancer routes to correct instance |

### 9. Flow Orchestrator

The top-level loop that coordinates everything:

```typescript
async function executeFlow(flowJson: FlowDefinition, userInputs: StateFile[]): Promise<RunResult> {
  const runId = generateRunId();
  const stateStore = getStateStore(); // Local or cloud adapter

  // Save user inputs to state store
  await stateStore.savePhaseOutputs(runId, '__user_inputs__', userInputs);

  // Topological sort nodes by edges
  const executionOrder = topologicalSort(flowJson.nodes, flowJson.edges);

  let totalCost = 0;
  let totalTurns = 0;

  for (const node of executionOrder) {
    // --- Checkpoint node: pause for user input ---
    if (node.type === 'checkpoint') {
      const checkpoint: CheckpointState = {
        runId,
        checkpointNodeId: node.id,
        status: 'waiting',
        presentFiles: node.config.inputs,
        waitingForFile: node.config.outputs[0],
        completedPhases: executionOrder
          .slice(0, executionOrder.indexOf(node))
          .map(n => n.id),
        costSoFar: { turns: totalTurns, usd: totalCost },
        presentation: node.config.presentation!,
      };
      await stateStore.saveCheckpoint(runId, checkpoint);
      emit({ type: 'checkpoint', checkpoint });

      // Wait for user to provide input (could be minutes or days)
      await waitForCheckpointAnswer(runId);
      continue;
    }

    // --- Agent or Merge node: execute in sandbox ---
    emit({ type: 'phase_started', nodeId: node.id, nodeName: node.name });

    // 1. Compile per-phase prompt
    const prompt = compilePhasePrompt(node, flowJson.skills);

    // 2. Resolve skills for this node
    const skills = resolveSkills(node, flowJson.skills);

    // 3. Load input files from state store
    const inputs = await stateStore.loadPhaseInputs(runId, node.id, node.config.inputs);

    // 4. Create sandbox with only what this phase needs
    const sandbox = await sandboxManager.create({
      phaseId: node.id,
      runId,
      skills,
      inputFiles: inputs,
    });

    // 5. Run the agent
    const result = await runPhase({
      prompt,
      workspacePath: sandbox.workspacePath,
      budget: node.config.budget ?? flowJson.budget,
      onProgress: emit,
    });

    // 6. Collect outputs → state store
    const outputs = await sandboxManager.collect(sandbox);
    await stateStore.savePhaseOutputs(runId, node.id, outputs);

    // 7. Tear down sandbox
    await sandboxManager.destroy(sandbox);

    totalCost += result.cost;
    totalTurns += result.turns;

    emit({ type: 'phase_completed', nodeId: node.id, outputFiles: outputs.map(f => f.name), cost: result.cost });
  }

  return { success: true, totalCost, totalTurns };
}
```

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
| Bidirectional sandbox channel | Filesystem watcher, not just end-of-phase collection | Real-time interrupts, progressive output streaming, live monitoring |
| Flow validation before execution | Compiler-style type checking on FLOW.json | Catch dependency errors, missing inputs, cycles at design time |
| 5 interrupt types | approval, qa, selection, review, escalation | Covers all human-in-the-loop patterns across domains |
| Inline + checkpoint interrupt modes | Auto-escalate from inline → checkpoint on timeout | Quick questions stay fast, long pauses cost nothing |
| Progressive output streaming | Files stream to state store as written | Better fault recovery, real-time visibility |
| State store abstraction | Interface with local/cloud adapters | Same engine code works everywhere |
| Subagents within phases | Claude spawns via Task tool | Leverages Agent SDK's native concurrency |
| Skills loaded per phase | Only declared skills copied to sandbox | Minimal context, faster startup |
