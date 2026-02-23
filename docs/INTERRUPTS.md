# Interrupt System

Interrupts are how agents request human input during flow execution. They can fire at any depth in the recursive node tree — from a top-level phase or from a deeply nested subagent — and they stream to the human in real-time.

## Core Principle: Bidirectional Sandbox Channel

The sandbox has a **live, bidirectional filesystem channel** with the engine — not just a snapshot at the end.

```
Engine ←→ mounted volume / filesystem API ←→ Sandbox
  │                                              │
  ├── watches for __INTERRUPT__*.json            ├── agent writes interrupt files
  ├── watches for new output files               ├── agent writes output files
  ├── writes __ANSWER__*.json into sandbox       ├── agent polls for answer files
  └── reads progress/cost in real-time           └── agent logs progress
```

This channel enables:
- **Real-time interrupt streaming** — questions appear on the frontend the moment an agent writes them
- **Inline agent pausing** — the agent polls for an answer file while its context window stays alive
- **Progressive output collection** — completed files stream to the state store immediately, not just at phase end
- **Live monitoring** — cost, progress, and tool calls visible in real-time

## The Five Interrupt Types

### 1. Approval

Binary decision gate. Agent presents what it plans to do and waits for go/no-go.

**When to use:** Before generating final deliverables, before making irreversible decisions, before spending significant budget on a phase.

```json
{
  "interrupt_id": "int_approve_redline",
  "type": "approval",
  "source": { "agentPath": ["generate_output"], "depth": 1 },
  "mode": "inline",
  "timeoutMs": 300000,
  "title": "Approve Deliverable Generation",
  "context": "Based on the risk analysis and your decisions, I'm ready to generate the redlined contract, negotiation memo, and risk summary.",
  "proposal": "Generate 3 deliverables: redlined contract with 8 tracked changes, negotiation memo covering 5 flagged clauses, risk summary table for the deal team.",
  "evidence": ["risk_matrix.json", "attorney_decisions.json"],
  "options": ["approve", "reject", "modify"]
}
```

**Answer:**
```json
{
  "decision": "modify",
  "modifications": "Skip the risk summary table — we only need the redline and memo."
}
```

### 2. Q&A

Structured questions with typed inputs. Agent needs specific information to continue.

**When to use:** Missing data that only the human has, clarification on ambiguous requirements, domain-specific decisions the agent can't make.

```json
{
  "interrupt_id": "int_plumbing_questions",
  "type": "qa",
  "source": { "agentPath": ["research", "law_agent"], "depth": 2 },
  "mode": "inline",
  "timeoutMs": 300000,
  "title": "Plumbing Questions",
  "context": "CPC Section 710.1 requires minimum pipe sizes based on fixture unit count. Need these details to determine compliance.",
  "questions": [
    {
      "id": "q_pipe_size",
      "label": "What is the existing drain pipe size?",
      "context": "CPC §710.1 requires minimum 3\" for <35 DFU, 4\" for 35-256 DFU.",
      "inputType": "choice",
      "options": ["3\"", "4\"", "6\""],
      "required": true
    },
    {
      "id": "q_fixture_count",
      "label": "Current total fixture unit count?",
      "context": "Adding the ADU will increase DFU. Need baseline to calculate new total.",
      "inputType": "number",
      "required": true
    },
    {
      "id": "q_notes",
      "label": "Any known plumbing issues?",
      "context": "Useful context for determining if a full re-pipe is needed vs. a tie-in.",
      "inputType": "text",
      "required": false
    }
  ]
}
```

**Answer:**
```json
{
  "answers": {
    "q_pipe_size": "4\"",
    "q_fixture_count": 28,
    "q_notes": "Copper pipes, installed 2003, no known issues."
  }
}
```

### 3. Selection

Pick from a list. Agent presents options with descriptions and recommendations, human selects.

**When to use:** Filtering results, prioritizing items, choosing which branches to pursue, selecting which flagged items to act on.

```json
{
  "interrupt_id": "int_select_clauses",
  "type": "selection",
  "source": { "agentPath": ["review_checkpoint"], "depth": 1 },
  "mode": "checkpoint",
  "title": "Select Clauses to Negotiate",
  "context": "The risk analysis identified 8 flagged clauses. Select which ones to include in the negotiation memo.",
  "items": [
    {
      "id": "clause_7",
      "label": "§7 Indemnification (HIGH risk)",
      "description": "One-sided indemnification with no mutual terms or liability cap. Recommend adding mutual indemnification with $2M cap.",
      "recommended": true,
      "file": "liability_findings.json"
    },
    {
      "id": "clause_12",
      "label": "§12 IP Assignment (HIGH risk)",
      "description": "Broad IP assignment with no pre-existing IP carve-out. Recommend adding carve-out for pre-existing and independently developed IP.",
      "recommended": true,
      "file": "ip_findings.json"
    },
    {
      "id": "clause_15",
      "label": "§15 Non-Compete (MEDIUM risk)",
      "description": "2-year non-compete with broad geographic scope. Recommend narrowing to 1 year and specific market segment.",
      "recommended": false,
      "file": "ip_findings.json"
    },
    {
      "id": "clause_18",
      "label": "§18 Auto-Renewal (LOW risk)",
      "description": "Auto-renewal with 60-day notice. Standard terms but no termination for convenience.",
      "recommended": false,
      "file": "termination_findings.json"
    }
  ],
  "minSelect": 1,
  "maxSelect": null
}
```

**Answer:**
```json
{
  "selected": ["clause_7", "clause_12", "clause_15"]
}
```

### 4. Review & Edit

Agent presents a draft. Human reviews and optionally edits it.

**When to use:** Draft deliverables before finalization, generated letters before sending, response templates that need domain-specific adjustments.

```json
{
  "interrupt_id": "int_review_letter",
  "type": "review",
  "source": { "agentPath": ["generate_output"], "depth": 1 },
  "mode": "inline",
  "timeoutMs": 600000,
  "title": "Review Response Letter",
  "context": "Draft response letter to the building department addressing all 14 corrections. Please review tone, accuracy, and completeness.",
  "draftFile": "response_letter_draft.md",
  "format": "markdown",
  "instructions": "Check that all correction items are addressed. Verify code citations are accurate. Adjust tone if needed — this goes to the plan checker."
}
```

**Answer:**
```json
{
  "accepted": false,
  "editedContent": "# Response to Plan Check Corrections\n\nDear Plan Checker,\n\n[edited content...]"
}
```

### 5. Escalation

Agent flags a risk or finding that requires special attention or routing.

**When to use:** Findings that exceed the agent's authority, risks that need specialist review, situations that require a different decision-maker.

```json
{
  "interrupt_id": "int_escalate_liability",
  "type": "escalation",
  "source": { "agentPath": ["research", "liability_analyst"], "depth": 2 },
  "mode": "inline",
  "timeoutMs": 600000,
  "title": "Uncapped Liability Clause — Partner Review Recommended",
  "context": "Section 7.2 contains unlimited indemnification with no liability cap. This exceeds the firm's standard risk threshold ($5M). Comparable deals in this sector typically cap at $2-5M.",
  "severity": "critical",
  "finding": "Unlimited indemnification obligation in §7.2 with no mutual terms, no cap, and no carve-outs for gross negligence or willful misconduct.",
  "evidence": ["liability_findings.json", "comparable_claims.json"],
  "suggestedAction": "Escalate to partner for review before proceeding with negotiation memo.",
  "routeTo": "partner"
}
```

**Answer:**
```json
{
  "action": "override",
  "notes": "Client is aware and accepts the risk. Proceed with a note in the memo that this was flagged."
}
```

## TypeScript Types

```typescript
// --- Interrupt Types ---

type InterruptType = 'approval' | 'qa' | 'selection' | 'review' | 'escalation';
type InterruptMode = 'inline' | 'checkpoint';

interface InterruptSource {
  agentPath: string[];           // Path in the node tree, e.g., ["research", "law_agent"]
  depth: number;                 // How deep in the recursion
}

interface InterruptBase {
  interrupt_id: string;          // Unique ID: "int_{nodeId}_{sequence}"
  type: InterruptType;
  source: InterruptSource;
  mode: InterruptMode;           // inline (sandbox stays alive) or checkpoint (serialize + teardown)
  timeoutMs?: number;            // Auto-escalate from inline → checkpoint after this
  title: string;
  context: string;               // Why this interrupt is happening
}

// --- Approval ---
interface ApprovalInterrupt extends InterruptBase {
  type: 'approval';
  proposal: string;
  evidence?: string[];
  options: ('approve' | 'reject' | 'modify')[];
}
interface ApprovalAnswer {
  decision: 'approve' | 'reject' | 'modify';
  modifications?: string;
}

// --- Q&A ---
interface QAQuestion {
  id: string;
  label: string;
  context: string;
  inputType: 'text' | 'number' | 'choice' | 'boolean';
  options?: string[];
  required: boolean;
  defaultValue?: string | number | boolean;
}
interface QAInterrupt extends InterruptBase {
  type: 'qa';
  questions: QAQuestion[];
}
interface QAAnswer {
  answers: Record<string, string | number | boolean>;
}

// --- Selection ---
interface SelectionItem {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
  file?: string;
}
interface SelectionInterrupt extends InterruptBase {
  type: 'selection';
  items: SelectionItem[];
  minSelect?: number;
  maxSelect?: number | null;     // null = unlimited
}
interface SelectionAnswer {
  selected: string[];
}

// --- Review & Edit ---
interface ReviewInterrupt extends InterruptBase {
  type: 'review';
  draftFile: string;
  format: 'markdown' | 'json' | 'text';
  instructions: string;
}
interface ReviewAnswer {
  accepted: boolean;
  editedContent?: string;        // Only if accepted=false
}

// --- Escalation ---
interface EscalationInterrupt extends InterruptBase {
  type: 'escalation';
  severity: 'info' | 'warning' | 'critical';
  finding: string;
  evidence: string[];
  suggestedAction: string;
  routeTo?: string;
}
interface EscalationAnswer {
  action: 'acknowledge' | 'override' | 'route';
  notes?: string;
  routedTo?: string;
}

// --- Union Types ---
type Interrupt = ApprovalInterrupt | QAInterrupt | SelectionInterrupt | ReviewInterrupt | EscalationInterrupt;
type InterruptAnswer = ApprovalAnswer | QAAnswer | SelectionAnswer | ReviewAnswer | EscalationAnswer;
```

## Interrupt Modes

### Inline Mode

The agent pauses in place. The sandbox stays alive. Best for quick questions.

```
Agent writes __INTERRUPT__law_agent.json
  → Engine detects via filesystem watcher
  → Engine streams to frontend immediately
  → Agent enters poll loop: check for __ANSWER__law_agent.json every 5s
  → Human answers on frontend
  → Engine writes __ANSWER__law_agent.json into sandbox
  → Agent detects answer, reads it, continues
  → Other subagents keep running in parallel
```

**Pros:** Instant, no state loss, other agents unaffected, agent context preserved
**Cons:** Sandbox stays alive (costs money while idle), context window held open

**Best for:** Questions the human can answer in under 5 minutes.

### Checkpoint Mode

Full serialization. Sandbox torn down. Zero cost while waiting.

```
Agent writes __INTERRUPT__review.json with mode: "checkpoint"
  → Engine detects interrupt
  → Engine collects ALL outputs from sandbox (complete + partial)
  → Engine serializes to state store
  → Engine tears down sandbox
  → Engine presents interrupt to frontend
  → Human takes as long as they need (minutes, hours, days)
  → Human answers
  → Engine creates new sandbox for resume
  → Engine loads all prior outputs + answer into new sandbox
  → Agent resumes (fresh context, but all files available)
```

**Pros:** Zero cost while waiting, indefinite wait time, clean resume
**Cons:** Slower (sandbox creation), fresh context (no conversation history from before interrupt)

**Best for:** Long reviews, overnight approvals, multi-person routing.

### Auto-Escalate (Default)

Starts as inline. Converts to checkpoint if the human doesn't respond within a timeout.

```
t=0s     Agent writes interrupt (mode: "inline", timeoutMs: 300000)
t=0s     Engine streams to frontend
t=0-300s Agent polls for answer, sandbox alive

         IF human answers before timeout:
           → Write answer into sandbox, agent continues (inline path)

         IF timeout reached (300s):
           → Engine serializes state
           → Engine tears down sandbox
           → Interrupt converts to checkpoint mode
           → Human can now take unlimited time
           → Resume follows checkpoint path
```

**Default timeout:** 5 minutes (configurable per interrupt and per flow).

## Nested Interrupts

Interrupts can fire at any depth in the recursive node tree. The filesystem channel is flat — all interrupt files land in the same `output/` directory regardless of which level wrote them.

### How Depth Works

```
Level 0: Engine (manages top-level phases)
Level 1: Parent agent in sandbox (manages children via Task tool)
Level 2: Child agent (subagent spawned by parent)
Level 3: Child's child (if a subagent spawns its own subagents)
```

When a Level 2 agent writes `__INTERRUPT__law_agent.json`, the engine sees it the same as a Level 1 interrupt. The `source.agentPath` field tells the engine (and the frontend) where in the tree it came from.

### Parallel Siblings During Interrupt

When one subagent interrupts, what happens to its siblings?

**Default behavior: siblings continue running.**

```
Research phase (3 parallel subagents):

  City Agent:  running... done ✓ (writes city_findings.json)
  Law Agent:   running... INTERRUPT (writes __INTERRUPT__law_agent.json)
  Doc Agent:   running... done ✓ (writes doc_observations.json)

  Engine streams city_findings.json and doc_observations.json to state store
  Engine streams interrupt to frontend
  Law Agent polls for answer...
  Human answers → Law Agent continues → writes law_findings.json
  Parent agent verifies all 3 outputs, finishes
```

If all siblings finish before the human answers, the sandbox is idle but the cost is minimal (agents are done, only Law Agent is polling).

If the interrupt auto-escalates to checkpoint:
1. Engine collects all completed sibling outputs (city + doc findings)
2. Engine records that Law Agent was interrupted and needs to resume
3. Sandbox torn down
4. On resume: new sandbox, parent only re-spawns Law Agent (siblings done)

### Resume Manifest

When a nested interrupt converts to checkpoint, the engine saves a resume manifest:

```json
{
  "interrupt_id": "int_law_agent_q1",
  "interrupted_at": {
    "path": ["research", "law_agent"],
    "depth": 2
  },
  "completed_siblings": {
    "city_agent": {
      "status": "complete",
      "outputs": ["city_findings.json"]
    },
    "doc_agent": {
      "status": "complete",
      "outputs": ["doc_observations.json"]
    }
  },
  "interrupted_agent": {
    "id": "law_agent",
    "partial_outputs": ["law_findings_partial.json"],
    "interrupt": { "type": "qa", "questions": ["..."] },
    "answer": null
  }
}
```

After the human answers, `answer` is filled in. The resume prompt for the new sandbox tells Claude:

```markdown
# Phase: Research (RESUMED)

Two of your three subagents completed successfully:
- city_findings.json ✓ (in input/)
- doc_observations.json ✓ (in input/)

One subagent was interrupted and now has an answer:
- law_agent needs to resume with the following input:
  [human's answer]
  Its partial work is in: law_findings_partial.json

DO NOT re-run city_agent or doc_agent. Only spawn law_agent to complete its work.
After law_agent finishes, verify all 3 output files exist.
```

## Progressive Output Streaming

Outputs stream to the state store **as they're written**, not just at phase end.

```
Sandbox filesystem watcher detects:
  output/city_findings.json written at t=5s    → copy to state store immediately
  output/doc_observations.json written at t=12s → copy to state store immediately
  output/__INTERRUPT__law_agent.json at t=8s   → stream to frontend
  output/law_findings.json written at t=20s    → copy to state store immediately
```

Benefits:
- **Better fault recovery** — if sandbox crashes at t=15s, city + doc findings are already safe
- **Real-time visibility** — frontend can show partial results as they arrive
- **Future pipelining** — next phase could theoretically start on partial inputs (not MVP)

The engine distinguishes between:
- **Final outputs**: files matching declared `config.outputs` names
- **Interrupt signals**: files matching `__INTERRUPT__*.json`
- **Answer signals**: files matching `__ANSWER__*.json` (written by engine into sandbox)
- **Partial outputs**: files with `_partial` suffix (in-progress work from interrupted agents)

## Interrupt Protocol for Agents

The per-phase system prompt includes these instructions for interrupt-capable nodes:

```
## Interrupt Protocol

If you need human input during execution:

1. Write your interrupt to output/__INTERRUPT__{your_id}.json
   Follow the interrupt schema (type, title, context, questions/items/etc.)

2. After writing the interrupt file, poll for the answer:
   - Check for output/__ANSWER__{your_id}.json every 5 seconds
   - Use: ls output/__ANSWER__* or check with the Read tool
   - When the file appears, read it and continue your work

3. The interrupt file MUST include:
   - interrupt_id: unique identifier
   - type: one of "approval", "qa", "selection", "review", "escalation"
   - source: { agentPath: [your path], depth: [your level] }
   - mode: "inline" (default) or "checkpoint"
   - title: short description
   - context: why you need this input

4. While polling, do NOT proceed with work that depends on the answer.
   You MAY continue work on independent tasks if applicable.
```

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| 5 interrupt types | approval, qa, selection, review, escalation | Covers all human-in-the-loop patterns seen in CrossBeam and other domains |
| Inline as default | Agent polls, sandbox stays alive | Best UX for quick questions — instant streaming, no teardown |
| Auto-escalate | Inline → checkpoint after timeout | Handles unknown wait times without wasting resources |
| Flat interrupt files | All interrupts in output/ regardless of depth | Simple filesystem watching, no nested directory complexity |
| Siblings continue | Other subagents keep running during interrupt | Maximizes parallelism, reduces total wall-clock time |
| Progressive streaming | Outputs to state store as written | Fault recovery + real-time visibility |
