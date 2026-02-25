# ForgeFlow

An open-source IDE and runtime for building AI agent workflows. Design multi-phase, multi-agent flows visually — Claude executes them with per-phase sandboxing, file-based state, and human-in-the-loop checkpoints.

<!-- TODO: Add badges (license, build, tests) -->
<!-- TODO: Add screenshot of workspace view -->

## What Is ForgeFlow?

ForgeFlow is both a **visual workflow designer** and an **execution engine** for complex AI agent tasks. You define workflows as directed acyclic graphs (DAGs) of nodes — each node runs in its own Docker sandbox via Claude Agent SDK, with state serialized between phases. Skills package reusable domain knowledge that any flow can reference.

The IDE provides an IDE-like workspace with a DAG canvas, tabbed code editors, a skill authoring system with slash commands, and **Forge** — a built-in AI copilot powered by Claude that helps you build and modify workflows conversationally.

ForgeFlow is generalized from [CrossBeam](https://github.com/...), which won first place at the Claude Code Hackathon (Feb 2026) by applying this architecture to ADU permit processing. See [CROSSBEAM-PATTERNS.md](docs/CROSSBEAM-PATTERNS.md) for the 8 patterns extracted.

## Key Features

- **Visual DAG designer** — React Flow canvas with custom node types (Agent, Checkpoint, Merge), breadcrumb drill-down into recursive sub-agents
- **IDE-like workspace** — Multi-panel tabbed editor (dockview), resizable sidebar, collapsible DAG view, split panes with keyboard shortcuts
- **Agent editor** — Write agent instructions with slash commands, configure I/O files, budgets, skills, interrupts, and sub-agents
- **Skill editor** — Author skills in CodeMirror 6 with slash commands (`/output`, `/input`, `/decision`, `/guardrail`, `//skill:`, `@file`), chip decorations, compiled preview, and raw markdown view
- **Per-phase execution** — Each node runs in a fresh Docker sandbox. Clean context windows, fault isolation, and natural state serialization between every phase
- **5 interrupt types** — Approval, Q&A, Selection, Review & Edit, Escalation. Inline mode (agent pauses in place), checkpoint mode (zero cost while waiting), and auto-escalate (inline → checkpoint on timeout)
- **Budget constraints** — `maxTurns` and `maxBudgetUsd` on every flow and node, enforced by Agent SDK
- **Checkpoints** — Flow pauses at defined boundaries with zero cost. Resume minutes or days later
- **Forge AI copilot** — Claude-powered assistant panel for conversational workflow building (UI shell built, API integration coming soon)
- **CLI** — `forgeflow run` and `forgeflow resume` for headless execution with mock, local, or Docker runners

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

### Run the Visual IDE

```bash
pnpm --filter @forgeflow/ui dev
# Open http://localhost:5173
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

## Architecture Overview

ForgeFlow has two layers: an **IDE** for designing workflows, and a **runtime** for executing them. The IDE produces `FLOW.json` files. The runtime reads them and executes phase-by-phase.

```
┌──────────────────────────────────────────────────────────┐
│  Visual IDE (React)                                      │
│  AgentExplorer │ DagMiniView │ Editors │ Forge AI Copilot│
└───────┬──────────────────────────────────────────────────┘
        │ saves FLOW.json, triggers runs
┌───────▼──────────────────────────────────────────────────┐
│  Execution Engine (Node.js)                              │
│  Validator → Compiler → Orchestrator → Agent Runners     │
└───────┬──────────────────────────────────────────────────┘
        │ creates/manages per-phase
┌───────▼──────────────────────────────────────────────────┐
│  Sandbox (Docker container per phase)                    │
│  workspace/input/ ← from state store                     │
│  workspace/output/ ← agent writes here                   │
│  workspace/skills/ ← only this phase's skills            │
└───────┬──────────────────────────────────────────────────┘
        │ reads/writes
┌───────▼──────────────────────────────────────────────────┐
│  State Store (~/.forgeflow/runs/{id}/)                   │
└──────────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

## Core Concepts

### Skills — Reusable Domain Knowledge

A skill is a directory containing instructions + reference files:

```
california-adu/
├── SKILL.md              ← How to use this knowledge (routing, decision trees)
├── references/           ← Domain knowledge files (markdown)
│   ├── standards-height.md
│   ├── standards-setbacks.md
│   └── ...
└── scripts/              ← Optional deterministic code
```

Skills are standalone and composable. A "California Tax Code" skill can be used by a "Tax Prep" flow, a "Tax Audit" flow, and a "Tax Planning" flow. Skills can reference other skills. See [docs/SKILL-FORMAT.md](docs/SKILL-FORMAT.md).

### Nodes — Units of Work

Three types:
- **Agent** — Claude executes instructions with loaded skills. Can spawn parallel sub-agents and fire interrupts for human input mid-execution.
- **Checkpoint** — Flow pauses at a phase boundary, presents data to user, waits for input. Zero cost while waiting.
- **Merge** — Collects outputs from parallel children.

Nodes can contain recursive sub-trees — double-click any node in the DAG to see its parallel children.

### Flows — Multi-Phase Agent Workflows

A flow is a DAG of nodes defined in `FLOW.json`:

```
[Parse Input] → [Research (3 parallel sub-agents)] → [⛔ Human Review] → [Generate Output]
```

Each node declares its inputs, outputs, skills, and budget. The engine resolves dependencies, validates the DAG, and executes phase-by-phase. See [docs/FLOW-FORMAT.md](docs/FLOW-FORMAT.md).

### Per-Phase Execution

The engine orchestrates **between** phases. Claude orchestrates **within** a phase (spawning sub-agents via the Task tool). Each phase gets its own sandbox with only its declared inputs and skills — clean context windows, fault isolation, and natural serialization.

### Interrupts — Human Input at Any Depth

Five interrupt types stream in real-time from any depth in the node tree:
- **Approval** — "Here's what I plan to do. Approve/reject/modify?"
- **Q&A** — "I need specific information to continue."
- **Selection** — "Pick which items to include/exclude."
- **Review & Edit** — "Here's a draft. Edit if needed."
- **Escalation** — "This finding needs specialist attention."

Default to **inline** mode (agent pauses, sandbox stays alive). Auto-escalate to **checkpoint** mode after timeout (sandbox torn down, zero cost).

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@forgeflow/types` | Pure type declarations (zero runtime) | Stable |
| `@forgeflow/parser` | Zod schema validation for FLOW.json | Stable |
| `@forgeflow/validator` | Semantic validation (DAG, dependencies, budgets, interrupts) | Stable |
| `@forgeflow/compiler` | FlowNode → per-phase markdown prompt + per-child prompt files | Stable |
| `@forgeflow/skill-resolver` | Loads SKILL.md + references from disk, search path resolution | Stable |
| `@forgeflow/state-store` | StateStore interface + LocalStateStore (filesystem) | Stable |
| `@forgeflow/engine` | FlowOrchestrator, MockRunner, ClaudeAgentRunner, DockerAgentRunner, InterruptWatcher | Stable |
| `@forgeflow/cli` | `forgeflow run` + `forgeflow resume` with --mock/--local/--docker | Stable |
| `@forgeflow/ui` | React IDE (Vite, dockview, React Flow, CodeMirror 6) | Alpha |
| `@forgeflow/server` | Express API server | Early |
| `@forgeflow/desktop` | Electron desktop app | Early |

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system design: runtime execution model, UI architecture, interrupt system, state management |
| [FLOW-FORMAT.md](docs/FLOW-FORMAT.md) | FLOW.json specification with TypeScript types and validation rules |
| [SKILL-FORMAT.md](docs/SKILL-FORMAT.md) | Skill directory structure, conventions, and the visual skill editor |

## Roadmap

- [x] Core runtime engine with per-phase execution and state serialization
- [x] 5 interrupt types with inline, checkpoint, and auto-escalate modes
- [x] CLI (`forgeflow run` + `forgeflow resume`) with mock, local, and Docker runners
- [x] Visual IDE with DAG designer, agent editor, skill editor
- [x] Forge AI copilot panel (UI shell)
- [ ] Forge copilot connected to Claude API (conversational flow building)
- [ ] Server API routes (flow CRUD, run management, real-time progress streaming)
- [ ] Desktop app packaging and distribution (Electron)
- [ ] Run viewer with real-time progress, state inspector, and interrupt UI
- [ ] Cloud sandbox (Vercel Sandbox + S3 state store)
- [ ] Skill marketplace

## Contributing

```bash
pnpm install          # Install all dependencies
pnpm test             # Run all tests (151 across 8 packages)
pnpm build            # Build all packages
pnpm typecheck        # TypeScript type checking
pnpm lint             # ESLint
```

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `pnpm test && pnpm build && pnpm typecheck`
5. Open a pull request

## License

MIT
