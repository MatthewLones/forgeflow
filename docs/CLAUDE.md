# Documentation

## Purpose
Authoritative specifications for ForgeFlow's formats and architecture. These docs are the "what and why" reference. CLAUDE.md files throughout the repo are the "how to work here" operational guides for agents.

## Document Map
- **ARCHITECTURE.md** (~51KB) — Full system design: runtime execution model, server API, UI architecture, interrupt system, Git integration, copilot, state management. Start here for understanding the whole system.
- **FLOW-FORMAT.md** (~16KB) — FLOW.json specification: FlowDefinition schema, FlowNode types, ArtifactSchema, config fields, validation rules, and compilation. The "language reference" for flow authoring.
- **SKILL-FORMAT.md** (~11KB) — Skill directory structure (SKILL.md + references/ + scripts/), conventions, slash commands, and the visual skill editor in the UI.
- **PIPELINE.md** (~47KB) — Detailed compiler IR pipeline: resolve stage (FlowGraph → PhaseIR), generate stage (PhaseIR → markdown), wave ordering, child prompt files, legacy vs new API.

## When to Read What
- Adding/modifying a flow format feature → FLOW-FORMAT.md
- Understanding how execution works end-to-end → ARCHITECTURE.md
- Working on the compiler → PIPELINE.md
- Creating or modifying skills → SKILL-FORMAT.md
