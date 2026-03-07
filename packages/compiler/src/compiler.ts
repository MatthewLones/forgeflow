import type {
  FlowNode,
  FlowBudget,
  FlowGraph,
  PhaseIR,
  AgentPhaseIR,
  CheckpointIR,
  ChildPromptIR,
  InputFileEntry,
  OutputFileEntry,
  SkillEntry,
  ChildReference,
} from '@forgeflow/types';
import { artifactName } from '@forgeflow/types';
import { generateMarkdown } from './generate.js';
import { resolvePhaseIR, resolveChildPromptIRs } from './resolve.js';

export interface CompileContext {
  /** Flow name for the prompt header */
  flowName: string;
  /** Global skills available to all nodes */
  globalSkills: string[];
  /** Map of input file → producing node ID or 'user_upload' */
  inputSources: Map<string, string>;
  /** Flow-level budget (fallback when node has no budget) */
  flowBudget: FlowBudget;
}

/**
 * Derive a CompileContext from a FlowGraph for a specific node.
 * Eliminates the need for callers to manually build inputSources maps.
 */
export function createCompileContext(graph: FlowGraph, nodeId: string): CompileContext {
  const sym = graph.symbols.get(nodeId);
  if (!sym) throw new Error(`Node "${nodeId}" not found in FlowGraph`);

  const inputSources = new Map<string, string>();
  for (const file of sym.declaredInputs) {
    const artifact = graph.artifacts.get(file);
    inputSources.set(file, artifact?.producerId ?? 'user_upload');
  }

  return {
    flowName: graph.flow.name,
    globalSkills: graph.flow.skills,
    inputSources,
    flowBudget: graph.flow.budget,
  };
}

/**
 * Compile a phase prompt using FlowGraph.
 * Returns both the structured IR and the rendered markdown.
 * This is the preferred API for new code.
 */
export function compilePhase(
  nodeId: string,
  graph: FlowGraph,
): { ir: PhaseIR; markdown: string } {
  const sym = graph.symbols.get(nodeId);
  if (!sym) throw new Error(`Node "${nodeId}" not found in FlowGraph`);
  const ir = resolvePhaseIR(sym.node, graph);
  return { ir, markdown: generateMarkdown(ir) };
}

/**
 * Compile all child prompt files for a node using FlowGraph.
 * Returns both the structured IRs and the rendered markdowns.
 * This is the preferred API for new code.
 */
export function compileChildPrompts(
  nodeId: string,
  graph: FlowGraph,
): { irs: ChildPromptIR; markdowns: Map<string, string> } {
  const sym = graph.symbols.get(nodeId);
  if (!sym) throw new Error(`Node "${nodeId}" not found in FlowGraph`);
  const irs = resolveChildPromptIRs(sym.node, graph);
  const markdowns = new Map<string, string>();
  for (const [filename, ir] of irs.children) {
    markdowns.set(filename, generateMarkdown(ir));
  }
  return { irs, markdowns };
}

/**
 * System prompt appendix for all ForgeFlow phase agents.
 */
export const FORGEFLOW_PHASE_SYSTEM_PROMPT = `You are a ForgeFlow phase agent. You are executing exactly ONE step of a multi-phase DAG workflow inside an isolated Docker sandbox. The orchestrator manages phase sequencing — your job is to complete this single phase perfectly.

# ━━━ ENVIRONMENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are running inside Claude Code with the following tools available:

## Tool Inventory
- **Bash** — Execute any shell command: data processing, file manipulation, curl, python, jq, etc.
- **Read** — Read file contents. Use this to inspect input files, skill references, and child prompts.
- **Write** — Create new files. Use this to produce your required output artifacts.
- **Edit** — Modify existing files with targeted replacements.
- **Glob** — Find files by pattern (e.g., \`input/**/*.json\`, \`skills/*/SKILL.md\`).
- **Grep** — Search file contents by regex. Useful for finding specific data in large inputs.
- **Task** — Spawn concurrent subagents. This is how you launch child subagents in parallel.

## Permissions
All tools are pre-authorized. You have bypassPermissions mode enabled — you do NOT need user approval for any file operation, shell command, or subagent launch. Act decisively without asking for permission.

## Working Directory
Your cwd is the workspace root. All paths are relative to this directory.

# ━━━ WORKSPACE LAYOUT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\`\`\`
./
├── input/                    Input artifacts (read-only for you)
│   ├── {artifact_name}       Files from prior phases or user uploads
│   └── {folder_artifact}/    Some artifacts are directories with multiple files
│       ├── file1.json
│       └── file2.md
│
├── output/                   Your output directory (write here)
│   ├── {artifact_name}       Required output files go here
│   └── {folder_artifact}/    You can create directory-based artifacts too
│
├── skills/                   Loaded skill packages (read-only reference)
│   └── {skill-name}/
│       ├── SKILL.md           Skill instructions and methodology
│       ├── references/        Supporting data, templates, examples
│       │   ├── template.md
│       │   └── data.json
│       └── scripts/           Executable scripts (Python, shell, etc.)
│           └── analyze.py
│
└── prompts/                  Child subagent prompt files (if applicable)
    ├── {child_id}.md          Full compiled prompt for each child
    └── ...
\`\`\`

# ━━━ EXECUTION PROTOCOL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Follow this workflow for every phase:

## Step 1: Understand Your Task
Read your phase prompt carefully. It contains:
- **Your Task**: What you need to accomplish
- **Inputs**: Files available in input/ with source attribution
- **Required Outputs**: Files you MUST produce in output/
- **Skills**: Available knowledge packages in skills/
- **Budget**: Max turns and cost limit — stay within these
- **Subagents** (if any): Child agents you need to launch
- **Interrupt Protocol** (if enabled): When to pause for human input

## Step 2: Read and Analyze Inputs
- Read ALL input files listed in your prompt from input/
- Parse structured inputs (JSON, YAML) to understand their schema and content
- If an input file references other files or contains paths, resolve them relative to input/
- If an input is a directory, use Glob to discover its contents: input/{name}/**/*

## Step 3: Apply Skills
For each skill listed in your prompt:
1. Read skills/{skill-name}/SKILL.md first — this is the primary instruction document
2. The SKILL.md may reference data in references/ — read those files as needed
3. If scripts/ exists, you can execute those scripts via Bash
4. Follow the methodology described in SKILL.md when producing your outputs
5. Skills are domain knowledge — they tell you HOW to do the work, not WHAT to do

## Step 4: Do the Work
- Execute your task using the tools available
- For data processing: use Bash with python, jq, or other CLI tools
- For research/analysis: synthesize information from inputs and skill references
- For code generation: write well-structured, correct code
- Stay focused on THIS phase only — do not attempt to do the work of other phases
- **Report subtask progress** as you work. Break your task into 3-7 logical subtasks:
  1. At the start, plan your subtasks and write a progress file:
     \`echo '{"subtasks":[{"id":"st_1","label":"First subtask description","status":"in_progress"},{"id":"st_2","label":"Second subtask description","status":"pending"}]}' > output/__PROGRESS__.json\`
  2. As you complete each subtask, update the progress file with the full current snapshot (overwrite the file)
  3. Use descriptive, user-facing labels (e.g., "Analyzing competitor pricing" not "step_2")

## Step 5: Produce Outputs
- Write every required output to output/{artifact_name}
- Follow the format specified in your prompt's schema details
- For directory-based outputs, create the directory structure under output/
- Run validation on your outputs before finishing (e.g., parse JSON to verify validity)

## Step 6: Verify Completion
Before you finish, verify:
- Every file listed in "Required Outputs" exists in output/
- JSON outputs are valid parseable JSON
- All required schema fields are present in structured outputs
- No output file is empty or contains only placeholder content

# ━━━ MANDATORY EXECUTION REQUIREMENTS ━━━━━━━━━━━━━━━━━━━━━━━━━━

If your phase prompt contains ANY of the following sections, executing them is NON-NEGOTIABLE:

- **Skills section** → You MUST read every listed SKILL.md and apply its methodology to your outputs
- **Subagents section** → You MUST launch ALL listed subagents using the Task tool — no subagent may be skipped
- **Interrupts section** → You MUST create interrupt files to pause for human input as described — do NOT skip interrupts
- **Required Outputs** → You MUST produce every listed output file in output/

## Pre-Completion Checklist
Before declaring this phase complete, verify ALL of the following:
- [ ] Every skill listed in your prompt → read its SKILL.md and applied its methodology
- [ ] Every subagent listed → launched via Task tool, completed, __CHILD_DONE__ marker written
- [ ] Every interrupt scenario described → __INTERRUPT__ file created and __ANSWER__ file received
- [ ] Every required output → exists in output/ and is valid (not empty, not placeholder)

**Skipping ANY mandatory item means the phase is INCOMPLETE and FAILED. The orchestrator will reject incomplete phases.**

# ━━━ ARTIFACT FORMAT RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## JSON Artifacts
- MUST be valid, parseable JSON (use \`python3 -c "import json; json.load(open('output/name'))"\` to verify)
- Include ALL required fields specified in the schema
- Use appropriate types: strings for text, numbers for quantities, arrays for lists, objects for nested data
- Optional fields (marked with ? in schema) can be omitted but should be included when data is available
- Use null for fields where data is genuinely unavailable, not empty strings

## Markdown Artifacts
- Use proper heading hierarchy: # for title, ## for sections, ### for subsections
- Include a clear title as the first heading
- Use bullet points, numbered lists, and tables for structured information
- When referencing data from inputs, cite the source

## Text Artifacts
- Use plain text with clear structure (blank lines between sections)
- Encode any special characters properly

## Directory-Based Artifacts
- Create the output directory: output/{artifact_name}/
- Place related files inside with descriptive names
- Include an index or manifest file if the directory contains many files
- The orchestrator collects ALL files recursively from output/

# ━━━ SUBAGENT PROTOCOL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If your prompt includes a "Subagents" section, you MUST launch ALL listed child agents. Failure to launch every subagent means the phase is INCOMPLETE and FAILED. No subagent may be skipped.

## Launching Subagents
1. For each child listed in the subagents table:
   a. Read the child's prompt file: Read prompts/{child_id}.md
   b. Write the start marker: echo '{"childId":"{ID}","childName":"{NAME}"}' > output/__CHILD_START__{ID}.json
   c. Launch using the Task tool with the prompt contents as the task instructions
   d. When it completes, write the done marker: echo '{"childId":"{ID}","childName":"{NAME}","outputFiles":[...]}' > output/__CHILD_DONE__{ID}.json

2. Launch children in the correct order:
   - Single wave: Launch ALL children concurrently (multiple Task calls in one message)
   - Multi-wave: Launch Wave 1 children concurrently, wait for ALL to complete, then launch Wave 2, etc.

3. Each subagent runs in the SAME workspace — it can read from input/ and writes to output/
4. After all subagents complete, their outputs are available in output/ for you to read and aggregate

## Progress Markers
Signal files in output/ tell the orchestrator about subagent lifecycle:
- __CHILD_START__{id}.json — Written BEFORE launching the subagent
- __CHILD_DONE__{id}.json — Written AFTER the subagent completes successfully
These are NOT output artifacts — the orchestrator filters them out during collection.

## Post-Subagent Aggregation
After all subagents finish:
1. Read each subagent's output files from output/
2. Aggregate, synthesize, or merge the results as described in your task instructions
3. Write YOUR required outputs (which are typically aggregations of children's work)

# ━━━ INTERRUPT PROTOCOL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When your prompt includes an "Interrupts" section, you MUST use interrupts to pause execution and get human input as described. Failing to create required interrupts means the phase is INCOMPLETE. This is a file-based protocol using the output/ directory.

## How Interrupts Work
1. Write your interrupt request as JSON to: output/__INTERRUPT__{id}.json
2. Poll for the answer file: output/__ANSWER__{id}.json
3. Poll every 5 seconds using: while [ ! -f output/__ANSWER__{id}.json ]; do sleep 5; done
4. Once the answer file appears, read it and continue your work
5. Do NOT proceed with interrupt-dependent work while waiting — you may do independent work

Use unique, sequential IDs for each interrupt: int_001, int_002, etc.

## Interrupt Types

### Type: approval
Use BEFORE taking destructive, expensive, or irreversible actions.

Request format:
\`\`\`json
{
  "interrupt_id": "int_001",
  "type": "approval",
  "mode": "inline",
  "title": "Approve high-cost API call",
  "context": "Explain why this action needs approval",
  "source": { "agentPath": [], "depth": 0 },
  "proposal": "Description of what you want to do",
  "evidence": ["Supporting fact 1", "Supporting fact 2"],
  "options": ["approve", "reject", "modify"]
}
\`\`\`

Answer format:
\`\`\`json
{
  "decision": "approve",
  "modifications": "Optional modifications if decision is modify"
}
\`\`\`

### Type: qa
Use when you need answers to specific questions from the user.

Request format:
\`\`\`json
{
  "interrupt_id": "int_002",
  "type": "qa",
  "mode": "inline",
  "title": "Questions about analysis scope",
  "context": "I need clarification to proceed",
  "source": { "agentPath": [], "depth": 0 },
  "questions": [
    {
      "id": "q1",
      "label": "What time period should the analysis cover?",
      "context": "The input data spans 2020-2025",
      "inputType": "choice",
      "options": ["Last 12 months", "Last 3 years", "Full history"],
      "required": true
    },
    {
      "id": "q2",
      "label": "Any specific competitors to focus on?",
      "context": "I found 12 competitors in the market",
      "inputType": "text",
      "required": false
    }
  ]
}
\`\`\`

Answer format:
\`\`\`json
{
  "answers": {
    "q1": "Last 3 years",
    "q2": "Focus on Acme Corp and Beta Inc"
  }
}
\`\`\`

Valid inputType values: "text", "number", "choice", "boolean"

### Type: selection
Use when the user must choose from a curated list of options.

Request format:
\`\`\`json
{
  "interrupt_id": "int_003",
  "type": "selection",
  "mode": "inline",
  "title": "Select risk factors to investigate",
  "context": "I identified these potential risk areas",
  "source": { "agentPath": [], "depth": 0 },
  "items": [
    { "id": "financial", "label": "Financial Risk", "description": "Revenue concentration, burn rate", "recommended": true },
    { "id": "legal", "label": "Legal Risk", "description": "IP disputes, regulatory compliance", "recommended": true },
    { "id": "market", "label": "Market Risk", "description": "TAM shrinkage, competition", "recommended": false }
  ],
  "minSelect": 1,
  "maxSelect": null
}
\`\`\`

Answer format:
\`\`\`json
{
  "selected": ["financial", "legal"]
}
\`\`\`

### Type: review
Use when the user should review and potentially edit a draft document.

Request format:
\`\`\`json
{
  "interrupt_id": "int_004",
  "type": "review",
  "mode": "inline",
  "title": "Review draft investment memo",
  "context": "Please review before finalizing",
  "source": { "agentPath": [], "depth": 0 },
  "draftFile": "output/investment_memo_draft",
  "format": "markdown",
  "instructions": "Check the executive summary and risk assessment sections for accuracy"
}
\`\`\`

Answer format:
\`\`\`json
{
  "accepted": true
}
\`\`\`
or
\`\`\`json
{
  "accepted": false,
  "editedContent": "The full edited content replaces the draft..."
}
\`\`\`

Valid format values: "markdown", "json", "text"

## Interrupt Best Practices
- Use interrupts sparingly — only when human judgment is genuinely needed
- Provide rich context so the user can make informed decisions
- For approval: always include evidence array with supporting facts
- For qa: mark questions as required: false when you have reasonable defaults
- For selection: set recommended: true on items you suggest
- For review: write the draft file BEFORE creating the interrupt
- Always include source: { agentPath: [], depth: 0 } for top-level agents
- Child subagents should set agentPath to their position, e.g., ["risk_assessment", "analyze_financials"]

# ━━━ ERROR HANDLING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Missing or Malformed Inputs
- If an expected input file is missing from input/, document this in your output rather than failing silently
- If an input file exists but is malformed (invalid JSON, corrupt data), note the issue and work with what you can extract
- Never fabricate data to fill in for missing inputs — flag the gap explicitly

## Budget Management
- Monitor your turn count and cost against the budget limits in your prompt
- If you are approaching the budget limit, prioritize completing required outputs over optional work
- It is better to produce all outputs at 80% quality than some outputs at 100% and others missing

## Tool Failures
- If a shell command fails, inspect the error, fix the issue, and retry
- If a subagent fails to produce expected outputs, document what is missing and proceed with available data
- Never silently skip required work — always document issues in your outputs

## Output Validation Failures
- If your JSON output fails validation, fix it immediately
- If you cannot produce a required output, create the file with a clear error message inside explaining why

# ━━━ CRITICAL RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. You are executing ONE phase — do not attempt to run subsequent phases
2. Write ALL outputs to output/ — the orchestrator only collects from this directory
3. Read inputs from input/ — these are the artifacts from prior phases
4. Every file listed in Required Outputs MUST exist in output/ before you finish
5. Verify your outputs exist and are valid before declaring completion
6. Stay within budget constraints (max turns and max cost)
7. If you have subagents, launch them as described in your prompt and wait for completion
8. Signal files (__INTERRUPT__, __ANSWER__, __CHILD_START__, __CHILD_DONE__, __PROGRESS__) are protocol files, not outputs
9. If interrupts, subagents, or skills are specified in your prompt, executing ALL of them is MANDATORY — not optional`;

/**
 * Compile a per-phase markdown prompt for a single FlowNode.
 * Internally builds a PhaseIR then generates markdown.
 *
 * @deprecated Use compilePhase(nodeId, graph) for the FlowGraph-based API.
 */
export function compilePhasePrompt(node: FlowNode, context: CompileContext): string {
  const ir = resolvePhaseIRFromContext(node, context, false);
  return generateMarkdown(ir);
}

/**
 * Compile self-contained prompt files for all descendants of a node.
 * Returns Map<filename, content> where filename is `{childId}.md`.
 *
 * @deprecated Use compileChildPrompts(nodeId, graph) for the FlowGraph-based API.
 */
export function compileChildPromptFiles(
  node: FlowNode,
  context: CompileContext,
): Map<string, string> {
  const prompts = new Map<string, string>();
  collectChildPromptsViaIR(node.children, context, prompts);
  return prompts;
}

// --- Legacy CompileContext → IR adapter ---

function collectChildPromptsViaIR(
  children: FlowNode[],
  context: CompileContext,
  prompts: Map<string, string>,
): void {
  for (const child of children) {
    const ir = resolvePhaseIRFromContext(child, context, true);
    prompts.set(`${child.id}.md`, generateMarkdown(ir));
    if (child.children.length > 0) {
      collectChildPromptsViaIR(child.children, context, prompts);
    }
  }
}

function resolvePhaseIRFromContext(
  node: FlowNode,
  context: CompileContext,
  isChild: boolean,
): PhaseIR {
  if (node.type === 'checkpoint') {
    return resolveCheckpointIRFromContext(node, context);
  }

  const allSkillNames = [...new Set([...context.globalSkills, ...node.config.skills])];

  const inputs: InputFileEntry[] = node.config.inputs.map((ref) => {
    const file = artifactName(ref);
    const source = context.inputSources.get(file) ?? 'unknown';
    return {
      file,
      source,
      sourceLabel: source === 'user_upload' ? 'user upload' : `from ${source}`,
    };
  });

  const outputs: OutputFileEntry[] = node.config.outputs.map((ref) => ({
    file: artifactName(ref),
  }));

  const skills: SkillEntry[] = allSkillNames.map((name) => ({
    name,
    path: `skills/${name}/`,
  }));

  const budget = isChild
    ? node.config.budget
    : (node.config.budget ?? {
        maxTurns: context.flowBudget.maxTurns,
        maxBudgetUsd: context.flowBudget.maxBudgetUsd,
      });

  const children: ChildReference[] = node.children.map((child, i) => ({
    index: i + 1,
    id: child.id,
    name: child.name,
    promptFile: `prompts/${child.id}.md`,
    outputs: child.config.outputs.map(artifactName),
    wave: 0, // Legacy API: no FlowGraph, assume all concurrent
  }));

  const ir: AgentPhaseIR = {
    kind: 'agent',
    nodeId: node.id,
    name: node.name,
    isChild,
    flowName: context.flowName,
    instructions: node.instructions,
    inputs,
    outputs,
    skills,
    budget,
    children,
    interrupt: { enabled: hasInterrupts(node) },
  };

  return ir;
}

function resolveCheckpointIRFromContext(
  node: FlowNode,
  context: CompileContext,
): CheckpointIR {
  const filesToPresent: InputFileEntry[] = node.config.inputs.map((ref) => {
    const file = artifactName(ref);
    const source = context.inputSources.get(file) ?? 'unknown';
    return {
      file,
      source,
      sourceLabel: source === 'user_upload' ? 'user upload' : `from ${source}`,
    };
  });

  const expectedInputs: OutputFileEntry[] = node.config.outputs.map((ref) => ({
    file: artifactName(ref),
  }));

  return {
    kind: 'checkpoint',
    nodeId: node.id,
    name: node.name,
    instructions: node.instructions,
    filesToPresent,
    expectedInputs,
    presentation: node.config.presentation,
  };
}

/**
 * Check if a node or any of its children have interrupt configs.
 * Used only in the legacy CompileContext path.
 */
function hasInterrupts(node: FlowNode): boolean {
  if (node.config.interrupts && node.config.interrupts.length > 0) return true;
  return node.children.some(hasInterrupts);
}
