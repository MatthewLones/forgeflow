# Patterns Extracted from CrossBeam

CrossBeam is an ADU (Accessory Dwelling Unit) permit assistant that won first place at the Claude Code Hackathon (Feb 2026). It demonstrates 8 key patterns for building long-running, stateful AI agent workflows. Each pattern below is described generically — independent of ADU permits — with the exact structure used, ready to implement.

## Pattern 1: Skill Format

**What:** A directory of markdown files that teach Claude domain-specific knowledge + how to use it.

**Structure:**
```
skill-name/
├── SKILL.md                    ← Instructions + routing logic
│   ├── YAML frontmatter        ← name, description, version, source
│   ├── Overview                ← What this skill covers
│   ├── Decision Tree / Router  ← How to pick which references to load
│   ├── Quick Reference         ← Key numbers/thresholds (avoid loading files for common lookups)
│   └── Reference Catalog       ← Index of all reference files
├── references/                 ← Domain knowledge files
│   ├── topic-subtopic.md       ← Each file covers one focused topic
│   └── ...                     ← Typically 5-30 files per skill
└── scripts/                    ← Optional deterministic code
    └── extract.py              ← For operations that shouldn't be LLM-driven
```

**SKILL.md frontmatter:**
```yaml
---
name: skill-name-lowercase
description: "One-line description of what the skill does and when to trigger it."
version: "1.0"
source: "Where the data comes from"
---
```

**Key insight:** The decision tree in SKILL.md is critical. It tells Claude which 3-5 reference files to load for a given query — not all 28. This keeps context windows small and responses focused.

**CrossBeam example:** `california-adu` has 28 reference files covering all state ADU law. The decision tree routes by lot type → construction type → situational modifiers → process stage. Most questions need only 3-5 files.

---

## Pattern 2: Flow Definition

**What:** Multi-phase workflows defined as structured phases with inputs, outputs, subagents, and checkpoints.

**Structure:**
```
Phase 1 + Phase 2 (concurrent): [parallel tasks with no dependencies]
Phase 3 (N concurrent subagents): [parallel research/analysis]
Phase 3.5 (conditional): [follow-up if gaps exist]
Phase 4: [merge + synthesize]
⛔ CHECKPOINT: [human-in-the-loop pause]
Phase 5: [generate deliverables using checkpoint input]
```

**Each phase specifies:**
- **Inputs**: what files/data it reads
- **Outputs**: what files it produces (exact filenames)
- **Subagents**: how many, what each does, what skills each loads
- **Timing estimate**: how long this phase typically takes
- **Dependencies**: which phases must complete before this one starts

**Timing table (always included):**
```markdown
| Phase | Time | Notes |
|-------|------|-------|
| Phase 1 | ~30 sec | Parse input document |
| Phase 2 | ~90 sec | Build structural manifest |
| Phase 3 | ~90 sec | 3 parallel research subagents |
| Phase 4 | ~2 min | Merge + categorize + generate |
| **Total** | **~5 min** | **Typical case** |
```

---

## Pattern 3: Output Schema

**What:** Predefined JSON schemas for every output file, documented in a reference file.

**Structure:**
```markdown
## corrections_parsed.json (Phase 1)

Each correction item extracted from the letter.

### Schema
{
  "project": {
    "address": "string",
    "city": "string",
    "permit_number": "string"
  },
  "items": [
    {
      "item_number": "string",
      "original_text": "string (exact wording)",
      "code_references": ["CRC R302.1", "Gov Code 66314"],
      "sheet_references": ["A3", "S2.0"],
      "category": "string (assigned in Phase 4)"
    }
  ],
  "total_items": "number",
  "deadline": "string or null"
}
```

**Key insight:** Defining schemas up front means:
- Subagents know exactly what format to produce
- Merge phases know what fields to expect
- The UI knows what to render
- Debugging is easy — just validate the JSON

---

## Pattern 4: Subagent Spawn

**What:** A prompt template for each concurrent subagent, with role, inputs, task, output format, and constraints.

**Structure:**
```
You are [role description].

SKILL CONTEXT: [skill-name] (load [which reference files])

INPUT:
- [What the agent receives — specific filenames]

TASK:
[Step-by-step instructions]
1. [First action]
2. [Second action]
3. [etc.]

[Optional: DEDUPLICATION RULES, PRIORITY ORDER, CONDITIONAL LOGIC]

OUTPUT FORMAT:
{
  "[field]": "type + description",
  "[field]": "type + description"
}

IMPORTANT:
- [Critical constraints]
- [What NOT to do]
- [Performance expectations]
```

**Key insight:** Each subagent:
- Has a **single, focused responsibility**
- Receives **only the files it needs** (not everything)
- Writes to **its own output file** (no shared writes)
- Returns **a short summary** to the parent (not the full output — that's in the file)

**CrossBeam example:** Three concurrent subagents for research:
- **State Law** — reads `california-adu` references, writes `state_law_findings.json`
- **City Rules** — runs WebSearch, writes `city_discovery.json`
- **Sheet Viewer** — reads plan PNGs with vision, writes `sheet_observations.json`

Parent orchestrator spawns all three, waits for completion, then reads their output files for the merge phase.

---

## Pattern 5: Budget Constraints

**What:** Every flow and every phase has explicit turn and cost limits.

**Structure:**
```typescript
const FLOW_BUDGET = {
  'corrections-analysis': { maxTurns: 500, maxBudgetUsd: 50.00 },
  'corrections-response': { maxTurns: 150, maxBudgetUsd: 20.00 },
  'city-review':          { maxTurns: 500, maxBudgetUsd: 50.00 },
};
```

**Per-node budgets** constrain individual phases:
```json
{ "maxTurns": 30, "maxBudgetUsd": 3.00 }
```

**Why this matters:**
- Prevents runaway costs (a confused agent looping)
- Forces intentional design (if a phase needs 500 turns, it's probably too broad)
- Enables cost estimation for users ("This flow typically costs $8-15")
- Catches failures early (if Phase 1 uses 50 turns instead of the expected 10, something's wrong)

---

## Pattern 6: State Serialization + Phase Boundaries

**What:** State is serialized to a persistent store between **every** phase — not just at checkpoints. Each phase runs in its own sandbox. Checkpoints are just phase boundaries where the engine also pauses for user input.

**Structure:**
```
ready
  → sandbox_creating (Phase 1)
    → phase_running (Phase 1)
      → phase_complete (Phase 1)     ← state serialized to store
        → sandbox_creating (Phase 2)
          → phase_running (Phase 2)
            → phase_complete (Phase 2) ← state serialized to store
              → awaiting_input (Checkpoint) ← NO sandbox running, zero cost
                → sandbox_creating (Phase 3)
                  → phase_running (Phase 3)
                    → completed
                    → failed
```

**Each phase boundary:**
1. Engine collects output files from the sandbox
2. Outputs serialized to state store (local disk or database)
3. Sandbox torn down
4. UI updated with phase completion event
5. If next node is a checkpoint: pause and wait for user
6. Otherwise: immediately create new sandbox for next phase

**Why serialize between every phase (not just checkpoints):**
- **Fault recovery** — if Phase 3 fails, Phase 1-2 outputs are safe
- **Resource savings** — each phase loads only its declared skills (no accumulated context)
- **Clean context windows** — each agent starts fresh
- **Free checkpoints** — no sandbox running = zero cost while waiting for user

**CrossBeam implementation:**
- Status stored in Supabase `projects.status` column
- Artifacts serialized to Supabase `raw_artifacts` column between checkpoint phases
- Frontend listens via `supabase.channel().on('postgres_changes', ...)`

**FlowForge generalization:**
- State store abstraction with two adapters:
  - Local: `~/.flowforge/runs/{id}/` on disk (files + state.json)
  - Cloud: Postgres + S3 (metadata in DB, files in object storage)
- Same engine code, different backing store

---

## Pattern 7: Human-in-the-Loop Checkpoint

**What:** An explicit pause point in a flow where the agent stops, presents structured data to the user, and waits for their input before continuing.

**Structure in the flow definition:**
```markdown
## ⛔ CHECKPOINT: [Name]

**Present to user:** output/questions.json
**Wait for:** output/answers.json

[Presentation format — what to show the user]

STOP HERE. Do not proceed until the user provides input.
```

**The three paths after a checkpoint:**
1. **User answers** — Input written to the expected file, flow resumes
2. **User uses default/mock data** — Pre-built answers loaded, flow resumes
3. **User skips** — Flow resumes with empty/placeholder answers, outputs marked `[TODO]`

**Data at the checkpoint:**
```json
{
  "summary": { "total": 14, "auto_fixable": 5, "needs_input": 6, "needs_pro": 3 },
  "question_groups": [
    {
      "item_id": "4",
      "context": "Why we're asking (code requirements, thresholds)",
      "questions": [
        { "id": "q_4_0", "text": "What is the pipe size?", "type": "choice", "options": ["3\"", "4\"", "6\""] },
        { "id": "q_4_1", "text": "Current fixture unit count?", "type": "number" }
      ]
    }
  ],
  "auto_items": [...],
  "professional_items": [...]
}
```

**Key insight:** Questions include **research context** — why the question is being asked and what the relevant code/rules say. This makes questions specific and answerable in seconds, not vague and confusing.

---

## Pattern 8: Skill Composition

**What:** Flows declare which skills to load. Skills reference other skills. The execution engine resolves the dependency tree.

**Structure:**
```
Flow: "Corrections Analysis"
├── california-adu (always loaded — base state law)
├── adu-corrections-flow (orchestrator skill)
├── adu-targeted-page-viewer (PDF/image handling)
└── placentia-adu OR adu-city-research (conditional on city)
```

**Composition rules:**
1. **Global skills** — loaded for every node in the flow (declared at flow level)
2. **Per-node skills** — loaded only for specific nodes (declared at node level)
3. **Conditional skills** — loaded based on runtime parameters (e.g., which city)
4. **Sub-skill references** — a skill's SKILL.md can reference other skills ("Use the california-adu skill for state law lookups")

**CrossBeam implementation:**
```typescript
function getFlowSkills(flowType: string, city: string): string[] {
  const skills = ['california-adu'];  // always

  if (flowType === 'corrections-analysis') {
    skills.push('adu-corrections-flow', 'adu-targeted-page-viewer');
    if (isCityOnboarded(city)) {
      skills.push(getCitySkillName(city));  // offline, fast
    } else {
      skills.push('adu-city-research');     // web search fallback
    }
  }

  return skills;
}
```

**Key insight:** Skills compose like libraries. A small, focused "parking rules" skill can be used by a "plan review" flow, a "corrections analysis" flow, and a "permit checklist" flow. Build once, reference everywhere.

---

## Summary Table

| # | Pattern | What It Solves | Key File |
|---|---------|---------------|----------|
| 1 | Skill Format | Domain knowledge packaging | `SKILL.md` + `references/` |
| 2 | Flow Definition | Multi-phase workflow structure | Phases + subagents + checkpoints |
| 3 | Output Schema | Structured, predictable agent outputs | `output-schemas.md` |
| 4 | Subagent Spawn | Parallel, focused research agents | Prompt templates per subagent |
| 5 | Budget Constraints | Cost control + failure detection | `maxTurns` + `maxBudgetUsd` per node |
| 6 | State Serialization | Per-phase state persistence + fault recovery | State store between every phase boundary |
| 7 | Human-in-the-Loop | Domain expert input mid-flow | `⛔ CHECKPOINT` with structured Q&A |
| 8 | Skill Composition | Reusable knowledge across flows | Skill dependency resolution |
