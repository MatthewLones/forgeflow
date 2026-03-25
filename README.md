# ForgeFlow

A programming language and IDE for building AI agents. Crystallize any repeatable professional process — contract review, insurance claims, permit analysis — into a structured, executable workflow that Claude runs with human oversight at every step.

## Why ForgeFlow?

You're a lawyer who reviews 50 contracts a month. You're a contractor who processes permit applications. You're an analyst who writes the same research report every quarter. You know exactly how the work should be done — the steps, the decision points, the places where judgment matters.

ForgeFlow lets you turn that expertise into a program. Not by writing Python, but by describing your process in plain language, packaging your domain knowledge into reusable **skills**, and letting a compiler, validator, and runtime handle the rest. The agent follows your structure. When it needs your judgment, it asks — then picks up where it left off.

**Structure without rigidity.** ForgeFlow is a full language: it has a type system for file schemas, a validator that catches dependency errors at design time, a compiler that produces per-phase prompts, and a sandboxed runtime. But authoring a workflow feels like writing a document. Slash commands (`/output`, `/decision`, `/guardrail`, `//skill:`) render as interactive chips in the editor — you describe what each step does, declare what goes in and out, and the toolchain enforces correctness.

**Human-in-the-loop by design.** Five interrupt types let the agent ask for approval, ask questions, present selections, request edits, or escalate findings — from any depth in the workflow, in real-time. The agent pauses, you respond, it continues. If you step away, it auto-saves and waits at zero cost. Resume minutes or days later.

## How It Works

You build workflows from three primitives:

**Skills** are packages of domain knowledge — a `SKILL.md` with routing logic, reference files with the actual expertise, and optional scripts. A "California ADU Code" skill, a "Contract Law Basics" skill, a "Tax Prep Checklist" skill. Skills are standalone and composable: any workflow can reference any skill.

**Nodes** are units of work. An **agent node** runs Claude with your instructions and loaded skills. A **checkpoint node** pauses the workflow, shows data to the human, and waits for input. Nodes can contain sub-agents that run in parallel.

**Flows** connect nodes into a multi-phase pipeline defined in `FLOW.json`:

```
[Parse Input] → [Research (3 parallel sub-agents)] → [⛔ Human Review] → [Generate Output]
```

Each node declares its inputs, outputs, skills, and budget. The engine validates dependencies, compiles per-phase prompts, and executes each phase in its own sandbox — clean context, fault isolation, and automatic state serialization between every step.

## The IDE

ForgeFlow ships as a full workspace: a visual dependency graph, tabbed editors with slash-command chips, a skill authoring system, a run dashboard with live progress, and **Forge** — a built-in AI copilot that helps you build workflows conversationally.

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

- 40+ keyboard shortcuts (remappable)
- Git version control and GitHub integration per project
- `.forge` export/import for sharing portable project bundles
- Desktop app (Electron) and CLI for headless execution

## Under the Hood

ForgeFlow works like a compiled language:

| Language Concept | ForgeFlow Equivalent |
|-----------------|---------------------|
| Source code | `FLOW.json` |
| Type system | Artifact schemas on inputs/outputs |
| Linter / type checker | 11-rule validator with dependency resolution |
| Compiler | Staged IR pipeline (flow graph → phase IR → executable prompt) |
| Linker | Skill resolver (loads and composes skill trees) |
| Runtime | Per-phase orchestrator with sandboxed execution |
| Process isolation | Docker container per phase |
| IPC / signals | 5 interrupt types (approval, Q&A, selection, review, escalation) |
| Libraries | Skills (reusable, composable domain knowledge) |
| Debugger | Run dashboard with live SSE streaming |
| Package format | `.forge` bundles |

Each phase runs in a fresh sandbox with only its declared inputs and skills. The engine orchestrates **between** phases; Claude orchestrates **within** a phase (spawning sub-agents, firing interrupts). State serializes to disk between every step — if phase 2 fails, phase 1's outputs are safe.

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

The attorney defines this once. Every future contract runs through the same process — with the agent asking for judgment at the right moments.

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

## Roadmap

- [x] Core runtime engine with per-phase execution and state serialization
- [x] 5 interrupt types with inline, checkpoint, and auto-escalate modes
- [x] CLI with mock, local, and Docker runners
- [x] Visual IDE with dependency graph, agent editor, skill editor
- [x] Forge AI copilot (conversational flow building with 13 MCP tools)
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
