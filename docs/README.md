# FlowForge

A platform for building, testing, and deploying long-running AI agent workflows. Define multi-phase, multi-agent flows visually. Claude executes them with file-based state, parallel subagents, and human-in-the-loop checkpoints.

## The Problem

Building complex AI agent workflows today requires:
- Writing custom orchestration code (LangGraph, CrewAI, custom frameworks)
- Managing state manually across long-running operations
- No visual tooling for designing multi-agent flows
- No standard format for encoding domain knowledge

Existing agent builders focus on simple pipelines (input → single model call → output). Real-world professional tasks need **multi-phase workflows** that run for 5-30 minutes, coordinate parallel research agents, pause for human input, and produce structured deliverables.

## The Solution

FlowForge provides three things:

1. **A format** for defining agent workflows (`FLOW.json`) and domain knowledge (`SKILL.md`)
2. **An execution engine** that runs flows phase-by-phase — each node gets its own sandboxed agent run via Claude Agent SDK, with state serialized between phases
3. **A visual designer** for building flows without writing code (with a raw-markdown power-user layer underneath)

## Core Concepts

### Skills — Reusable, Composable Domain Knowledge

A skill is a directory containing instructions + reference files:
```
california-adu/
├── SKILL.md              ← How to use this knowledge (routing, decision trees)
├── references/           ← 28 markdown files covering state ADU law
│   ├── standards-height.md
│   ├── standards-setbacks.md
│   └── ...
└── scripts/              ← Optional deterministic code
```

Skills are standalone and composable at two levels:

1. **Flows reference skills** — A "Tax Code 2026" skill can be used by a "Tax Prep" flow, a "Tax Audit" flow, and a "Tax Planning" flow.
2. **Skills compose other skills** — A skill's `SKILL.md` can reference sub-skills. For example, an "ADU Corrections Analysis" skill orchestrates three sub-skills: `california-adu` for state law, `adu-city-research` for local rules, and `adu-targeted-page-viewer` for plan sheet navigation. The execution engine resolves the full skill dependency tree.

See [SKILL-FORMAT.md](SKILL-FORMAT.md) for the full spec and [CROSSBEAM-PATTERNS.md](CROSSBEAM-PATTERNS.md) (Pattern 8) for how CrossBeam uses skill composition.

### Flows — Multi-Phase Agent Workflows

A flow is a DAG (directed acyclic graph) of nodes:
```
[Parse Input] → [Research (3 parallel subagents)] → [⛔ Human Review] → [Generate Output]
```

Each node has structured config (inputs, outputs, skills, budget) plus free-text instructions. Nodes can contain **recursive sub-trees** — click into a node to see its parallel children.

### Nodes — Units of Work

Three types:
- **Agent** — Claude executes instructions with loaded skills. Can fire interrupts for human input mid-execution.
- **Checkpoint** — Flow pauses at a phase boundary, shows data to user, waits for input (zero cost while waiting).
- **Merge** — Collects outputs from parallel children.

### Interrupts — Human Input at Any Depth

Five interrupt types, streamable in real-time from any depth in the node tree:
- **Approval** — "Here's what I plan to do. Approve/reject/modify?"
- **Q&A** — "I need specific information to continue."
- **Selection** — "Pick which items to include/exclude."
- **Review & Edit** — "Here's a draft. Edit if needed."
- **Escalation** — "This finding needs specialist attention."

Interrupts default to **inline mode** (agent pauses in place, sandbox stays alive, other subagents keep running). If the human doesn't respond within a timeout, auto-escalates to **checkpoint mode** (serialize state, tear down sandbox, zero cost while waiting).

See [INTERRUPTS.md](INTERRUPTS.md) for the full spec.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Target user | Layered: visual + raw markdown | Domain experts use the visual layer; engineers drop into markdown |
| Node content | Hybrid: form + free-text | Structured config for predictability, free-text for domain nuance |
| Knowledge model | Skills are standalone, flows reference them | Maximum reusability across flows |
| LLM provider | Claude-only (Agent SDK) | Deepest integration, native subagent support, skill loading |
| Concurrency | Recursive nodes (sub-trees) | Intuitive: click into a node to see its parallel children |
| Execution model | Per-phase: one sandbox per node, state serialized between | Clean context windows, resource savings, fault isolation |
| Sandbox | Docker container per phase (local), Vercel Sandbox (cloud) | Isolation, security, clean filesystem per agent run |
| MVP deployment | Local-first, BYOK | No cloud infra needed to start. User provides their own API key. |

## MVP Scope

**What we build:**
- FLOW.json format spec + validation
- Flow validator (compiler-style type checking — catches dependency errors, missing inputs, cycles before runtime)
- Phase compiler (node config → per-phase markdown prompt)
- Execution engine (per-phase Agent SDK runs with sandbox isolation)
- Bidirectional sandbox channel (filesystem watcher for real-time interrupts + progressive output streaming)
- State store (serialize all artifacts between phases — local disk for MVP, DB/S3 for cloud)
- Sandbox manager (Docker containers per phase — each agent runs in isolation)
- 5 interrupt types (approval, Q&A, selection, review, escalation) with inline + checkpoint modes
- Flow designer UI (DAG canvas with recursive node navigation)
- Run viewer (real-time progress + state inspector)

**What we don't build yet:**
- Visual skill editor (skills are manually written markdown)
- Marketplace / sharing
- Billing / multi-tenancy
- Cloud hosting (architecture supports it — swap Docker for Vercel Sandbox, local disk for S3)

## Inspired By

This project is inspired by [CrossBeam](https://github.com/...), which won first place at the Claude Code Hackathon (Feb 2026) by applying this pattern to ADU (Accessory Dwelling Unit) permit processing. CrossBeam proved that markdown-defined skills + file-based state + Claude Agent SDK is a powerful architecture for professional, information-dense workflows. FlowForge generalizes that pattern for any domain.

## Documentation

| Document | Description |
|----------|-------------|
| [SPEC.md](SPEC.md) | Full product specification |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Execution engine, data flow, system design |
| [CROSSBEAM-PATTERNS.md](CROSSBEAM-PATTERNS.md) | 8 patterns extracted from CrossBeam, generalized |
| [FLOW-FORMAT.md](FLOW-FORMAT.md) | FLOW.json specification with TypeScript types |
| [SKILL-FORMAT.md](SKILL-FORMAT.md) | Skill directory structure and conventions |
| [EXAMPLES.md](EXAMPLES.md) | Example flows for different domains |
| [claude-prompt.md](claude-prompt.md) | Long-running agent prompt for building FlowForge |
