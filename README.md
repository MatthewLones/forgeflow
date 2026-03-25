# ForgeFlow

A programming language and IDE for building AI agents. Crystallize any repeatable professional process — contract review, insurance claims, permit analysis — into a structured, executable workflow that Claude runs with human oversight at every step.

## Why ForgeFlow?

Many professional workflows — contract review, insurance claims, due diligence, permit analysis — follow a repeatable structure: defined steps, known decision points, clear judgment calls. ForgeFlow lets domain experts encode that structure as a program. Not in Python, but in a declarative format backed by a full toolchain: type system, validator, compiler, sandboxed runtime, and a visual IDE.

**A full language toolchain.** ForgeFlow has a type system (artifact schemas with 7 formats and typed fields), an 11-rule validator with dependency resolution across 4 categories, a staged compiler (flow graph → phase IR → executable prompts), and a per-phase sandboxed runtime. Authoring happens in the IDE with slash commands that render as color-coded chips:

- `/skill:name` (green) — attach a skill to a node
- `//agent:name` (blue) — reference a child sub-agent
- `@artifact` (purple) — declare an input artifact
- `\artifact` (purple) — declare an output artifact
- `/interrupt:type` (red) — declare an interrupt point (approval, Q&A, selection, review, escalation)
- `/merge` (amber) — merge marker for parallel branches

Declare what each step reads, what it produces, and the toolchain infers edges, validates data flow, and compiles per-phase prompts.

**Human-in-the-loop by design.** Five interrupt types with three modes — inline (agent pauses, sandbox stays alive), checkpoint (state serialized, sandbox torn down, zero cost), and auto-escalate (inline with configurable timeout that promotes to checkpoint). Interrupts fire from any depth in the node tree in real-time. The agent pauses, the human responds, the agent continues. Step away for days — resume where it left off.

## How It Works

You build workflows from three primitives:

**Skills** are packages of domain knowledge — a `SKILL.md` with routing logic, reference files with the actual expertise, and optional scripts. A "California ADU Code" skill, a "Contract Law Basics" skill, a "Tax Prep Checklist" skill. Skills are standalone and composable: any workflow can reference any skill.

**Nodes** are units of work. An **agent node** runs Claude with your instructions and loaded skills. A **checkpoint node** pauses the workflow, shows data to the human, and waits for input. Nodes have budget constraints (`maxTurns`, `maxBudgetUsd`) and can contain sub-agents that auto-sort into concurrent waves based on sibling I/O dependencies.

**Flows** connect nodes into a multi-phase pipeline defined in `FLOW.json`:

```
[Parse Input] → [Research (3 parallel sub-agents)] → [⛔ Human Review] → [Generate Output]
```

Each node declares its inputs, outputs, skills, and budget. The engine validates dependencies, compiles per-phase prompts, and executes each phase in its own sandbox — clean context, fault isolation, and automatic state serialization between every step.

**Artifacts** are the typed files that flow between nodes. Each artifact has a schema: a name, one of 7 formats (`json`, `markdown`, `text`, `csv`, `pdf`, `image`, `binary`), a description, and optional typed fields for JSON artifacts. A flow-level artifact registry defines shared schemas. The validator traces every node input back to a user upload or a prior node's output. Edges between nodes are auto-inferred from `@input` and `\output` declarations — declare the data flow, and the dependency graph builds itself.

## The IDE

ForgeFlow ships as a full workspace: a visual dependency graph, tabbed editors with slash-command chips, a skill authoring system, a run dashboard with live progress, and **Forge** — a built-in AI copilot with 14 MCP tools for reading, writing, validating, and compiling flows conversationally.

```
┌────────────┬──────────────────────────────────────┬──────────┐
│            │  Dependency Graph (visual overview)   │          │
│  Explorer  │  Click to select, drill into children │  Forge   │
│  (sidebar) ├──────────────────────────────────────┤  AI      │
│            │  Editor (tabbed, multi-panel)          │  Copilot │
│  Agents    │  Write instructions with /slash chips │          │
│  Skills    │  Configure I/O, budgets, interrupts   │          │
│  Refs      │  Skill editor with compiled preview   │          │
├────────────┴──────────────────────────────────────┴──────────┤
│  Git Panel │ Run Panel │ Validation                           │
└──────────────────────────────────────────────────────────────┘
```

- **Run dashboard** — live SSE streaming, per-phase progress, artifact output preview, interactive interrupt forms
- **40+ keyboard shortcuts** (remappable), interactive guide overlay
- **Git version control** and GitHub integration per project
- **`.forge` export/import** for sharing portable project bundles
- **Desktop app** (Electron) and **CLI** (`forgeflow run` / `forgeflow resume`) for headless execution

## Under the Hood

ForgeFlow works like a compiled language:

| Language Concept | ForgeFlow Equivalent |
|-----------------|---------------------|
| Source code | `FLOW.json` |
| Type system | ArtifactSchema (7 formats, typed fields, flow-level registry) |
| Linter / type checker | 11 rules across 4 categories (structural, type-system, dataflow, resource) |
| Compiler | Staged IR pipeline (flow graph → phase IR → executable prompt) |
| Linker | Skill resolver (loads and composes skill trees) |
| Runtime | Per-phase orchestrator with sandboxed execution |
| Process isolation | Docker container per phase |
| IPC / signals | 5 interrupt types (approval, Q&A, selection, review, escalation) |
| Libraries | Skills (reusable, composable domain knowledge) |
| Debugger | Run dashboard with live SSE streaming |
| Package format | `.forge` bundles |

Each phase runs in a fresh sandbox with only its declared inputs and skills. The engine orchestrates **between** phases; Claude orchestrates **within** a phase (spawning sub-agents, firing interrupts). State serializes to disk between every step — if phase 2 fails, phase 1's outputs are safe. Output files stream to the state store as the agent writes them (not at phase end), so the run dashboard shows artifacts appearing in real-time.

### Key Design Decisions

**Budget system.** Flows have a global budget (`maxTurns`, `maxBudgetUsd`, `timeoutMs`). Nodes have per-node budgets. The validator warns if budgets are missing or inconsistent. Agent SDK enforces limits at runtime.

**Wave-based child ordering.** Children within a parent node are auto-grouped into concurrent waves by topologically sorting sibling I/O dependencies. Wave 0 children have no sibling deps and run concurrently; wave 1 depends on wave 0 outputs. No manual ordering annotations needed.

**Progressive output streaming.** The `InterruptWatcher` monitors the agent's output directory via filesystem events. Files emit `file_written` progress events as they're created, streaming to the run dashboard in real-time rather than batching at phase end.

**Artifact auto-edges.** When a node's `@input` matches another node's `\output`, the validator auto-creates a dependency edge. Remove the reference, the edge disappears. Manual edges are also supported.

**Per-child prompt files.** Each child sub-agent gets its own compiled prompt file in `workspace/prompts/`. The parent prompt has a reference table. This keeps token usage O(n) per nesting level instead of O(n^depth).

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for sandboxed execution)
- Anthropic API key (for running flows with Claude)

### Install

```bash
git clone https://github.com/forgeflow/forgeflow.git
cd forgeflow
pnpm install
```

### Set Up API Key

```bash
echo "ANTHROPIC_API_KEY=sk-your-key-here" > packages/server/.env
```

### Run the IDE

```bash
pnpm dev
# Server: http://localhost:3001
# UI:     http://localhost:5173
```

### Run a Flow via CLI

```bash
# With mock runner (no API key needed — great for testing)
pnpm --filter @forgeflow/cli start -- run ./examples/contract-review --mock --input contract.pdf

# With Claude locally (requires ANTHROPIC_API_KEY)
pnpm --filter @forgeflow/cli start -- run ./examples/contract-review --local --input contract.pdf

# With Docker sandbox (production isolation)
pnpm --filter @forgeflow/cli start -- run ./examples/contract-review --docker --input contract.pdf

# Resume after checkpoint
pnpm --filter @forgeflow/cli start -- resume ./examples/contract-review <run-id> --input attorney_decisions.json
```

### Run the Desktop App

```bash
pnpm dev:desktop
```

## Example: Contract Review

A lawyer uploads a contract. ForgeFlow runs a 4-phase workflow:

```
Phase 1: Parse Contract
  → Agent reads PDF, extracts clauses into structured JSON

Phase 2: Research (3 parallel sub-agents)
  → Liability analyst, IP analyst, termination analyst
  → Each loads the contract-law-basics skill
  → All run concurrently, produce findings independently

⛔ Checkpoint: Attorney Review
  → No agent running — zero cost while waiting
  → Attorney sees risk analysis, makes decisions
  → Resumes 5 minutes or 5 days later

Phase 3: Generate Deliverables
  → Produces redlined contract, negotiation memo, risk summary
  → Uses attorney's decisions + all prior findings
```

Each phase runs in its own container. State serializes between phases. The checkpoint has zero runtime cost — no sandbox running while waiting for the human.

## Packages

| Package | Description |
|---------|-------------|
| `@forgeflow/types` | Pure type declarations (zero runtime) |
| `@forgeflow/parser` | Zod schema validation for FLOW.json |
| `@forgeflow/validator` | 11-rule validation pipeline with FlowGraph symbol table |
| `@forgeflow/compiler` | Staged IR pipeline: flow graph → phase IR → markdown |
| `@forgeflow/skill-resolver` | Loads skills from disk with search path resolution |
| `@forgeflow/state-store` | State interface + filesystem implementation |
| `@forgeflow/engine` | Orchestrator, agent runners (mock/local/Docker), interrupt watcher |
| `@forgeflow/cli` | `forgeflow run` + `forgeflow resume` |
| `@forgeflow/ui` | React 19 IDE (Vite, dockview, React Flow, CodeMirror 6) |
| `@forgeflow/server` | Express 5 API: projects, runs, copilot, git, SSE |
| `@forgeflow/desktop` | Electron 35 desktop app |

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system design: runtime, server, UI, interrupts, git, copilot |
| [FLOW-FORMAT.md](docs/FLOW-FORMAT.md) | FLOW.json specification and compilation pipeline |
| [SKILL-FORMAT.md](docs/SKILL-FORMAT.md) | Skill directory structure and conventions |
| [PIPELINE.md](docs/PIPELINE.md) | Compiler IR pipeline: resolve stage, generate stage, wave ordering, child prompts |

## Roadmap

- [x] Core runtime engine with per-phase execution and state serialization
- [x] 5 interrupt types with inline, checkpoint, and auto-escalate modes
- [x] CLI with mock, local, and Docker runners
- [x] Visual IDE with dependency graph, agent editor, skill editor
- [x] Forge AI copilot (conversational flow building with 14 MCP tools)
- [x] Run dashboard with real-time progress and interrupt UI
- [x] Git version control and GitHub integration
- [x] Desktop app and .forge export/import
- [ ] Cloud sandbox (Vercel Sandbox + S3 state store)
- [ ] Skill marketplace
- [ ] Multi-user collaboration

## Origin

ForgeFlow is generalized from [CrossBeam](https://github.com/forgeflow/crossbeam), which won first place at the Claude Code Hackathon (Feb 2026) by applying this architecture to ADU permit processing.

## Contributing

```bash
pnpm install          # Install all dependencies
pnpm test             # Run all tests (~234 across 11 packages)
pnpm build            # Build all packages
```

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `pnpm test && pnpm build`
5. Open a pull request

## License

MIT
