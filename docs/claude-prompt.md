# FlowForge — Agent Build Prompt

You are building FlowForge, an open-source platform for designing and executing long-running AI agent workflows.

## Key Files

Read these files for full context:
- `SPEC.md` — Product specification (what we're building)
- `ARCHITECTURE.md` — System architecture (how it fits together)
- `FLOW-FORMAT.md` — FLOW.json specification (the core data format)
- `SKILL-FORMAT.md` — Skill directory format (knowledge packaging)
- `INTERRUPTS.md` — Interrupt type system (5 types, inline/checkpoint modes, auto-escalate)
- `CROSSBEAM-PATTERNS.md` — 8 patterns we're generalizing from CrossBeam
- `EXAMPLES.md` — Example flows for different domains
- `claude-task.json` — Phase tracker (current progress)

## Project Overview

FlowForge lets users build multi-phase agent workflows visually (or in JSON/markdown). It has three layers:

1. **Flow Designer** — React web app with a DAG canvas, node inspector panel, and recursive node navigation
2. **Execution Engine** — Node.js service that orchestrates flows **phase-by-phase**, running each node in its own sandbox via Claude Agent SDK
3. **State Store** — Persistent storage for artifacts between phases (local disk for MVP, DB/S3 for cloud)

## Critical Architecture: Per-Phase Execution

The engine does NOT compile the entire flow into one prompt. It orchestrates phase-by-phase:

```
For each node in topological order:
  1. Compile a per-phase prompt (just this node's instructions + inputs + skills)
  2. Spin up sandbox (Docker container locally, Vercel Sandbox in cloud)
  3. Copy inputs from state store → sandbox workspace
  4. Start bidirectional sandbox channel (filesystem watcher)
  5. Run agent (Agent SDK query()) with per-phase prompt
  6. During execution: stream completed outputs to state store, detect interrupts
  7. Collect remaining outputs from sandbox → state store
  8. Tear down sandbox
  9. If next node is checkpoint: pause for user input
  10. Otherwise: continue to next node
```

Within a phase, Claude can spawn subagents via the Task tool (for nodes with children). But between phases, the engine orchestrates.

## Critical Architecture: Interrupt System

Agents can request human input during execution via **5 interrupt types**: approval, Q&A, selection, review & edit, escalation. Interrupts fire from any depth in the recursive node tree.

**Two modes:**
- **Inline** — agent pauses in place, polls for answer, sandbox stays alive. Best for quick questions.
- **Checkpoint** — full serialization, sandbox torn down, zero cost while waiting. Best for long reviews.
- **Auto-escalate (default)** — starts inline, converts to checkpoint after timeout (default 5 minutes).

The **bidirectional sandbox channel** (filesystem watcher on the mounted volume) enables real-time interrupt streaming and progressive output collection. Interrupt signals (`__INTERRUPT__*.json`) and answer signals (`__ANSWER__*.json`) pass through the shared filesystem.

See `INTERRUPTS.md` for the full spec — TypeScript interfaces, nested interrupt protocol, resume manifests, and the agent-side interrupt protocol.

## Technical Decisions

- **LLM**: Claude-only via `@anthropic-ai/claude-agent-sdk`
- **Frontend**: React (framework TBD — could be Next.js, Vite, etc.)
- **Backend**: Node.js with TypeScript
- **Sandbox (local)**: Docker container per phase
- **Sandbox (cloud)**: Vercel Sandbox / Firecracker VM
- **State store (local)**: Files on disk at `~/.flowforge/runs/{id}/`
- **State store (cloud)**: Postgres + S3
- **DAG library**: TBD (options: React Flow, D3, custom)
- **Deployment**: Local-first, user provides their own Anthropic API key

## Phase Structure

### Phase 1: Core Data Model + Flow Validator + Phase Compiler
**Goal:** Can validate FLOW.json and compile per-phase prompts from node configs

Tasks:
- Define TypeScript types for FlowDefinition, FlowNode, FlowEdge, InterruptConfig, and all 5 interrupt types
- Implement Flow Validator — compiler-style type checking:
  - Structural checks: DAG validation (no cycles), unique IDs, valid edges, orphan/dead-end detection
  - Dependency resolution: every input traces to a user upload or prior node's output
  - Budget checks: node budget sum vs. flow budget, oversized budgets for simple tasks
  - Interrupt validation: review interrupts reference existing files, depth-2+ interrupt warnings
  - Output: `ValidationResult` with errors, warnings, suggestions, and resolved `ExecutionPlan`
- Implement phase compiler: given a FlowNode + resolved inputs + skills → per-phase markdown prompt
  - Include interrupt protocol instructions for interrupt-capable nodes
- Implement topological sort for execution order
- Test with example flows from EXAMPLES.md
- Verify generated per-phase prompts are well-structured and Claude can follow them

Verification:
- Validate all 3 example flows — zero errors
- Introduce intentional errors (missing input, cycle, duplicate output) and verify the validator catches them with helpful messages
- Compile per-phase prompts for all nodes in all 3 example flows
- Verify interrupt-capable nodes get the interrupt protocol in their prompts
- Manually run a per-phase prompt via Claude and confirm it follows instructions

### Phase 2: Execution Engine + Sandbox + State Store + Interrupts
**Goal:** Can run a flow phase-by-phase in sandboxes with state serialization, real-time interrupts, and progressive output streaming

Tasks:
- Implement State Store interface (local adapter: files on disk)
- Implement Sandbox Manager interface (local adapter: Docker containers)
- Implement sandbox lifecycle: create → copy inputs → run → collect outputs → destroy
- Implement **Bidirectional Sandbox Channel**:
  - Filesystem watcher (chokidar/fs.watch) on mounted Docker volume
  - Detect `__INTERRUPT__*.json` files → stream to frontend in real-time
  - Write `__ANSWER__*.json` files into sandbox for inline interrupt responses
  - Progressive output collection — copy completed output files to state store as they're written
  - Distinguish: final outputs, interrupt signals, answer signals, partial outputs
- Implement all **5 interrupt types** (approval, Q&A, selection, review, escalation):
  - Inline mode: agent polls for answer, sandbox stays alive
  - Checkpoint mode: serialize + teardown, zero cost while waiting
  - Auto-escalate: inline → checkpoint after configurable timeout (default 5 minutes)
  - Nested interrupts: resume manifests tracking completed siblings vs interrupted agents
- Implement Flow Orchestrator: topological sort → per-phase execution loop
- Implement progress event streaming (phase_started, phase_completed, interrupt, output_streamed, cost_update)
- Implement checkpoint handling (serialize state → pause → wait for user input → resume)
- Test with a simple 3-node flow end-to-end

Verification:
- Run the paper_summary example flow with a real PDF input
- Verify state is serialized between every phase (check state store contents)
- Run the contract_review example flow and verify checkpoint pause/resume
- Verify sandbox isolation (each phase gets a clean workspace)
- Verify that only declared skills are loaded into each phase's sandbox
- Trigger an inline interrupt from a subagent — verify it streams to frontend in real-time
- Verify auto-escalate: inline interrupt that times out converts to checkpoint mode
- Verify progressive output streaming: kill a sandbox mid-phase, confirm completed outputs are safe in state store
- Verify nested interrupt resume: interrupt one of 3 subagents, verify siblings' outputs preserved, only interrupted agent re-runs

### Phase 3: Flow Designer UI
**Goal:** Visual flow editor that produces valid FLOW.json

Tasks:
- Set up React project with DAG canvas library
- Implement node palette (drag to add agent, checkpoint, merge nodes)
- Implement edge drawing (connect nodes)
- Implement node inspector panel (config form + instructions textarea)
- Implement recursive node navigation (double-click to zoom into children, breadcrumb to go back)
- Implement FLOW.json save/load
- Implement skill library browser (reads local skills/ directory)
- Wire up to execution engine (Run button)

Verification:
- Recreate the contract_review example flow visually
- Save and verify the generated FLOW.json matches the expected format
- Navigate into the "Risk Analysis" node and see its 3 children

### Phase 4: Run Viewer + Interrupt UI
**Goal:** Real-time execution monitoring, state inspection, and interrupt handling

Tasks:
- Implement progress view (which phase is executing, sandbox status, streaming messages)
- Implement state inspector (click any completed phase → view its output files from state store)
- Implement checkpoint UI (render questions from checkpoint output, collect answers)
- Implement **interrupt panel** — renders all 5 interrupt types with appropriate UI:
  - **Approval**: approve/reject/modify buttons with modification text field
  - **Q&A**: form with typed inputs (text, number, choice, boolean) matching question schema
  - **Selection**: checklist with descriptions, recommendations highlighted, min/max constraints
  - **Review & Edit**: markdown/text editor with the draft pre-loaded, accept/edit toggle
  - **Escalation**: severity badge, finding display, acknowledge/override/route actions
- Show interrupt source path (which subagent at what depth asked the question)
- Real-time interrupt streaming — questions appear the moment the agent writes them
- Show progressive output indicators (files appearing in state store during execution)
- Implement cost meter (running total of turns and dollars per phase + cumulative)
- Implement run history (list past runs, view their results from state store)
- Show sandbox lifecycle events (creating, running, collecting, destroyed)

Verification:
- Run a flow and watch real-time progress with phase transitions
- Inspect output files at each completed phase (from state store, not sandbox)
- Hit a checkpoint, answer questions, verify resume works in a fresh sandbox
- Trigger each of the 5 interrupt types and verify the UI renders correctly
- Answer an inline interrupt and verify the agent resumes seamlessly
- Let an inline interrupt auto-escalate to checkpoint — verify UI transitions correctly
- Verify cost tracking matches actual Agent SDK reported costs

### Phase 5: Polish + Documentation
**Goal:** Ready for others to use

Tasks:
- Error handling (phase-level retry, graceful failures, informative error messages)
- Edge cases (empty flows, disconnected nodes, missing skills, sandbox creation failures)
- README with setup instructions (Docker requirement for local, env vars for API key)
- Example skills + flows bundled
- CLI alternative to web UI (for power users)
- Cloud adapter documentation (how to swap local adapters for cloud)

## Key Rules

1. **FLOW.json is the source of truth.** The visual editor generates it. The flow validator checks it. The phase compiler reads it. The engine runs it. Everything flows from this format.

2. **Validate before you run.** The flow validator catches errors at design time — dependency resolution, cycle detection, budget checks, interrupt validation. Never let a malformed flow reach the execution engine.

3. **Skills are unchanged from CrossBeam.** The SKILL.md + references/ format works. Don't reinvent it.

4. **Per-phase execution.** The engine orchestrates between phases. Claude orchestrates within a phase (subagents via Task tool). Each phase gets its own sandbox with only its declared inputs and skills.

5. **Bidirectional sandbox channel.** The sandbox is not a black box. A live filesystem watcher connects the engine to the sandbox throughout execution — enabling real-time interrupts, progressive output streaming, and live monitoring.

6. **Five interrupt types.** Approval, Q&A, selection, review, escalation. Each can fire from any depth in the node tree. Default to inline mode with auto-escalate to checkpoint on timeout. See `INTERRUPTS.md` for the full spec.

7. **State serialized between every phase.** Not just at checkpoints. Progressive output streaming also saves files to the state store as they're written within a phase. State store is the single source of truth.

8. **Sandbox isolation.** Every agent run executes in its own container. The agent can only see its workspace (input/, output/, skills/). No access to the host filesystem or other runs.

9. **Budget constraints on everything.** Every flow and every node has maxTurns and maxBudgetUsd. The Agent SDK enforces these per-phase.

10. **Local-to-cloud is an adapter swap.** Same engine code. Swap `LocalStateStore` → `CloudStateStore`, `DockerSandboxManager` → `VercelSandboxManager`. Architecture must support this from day one.
