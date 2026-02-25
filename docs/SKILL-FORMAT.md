# Skill Format Specification

## Overview

A skill is a directory that packages domain knowledge + routing logic for Claude to use during flow execution. Skills are the **portable, reusable unit of domain expertise**.

## Directory Structure

```
skill-name/
├── SKILL.md              ← Required: instructions + routing logic
├── references/           ← Optional: domain knowledge files
│   ├── topic-a.md
│   ├── topic-b.md
│   └── ...
└── scripts/              ← Optional: deterministic code
    └── extract.py
```

## SKILL.md Format

### Required Sections

```markdown
---
name: skill-name-lowercase
description: "One-line description of what this skill does and when to use it."
---

# Skill Title

## Overview

[1-2 paragraphs: what this skill covers, what it doesn't, when to use it]

## How to Use This Skill

[Instructions for Claude: routing logic, decision trees, step-by-step process]

## Reference File Catalog

[Table listing all reference files with descriptions]
```

### Optional Sections

```markdown
## Decision Tree Router

[Structured routing: given the user's question, which reference files to load]

| Situation | Load These References |
|-----------|---------------------|
| [condition] | `reference-a.md`, `reference-b.md` |
| [condition] | `reference-c.md` |

## Quick-Reference Thresholds

[Key numbers/values that come up frequently — avoid loading full files for these]

| Threshold | Value | Reference File |
|-----------|-------|---------------|
| [name] | [value] | `reference.md` |

## Key Principles

[Important rules that apply across all uses of this skill]

## Sub-Skills Referenced

[If this skill orchestrates other skills]

| Skill | Role |
|-------|------|
| `other-skill` | [what it contributes] |
```

### YAML Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase, hyphenated identifier |
| `description` | Yes | One-line trigger description |
| `version` | No | Semver string |
| `source` | No | Where the knowledge comes from (e.g., "IRS Publication 587") |
| `authority` | No | Who authored/maintains the source material |
| `law_as_of` | No | Date the rules are current as of |

## Reference Files

### Format

Each reference file is a standalone markdown document covering one focused topic.

```markdown
---
title: "Height Limits by ADU Type"
category: standards
relevance: "Load when height limits or stories are relevant"
key_code_sections: "Gov. Code §§ 66321(b)(4), 66314(d)(8)"
---

## Height Limits by ADU Type

### Detached ADU Height Limits

| Scenario | Minimum Height | Code Section |
|----------|---------------|-------------|
| Base | 16 feet | § 66321(b)(4)(A) |
| Near transit | 18 feet | § 66321(b)(4)(B) |

### Key Code Sections
- Gov. Code § 66321, subd. (b)(4)(A) — 16-foot base
- Gov. Code § 66321, subd. (b)(4)(B) — 18-foot transit bonus

### Cross-References
- See also: `standards-setbacks.md` — related rules
- See also: `unit-types-66323.md` — which height limits apply
```

### Naming Convention

```
category-topic.md
```

Examples:
- `standards-height.md`
- `standards-setbacks.md`
- `permit-process.md`
- `compliance-unpermitted.md`
- `glossary.md`

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Human-readable title |
| `category` | Yes | Grouping (standards, permits, compliance, etc.) |
| `relevance` | Yes | When to load this file |
| `key_code_sections` | No | Legal/regulatory citations covered |

### Design Principles

1. **One topic per file.** Don't combine parking and height in the same file. Claude loads files selectively — smaller files mean less irrelevant context.

2. **Include cross-references.** At the bottom of each file, link to related files. This helps Claude navigate when a question spans topics.

3. **Use tables for structured data.** Tables are more token-efficient and easier for Claude to parse than prose for structured information.

4. **Include source citations.** Every claim should cite its source (code section, regulation number, page reference). This enables the agent to cite sources in its output.

5. **Keep files under 2,000 words.** If a topic needs more, split into sub-topics. The decision tree in SKILL.md handles the routing.

## Scripts Directory

For operations that should be deterministic (not LLM-driven):

```
scripts/
├── extract.py          ← PDF text extraction
├── validate.py         ← Schema validation
└── transform.sh        ← Data transformation
```

Claude can execute these via the Bash tool. Use scripts for:
- File format conversion
- Mathematical calculations
- Schema validation
- Data extraction from structured formats

Don't use scripts for:
- Decision making (use Claude's reasoning)
- Natural language processing
- Anything that benefits from context understanding

## Skill Composition

Skills can reference other skills in their SKILL.md:

```markdown
## Sub-Skills Referenced

| Skill | Location | Role |
|-------|----------|------|
| `california-adu` | `skills/california-adu/` | State law knowledge |
| `adu-city-research` | `skills/adu-city-research/` | City-specific web research |
```

The execution engine resolves the full skill dependency tree when setting up a phase's sandbox. Only the skills declared for that phase (node-level + global) and their sub-skill dependencies are copied into the sandbox workspace. Subagents spawned within a phase (via the Task tool) share the parent's sandbox and have access to the same loaded skills.

## Example: Minimal Skill

A simple skill with just instructions and a few references:

```
tax-deductions/
├── SKILL.md
└── references/
    ├── home-office.md
    ├── vehicle.md
    └── medical.md
```

**SKILL.md:**
```markdown
---
name: tax-deductions
description: "Common tax deduction rules for US individual filers. Use when analyzing deductions for a tax return."
---

# Tax Deductions Guide

## Overview

Reference files for common US individual tax deductions. Covers home office (Publication 587), vehicle (Publication 463), and medical (Publication 502).

## How to Use

1. Identify which deduction categories apply to the taxpayer
2. Load the relevant reference files
3. Check thresholds and eligibility rules
4. Apply the standard vs. itemized decision

## Quick Reference

| Deduction | Standard Amount | Reference |
|-----------|----------------|-----------|
| Home office (simplified) | $5/sq ft, max 300 sq ft ($1,500) | `home-office.md` |
| Standard mileage rate | $0.67/mile (2024) | `vehicle.md` |
| Medical threshold | 7.5% of AGI | `medical.md` |

## Reference Catalog

| File | Covers |
|------|--------|
| `home-office.md` | Home office deduction: regular vs simplified, exclusive use test, allocation |
| `vehicle.md` | Vehicle expenses: standard mileage vs actual, recordkeeping, commuting exclusion |
| `medical.md` | Medical deductions: qualifying expenses, HSA interaction, 7.5% AGI floor |
```

## Example: Complex Skill with Decision Tree

```markdown
---
name: california-adu
description: "California state-level ADU rules from HCD Handbook. 28 reference files."
---

# California ADU Regulatory Decision Engine

## Decision Tree Router

### STEP 1: Classify the Lot Type
| Lot Type | Load These References |
|----------|---------------------|
| Single-family | `unit-types-66323.md`, `unit-types-adu-general.md` |
| Multifamily | `unit-types-multifamily.md`, `unit-types-66323.md` |
| JADU only | `unit-types-jadu.md` |

### STEP 2: Classify Construction Type
| Type | Load These References |
|------|---------------------|
| New detached | `standards-height.md`, `standards-size.md`, `standards-setbacks.md` |
| Conversion | `standards-size.md`, `zoning-nonconforming.md` |
| Attached | `standards-height.md`, `standards-size.md`, `standards-setbacks.md` |

### STEP 3: Check Modifiers
| Situation | Load These References |
|-----------|---------------------|
| Near transit | `standards-height.md`, `standards-parking.md` |
| Fire hazard zone | `zoning-hazards.md`, `standards-fire.md` |
| HOA | `ownership-hoa.md` |
[... etc]

## Quick-Reference Thresholds
| Threshold | Value |
|-----------|-------|
| Max detached ADU | 1,200 sq ft |
| Max side/rear setback | 4 ft |
| Detached height (base) | 16 ft |
[... etc]
```

This pattern — decision tree routing + focused reference files — scales to any domain with structured rules.

## Editing Skills in the UI

The ForgeFlow IDE includes a visual skill editor accessible from the AgentExplorer sidebar (Skills section). Opening a skill launches a `SkillEditorPanel` in the dockview tab area.

### Editor Features

- **File tree** — Navigate between SKILL.md and files in references/ and scripts/
- **CodeMirror 6 editor** — Syntax-highlighted markdown editing with custom slash commands:
  - `//skill:name` — Reference another skill (renders as inline chip)
  - `@file` — Reference a file in the skill's references/ directory (renders as chip)
  - `/output` — Insert an output specification table
  - `/input` — Insert an input specification table
  - `/decision` — Insert a decision tree table
  - `/guardrail` — Insert guardrail rules
- **View modes** — Toggle between Edit (slash editor with widgets), Compiled (rendered markdown preview), and Raw (plain CodeMirror)
- **Import suggestions bar** — Detects referenced skills and files, suggests adding them as dependencies

### Connecting Skills to Flows

In the AgentEditor's ConfigBottomPanel (Skills tab), users assign skills to nodes. The skill names in `node.config.skills` must match skill directory names resolved by `@forgeflow/skill-resolver`. Global skills declared at the flow level are available to all nodes.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full UI architecture and state management details.
