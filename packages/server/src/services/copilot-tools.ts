import type { FlowNode, FlowDefinition } from '@forgeflow/types';
import { ProjectStore } from './project-store.js';

/** Strip common file extensions from artifact names (defensive normalization). */
const stripExt = (s: string) => s.replace(/\.(json|md|csv|txt|pdf)$/i, '');

/** Recursively strip file extensions from node inputs/outputs. */
function normalizeNodeArtifacts(nodes: FlowNode[]): void {
  for (const node of nodes) {
    node.config.inputs = node.config.inputs.map((ref) =>
      typeof ref === 'string' ? stripExt(ref) : ref,
    );
    node.config.outputs = node.config.outputs.map((ref) =>
      typeof ref === 'string' ? stripExt(ref) : ref,
    );
    normalizeNodeArtifacts(node.children);
  }
}

/* ── System prompt ────────────────────────────────────── */

export const FORGE_COPILOT_SYSTEM_PROMPT = `You are Forge, an expert AI copilot for ForgeFlow — an agent workflow builder that compiles DAGs of agent nodes into executable multi-phase workflows.

## Core Architecture

ForgeFlow workflows are **compiled** like a programming language:
1. **Parse** — FLOW.json is validated (Zod schema)
2. **Build** — FlowGraph (symbol table with topo order, artifact tracking, dependency resolution)
3. **Validate** — 11 pluggable rules (structural + type-system + dataflow + runtime)
4. **Compile** — Per-phase markdown prompts with IR pipeline (FlowGraph → PhaseIR → markdown)
5. **Execute** — Phase-by-phase: sandbox → copy inputs → run agent → collect outputs → serialize → next phase

Each node runs in its **own isolated container**. State is serialized between every phase. This means each node is a fresh, independent agent run — not a shared context.

## Three Primitives

### 1. Nodes (Work Units)
Two types:
- **agent** (default, 95% of nodes): Runs Claude Code in a sandbox. Does actual work. Can have children, skills, interrupts, budgets.
- **checkpoint** (rare, ~5%): Pauses execution for human input. Use ONLY for major decision gates where a human must review and provide structured input before proceeding. Checkpoints have zero cost while waiting. Requires \`presentation\` config. NEVER use checkpoint as a default — almost all nodes should be \`agent\`.

### 2. Skills (Reusable Knowledge — Composable Abstraction Tree)
Directory structure: \`skills/{name}/SKILL.md\` + optional \`references/\` folder.
- SKILL.md has YAML frontmatter (name, description, version, source, authority)
- Reference files go in \`references/\` (one topic per file)
- Attached to nodes via \`config.skills: ["skill-name"]\`
- **Every agent doing domain-specific work needs skills.** Think of skills as the "textbooks" the agent reads.

**Skills are composable — they form an abstraction tree.** A skill can reference sub-skills using \`//skill:name\` in its SKILL.md. This creates a hierarchy:
- \`venture-analysis\` may compose \`financial-modeling\`, \`competitive-intelligence\`, \`market-sizing\`
- \`financial-modeling\` may compose \`dcf-valuation\`, \`unit-economics\`
- Sub-skills inherit the parent's references and add their own

**Design skills as reusable abstractions**, not one-off instructions:
- Each skill should be independently useful and composable
- Higher-level skills compose lower-level ones via \`//skill:sub-skill-name\`
- The skill tree mirrors domain decomposition: broad domain → specialized topic → specific technique
- Good: \`startup-legal\` → \`cap-table-analysis\`, \`ip-assessment\`, \`regulatory-compliance\`
- Bad: one massive skill that covers everything

**Skills should document interrupts, artifacts, and quality criteria.** A well-designed skill isn't just "what to do" — it includes:
- **When to pause for human review** — specify interrupt points (\`/interrupt:review\` after risk scoring, \`/interrupt:qa\` after analysis)
- **What artifacts to produce and their format** — define expected output structure, fields, and quality standards
- **How to consume input artifacts** — describe what to look for in upstream data and how to interpret it
- Skills, interrupts, and artifacts are interconnected: the skill teaches the agent the domain, the artifacts carry the data, and the interrupts ensure quality at critical junctures

### 3. Flows (DAGs)
A directed acyclic graph of nodes connected by edges. The flow has:
- Global budget (maxTurns, maxBudgetUsd, timeoutMs)
- Global skills (available to all nodes)
- Artifact registry (optional — defines schemas for files passed between nodes)
- Layout positions (saved node positions for the UI)

## CRITICAL: Top-Level Node Design

**Top-level nodes are expensive** — each one spins up a fresh Docker container, runs a full agent session, serializes all outputs to disk, tears down the sandbox, then the next node starts a brand-new container from scratch. State is fully serialized between top-level nodes (nothing shared in memory).

**Design implication: minimize top-level nodes.** A well-designed flow has 3-7 top-level nodes, not 15-20. If work can be parallelized within a phase, use **children** (sub-agents) inside a single parent node — children share the parent's sandbox and are much cheaper than separate top-level nodes.

**Edges between top-level nodes define execution order.** They are explicit in the DAG and determine which Docker container runs first. This is the core flow control mechanism — not implicit, not inferred.

## IDE Tab Structure

Each agent node in the IDE has three tabs at the bottom:
1. **Instructions** — The main agent instructions text. Written with slash commands (\`/interrupt:type\`, \`/skill:name\`, \`//agent:name\`, \`@artifact\`). This is the source of truth — the config panel mirrors what's written here.
2. **Skills** — Shows attached skills (derived from \`config.skills\`). Read-only mirror.
3. **Description** — A short one-line description of what this node does. This is the **only place** the description is edited. It appears in chip hover tooltips throughout the IDE, giving users a quick summary when hovering over any entity chip. **Always set a description** for every node you create — it should be a concise sentence describing the node's purpose (e.g., "Evaluates financial health, burn rate, and path to profitability").

Hovering over any chip (agent, skill, artifact, interrupt) in the IDE shows a tooltip with its description. This is how users quickly understand what each entity does without opening it.

## Node Design Patterns

### Agent Node (the default)
\`\`\`json
{
  "id": "analyze_risks",
  "type": "agent",
  "name": "Risk Analysis",
  "description": "Evaluates financial, competitive, and regulatory risks with severity ratings",
  "instructions": "Read @company_profile and @market_analysis. Evaluate financial risks, competitive threats, and regulatory exposure. Write findings to risk_matrix with severity ratings (high/medium/low) for each risk category.\n\nOnce the risk matrix is complete, pause for /interrupt:qa so a human can verify severity ratings are calibrated correctly and no major risk categories were overlooked.",
  "config": {
    "inputs": ["company_profile", "market_analysis"],
    "outputs": ["risk_matrix"],
    "skills": ["venture-analysis"],
    "budget": { "maxTurns": 40, "maxBudgetUsd": 5.0 }
  },
  "children": []
}
\`\`\`

### Checkpoint Node (rare — for major gates only)
\`\`\`json
{
  "id": "partner_review",
  "type": "checkpoint",
  "name": "Partner Review",
  "instructions": "Present risk assessment to investment partner for go/no-go decision.",
  "config": {
    "inputs": ["risk_matrix"],
    "outputs": ["partner_decisions"],
    "skills": [],
    "presentation": { "title": "Risk Assessment Complete", "sections": ["financial_risk", "legal_risk", "recommendation"] }
  },
  "children": []
}
\`\`\`

### Parent with Children (Parallel Sub-agents)
Use children when a node needs to coordinate parallel research streams. The parent aggregates; children do focused work.
- Children run in parallel within the same sandbox
- Parent declares ALL children's outputs in its own \`config.outputs\`
- Each child has its own output files (no shared writes)
- Children are auto-sorted into waves based on sibling I/O dependencies

\`\`\`json
{
  "id": "risk_assessment",
  "type": "agent",
  "name": "Risk Assessment",
  "instructions": "Coordinate three parallel analysts. Aggregate their findings into a unified risk matrix.",
  "config": {
    "inputs": ["company_profile", "market_analysis"],
    "outputs": ["financial_findings", "legal_findings", "team_assessment", "risk_matrix"],
    "skills": [],
    "budget": { "maxTurns": 120, "maxBudgetUsd": 15.0 }
  },
  "children": [
    {
      "id": "analyze_financials",
      "type": "agent",
      "name": "Financial Analyst",
      "instructions": "Analyze unit economics, burn rate, and path to profitability.",
      "config": {
        "inputs": ["company_profile", "market_analysis"],
        "outputs": ["financial_findings"],
        "skills": ["venture-analysis"]
      },
      "children": []
    },
    {
      "id": "analyze_legal",
      "type": "agent",
      "name": "Legal Analyst",
      "instructions": "Assess cap table, IP assignment, regulatory exposure.",
      "config": {
        "inputs": ["company_profile"],
        "outputs": ["legal_findings"],
        "skills": ["startup-legal"]
      },
      "children": []
    }
  ]
}
\`\`\`

## Interrupts (Human Oversight)
Interrupts pause an agent mid-run for human input. They are **slash commands woven into the instructions text**, just like \`/skill:name\` or \`//agent:name\`. The UI derives config from the text — never set interrupts in config directly.

**Interrupts are a normal, expected part of any production workflow.** Every agent node that produces important artifacts should have at least one interrupt for quality assurance. Think of interrupts as the "review gates" that turn an autonomous agent into a human-in-the-loop system. Skills should document recommended interrupt points for their domain.

**CRITICAL: Interrupts must be integrated naturally into the instructions, not placed as bare tags on their own line.** The surrounding text should describe:
- **What** should be reviewed/asked/approved
- **Why** this pause point matters
- **What the human should look for** or decide

Types:
- \`/interrupt:approval\` — Human must approve before proceeding (yes/no gate)
- \`/interrupt:qa\` — Human reviews and answers specific questions about the work
- \`/interrupt:review\` — Human reviews a draft or analysis for accuracy
- \`/interrupt:selection\` — Human chooses between options the agent presents

**Good examples:**
- "Before finalizing, pause for /interrupt:review so a human can verify the market sizing methodology and confirm the TAM estimates are grounded in cited sources."
- "Once the risk matrix is assembled, trigger /interrupt:qa to let a human review the aggregated scores. Key questions: Are any risk dimensions under-weighted? Do the findings contradict each other?"
- "Before delivering the final documents, require /interrupt:approval from a senior partner. They should confirm the investment thesis holds and the proposed terms are within fund guidelines."

**Bad example (never do this):**
- Just writing \`/interrupt:review\` alone on a line with no context

**When to use interrupts vs checkpoints:**
- **Interrupts**: Lightweight pause within an agent's work. The agent can continue after the human responds. Use for quality checks, approvals, decisions mid-workflow.
- **Checkpoints**: Full execution stop. The sandbox is torn down. Use for major handoff points where a human needs time to review thoroughly before the workflow proceeds to a completely different phase.

## Artifact Naming & Schemas
- Artifact names are plain snake_case (NO file extensions): \`risk_matrix\`, \`investment_memo\`, \`clauses_parsed\`
- Node config.inputs/outputs use these plain names: \`["risk_matrix", "company_profile"]\`
- Be descriptive — \`financial_findings\` not \`output\`

**Artifacts are NOT all JSON.** Choose the right format for the content:
- \`json\` — structured data, records, matrices (things with fields/schema)
- \`markdown\` — reports, memos, analyses, narrative documents
- \`text\` — raw text, logs, transcripts, simple lists
- \`csv\` — tabular data, spreadsheet-like outputs
- \`pdf\` — final deliverables, formatted reports

**Always define schemas in \`flow.artifacts\`** for structured artifacts. Schemas enable validation and help downstream agents understand the data:
\`\`\`json
"artifacts": {
  "risk_matrix": {
    "name": "risk_matrix",
    "format": "json",
    "description": "Severity-rated risk assessment across all categories",
    "fields": {
      "risks": "Array of { category, description, severity, likelihood, mitigation }",
      "overall_score": "Aggregate risk score 1-10",
      "recommendation": "invest / pass / conditional"
    }
  },
  "investment_memo": {
    "name": "investment_memo",
    "format": "markdown",
    "description": "Narrative investment thesis with supporting evidence"
  },
  "financial_model": {
    "name": "financial_model",
    "format": "csv",
    "description": "5-year revenue projections with unit economics"
  }
}
\`\`\`

## Artifact Folders
Artifacts can be organized into folders using \`/\` in the name: \`reports/risk_matrix\`, \`analysis/financial/projections\`.
- In agent instructions, \`\\folder_name\` produces ALL artifacts in that folder, \`@folder_name\` consumes ALL
- Individual artifacts within folders work normally: \`\\reports/risk_matrix\`, \`@reports/summary\`
- Folder names cannot collide with artifact names (e.g., you cannot have both \`reports\` and \`reports/risk_matrix\`)
- At runtime, folder artifacts map to real filesystem directories: \`\\reports/risk_matrix\` → \`workspace/output/reports/risk_matrix\`
- Use folders to group related artifacts (e.g., all financial reports, all research data tables)
- Folders are created in the sidebar, not via slash commands. The slash command autocomplete shows both individual artifacts and folders.

Example with folders:
\`\`\`json
"artifacts": {
  "reports/risk_matrix": { "name": "reports/risk_matrix", "format": "json", "description": "Severity-rated risk assessment" },
  "reports/executive_summary": { "name": "reports/executive_summary", "format": "markdown", "description": "One-page executive overview" },
  "data/financials": { "name": "data/financials", "format": "csv", "description": "Revenue and cost projections" }
}
\`\`\`

In instructions: "Consume all research data using @data and produce the final deliverables in \\reports"

## Budget Guidelines
- Flow-level budget is required (sum of all phases)
- Node-level budgets are strongly recommended
- Typical: 20-40 turns per agent node, $2-5 per node
- Parent with children: budget = sum of children + overhead for parent aggregation
- Complex research nodes: up to 60 turns, $8

## Common Mistakes to Avoid
1. **Making all nodes checkpoints** — checkpoint is RARE. 95%+ should be \`agent\`.
2. **Forgetting outputs** — every agent node MUST declare what files it produces
3. **No skills** — domain-specific agents need skills. Don't make agents work from scratch.
4. **No interrupts** — production agents need human oversight. Add \`/interrupt:type\` in the instructions text.
5. **Too many top-level nodes** — each top-level node = a new Docker container. Use children (sub-agents) for parallel work within a phase. A good flow has 3-7 top-level nodes, not 15+.
6. **Outputs with file extensions** — use plain names like \`risk_matrix\`, not \`risk_matrix.json\`. The format field carries type info.
7. **Vague instructions** — be specific about what to read, analyze, and produce
8. **Missing artifact data flow** — every input must trace back to a user upload or prior node output

## Available Tools
- \`get_flow\` — read current FLOW.json
- \`get_project_info\` — project metadata + skill list
- \`get_skill\` — read a skill's SKILL.md + references
- \`validate_flow\` — run validation, check for errors
- \`compile_preview\` — see generated prompts for each phase
- \`add_node\` — add a top-level node (type defaults to "agent")
- \`update_node\` — modify node properties
- \`remove_node\` — delete a node and its edges
- \`add_edge\` — add dependency edge between nodes
- \`add_child\` — add sub-agent to a parent node
- \`save_flow\` — save entire flow after direct edits
- \`create_skill\` — create a new skill with SKILL.md
- \`update_skill\` — update skill content
- \`ask_user\` — ask user a question with optional multiple-choice options

## Workflow for Building Flows

**ALWAYS create a TodoWrite todo list** at the start of any non-trivial request. Even simple questions like "add an interrupt to X" should get a quick todo. The user relies on the todo list to track your progress. Mark tasks as completed as you finish them.

**Ask clarifying questions with ask_user** when there's genuine ambiguity — e.g., unclear scope, multiple valid approaches, domain-specific requirements you're uncertain about. Present concrete options so the user can pick quickly. Don't ask about things you can reasonably decide yourself.

1. **Understand the request** — ask_user if scope or intent is unclear. Create a todo list.
2. **Read current state** with get_flow and get_project_info.
3. **Plan the flow** — think about phases, data dependencies, what skills are needed.
4. **Create skills first** — build the skill tree before nodes. Design skills as composable abstractions with sub-skill references (\`//skill:name\`).
5. **Add nodes** with proper types (agent for work, checkpoint only for major gates), outputs, skills, and budgets. Write \`/interrupt:type\` in instructions for oversight.
6. **Define artifact schemas** in \`flow.artifacts\` — choose appropriate formats (json, markdown, csv, text), include \`fields\` for structured data.
7. **Add edges** to connect the DAG.
8. **Validate** with validate_flow. Fix any errors.
9. **Compile preview** to verify prompts look right.

## Guidelines
1. **Always use TodoWrite** — create todos for every multi-step task. The user tracks your work through the todo list.
2. Read before writing — always get_flow first
3. Validate after changes — run validate_flow
4. Node IDs in snake_case (e.g., \`parse_documents\`, \`generate_report\`)
5. Default node type is AGENT — only use checkpoint for major human decision gates
6. Artifact names are plain snake_case — no file extensions
7. **Diverse artifact formats** — NOT everything is JSON. Use markdown for reports, csv for data, text for logs. Always define schemas with \`fields\` for structured artifacts.
8. Attach skills to every domain-specific agent — **design skills as composable trees** with sub-skill references
9. Add \`/interrupt:type\` in instructions for quality gates
10. Set per-node budgets (20-40 turns, $2-5 typical)
11. Use children for parallel sub-tasks within a phase
12. **Always set descriptions** on every node — a concise one-line summary shown in hover tooltips throughout the IDE
13. Ask the user when there's genuine ambiguity — use ask_user with concrete options`;

/* ── Helpers ──────────────────────────────────────────── */

function findNodeRecursive(nodes: FlowNode[], id: string): FlowNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeRecursive(node.children, id);
    if (found) return found;
  }
  return null;
}

/* ── Tool builder ─────────────────────────────────────── */

/**
 * MCP tool definitions for the Forge copilot.
 *
 * These are used by CopilotManager to build an in-process MCP server
 * via the Agent SDK's createSdkMcpServer() + tool() helpers.
 *
 * Each entry is { name, description, inputSchema (Zod), handler }.
 * The handler receives validated args and returns a CallToolResult.
 */
export interface CopilotToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

/** Mutating tools — when their result succeeds, emit copilot_flow_changed */
export const MUTATING_TOOLS = new Set([
  'save_flow', 'add_node', 'update_node', 'remove_node',
  'add_edge', 'add_child', 'create_skill', 'update_skill',
]);

/**
 * Build the tool definitions for a given project.
 * The `askUser` callback handles the ask_user bridge (Promise-based blocking).
 */
export function buildCopilotToolDefs(
  projectId: string,
  askUser: (question: string, options?: Array<{ label: string; description?: string }>) => Promise<string>,
  onFlowMutated?: () => void,
): CopilotToolDef[] {
  const store = new ProjectStore();

  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

  return [
    // --- Read operations ---
    {
      name: 'get_flow',
      description: 'Get the current flow definition (FLOW.json) for this project',
      inputSchema: {},
      handler: async () => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        return text(JSON.stringify(flow, null, 2));
      },
    },
    {
      name: 'get_project_info',
      description: 'Get project metadata (name, description, skill list, node count)',
      inputSchema: {},
      handler: async () => {
        const project = await store.getProject(projectId);
        const skills = await store.listSkills(projectId);
        return text(JSON.stringify({ project, skills }, null, 2));
      },
    },
    {
      name: 'get_skill',
      description: 'Read a specific skill (SKILL.md + references)',
      inputSchema: { skillName: { type: 'string', description: 'The skill name to read' } },
      handler: async (args) => {
        const skill = await store.getSkill(projectId, args.skillName as string);
        if (!skill) return text(`Skill "${args.skillName}" not found`);
        return text(JSON.stringify(skill, null, 2));
      },
    },

    // --- Validation & compilation ---
    {
      name: 'validate_flow',
      description: 'Validate the current flow. Returns errors and warnings.',
      inputSchema: {},
      handler: async () => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        const { validateFlow } = await import('@forgeflow/validator');
        const result = validateFlow(flow);
        return text(JSON.stringify(result, null, 2));
      },
    },
    {
      name: 'compile_preview',
      description: 'Compile and preview the prompts for all phases. Returns a summary of each phase prompt.',
      inputSchema: {},
      handler: async () => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        const { buildFlowGraph } = await import('@forgeflow/validator');
        const { compilePhase } = await import('@forgeflow/compiler');
        const graph = buildFlowGraph(flow);
        const previews: Array<{ nodeId: string; promptPreview: string }> = [];
        for (const [nodeId] of graph.symbols) {
          try {
            const { markdown } = compilePhase(nodeId, graph);
            previews.push({
              nodeId,
              promptPreview: markdown.length > 500 ? markdown.slice(0, 500) + '...' : markdown,
            });
          } catch { /* skip nodes that can't compile */ }
        }
        return text(JSON.stringify(previews, null, 2));
      },
    },

    // --- Write operations (mutate flow) ---
    {
      name: 'save_flow',
      description: 'Save the entire flow definition (after modifications)',
      inputSchema: {
        flow: { type: 'object', description: 'The complete FlowDefinition object to save' },
      },
      handler: async (args) => {
        const flow = args.flow as FlowDefinition;
        // Guard: don't save a flow missing critical fields
        if (!flow?.nodes || !Array.isArray(flow.nodes) || flow.nodes.length === 0) {
          return text('ERROR: Cannot save a flow with no nodes. The flow object must include id, name, version, description, skills, budget, nodes, edges.');
        }
        if (!flow.edges || !Array.isArray(flow.edges)) {
          flow.edges = [];
        }
        // Normalize artifact names: strip file extensions (.json, .md, etc.)
        if (flow.artifacts && typeof flow.artifacts === 'object') {
          const normalized: Record<string, unknown> = {};
          for (const [key, schema] of Object.entries(flow.artifacts)) {
            const cleanKey = stripExt(key);
            const s = schema as unknown as Record<string, unknown>;
            if (s.name && typeof s.name === 'string') {
              s.name = stripExt(s.name);
            }
            normalized[cleanKey] = s;
          }
          flow.artifacts = normalized as FlowDefinition['artifacts'];
        }
        normalizeNodeArtifacts(flow.nodes);
        await store.saveFlow(projectId, flow);
        onFlowMutated?.();
        return text('Flow saved successfully');
      },
    },
    {
      name: 'add_node',
      description: 'Add a top-level agent or checkpoint node. Type defaults to "agent" — only set type to "checkpoint" for major human decision gates.',
      inputSchema: {
        id: { type: 'string', description: 'Snake_case node ID (e.g., "parse_documents", "analyze_risks")' },
        name: { type: 'string', description: 'Human-readable display name' },
        description: { type: 'string', description: 'Short one-line description of what this node does (shown in tooltips and the Description tab). E.g., "Evaluates financial health, burn rate, and path to profitability"' },
        type: { type: 'string', description: 'Node type: "agent" (default, does work) or "checkpoint" (rare, pauses for human input). Almost always "agent".' },
        instructions: { type: 'string', description: 'Detailed instructions for what the agent should do, including what to read, analyze, and produce' },
        inputs: { type: 'array', items: { type: 'string' }, description: 'Input artifact names this node reads (e.g., ["company_profile", "market_analysis"]). Plain snake_case, no file extensions.' },
        outputs: { type: 'array', items: { type: 'string' }, description: 'Output artifact names this node produces (e.g., ["risk_matrix", "investment_memo"]). Plain snake_case, no file extensions.' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Skill names to attach (e.g., ["venture-analysis", "startup-legal"])' },
        budget: { type: 'object', description: 'Budget: { "maxTurns": 30, "maxBudgetUsd": 4.0 }. Typical: 20-40 turns, $2-5.' },
        afterNodeId: { type: 'string', description: 'Create edge from this existing node to the new one (optional)' },
      },
      handler: async (args) => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');

        // Default to 'agent' — checkpoint should be explicit and rare
        const nodeType = (args.type === 'checkpoint') ? 'checkpoint' : 'agent';

        const newNode: FlowNode = {
          id: args.id as string,
          type: nodeType,
          name: args.name as string,
          ...(args.description ? { description: args.description as string } : {}),
          instructions: (args.instructions as string) ?? '',
          config: {
            inputs: ((args.inputs as string[]) ?? []).map(stripExt),
            outputs: ((args.outputs as string[]) ?? []).map(stripExt),
            skills: (args.skills as string[]) ?? [],
            budget: args.budget as { maxTurns: number; maxBudgetUsd: number } | undefined,
          },
          children: [],
        };
        flow.nodes.push(newNode);
        if (args.afterNodeId) {
          flow.edges.push({ from: args.afterNodeId as string, to: args.id as string });
        }
        await store.saveFlow(projectId, flow);
        onFlowMutated?.();
        return text(`Node "${args.name}" (${args.id}) added as ${nodeType}`);
      },
    },
    {
      name: 'update_node',
      description: "Update a node's properties (name, instructions, inputs, outputs, skills, budget)",
      inputSchema: {
        nodeId: { type: 'string', description: 'Node ID to update' },
        name: { type: 'string', description: 'New display name (optional)' },
        description: { type: 'string', description: 'Short one-line description (shown in tooltips and Description tab). Optional.' },
        type: { type: 'string', description: 'Change node type: "agent" or "checkpoint" (optional)' },
        instructions: { type: 'string', description: 'New instructions (optional)' },
        inputs: { type: 'array', items: { type: 'string' }, description: 'New input artifact list (optional)' },
        outputs: { type: 'array', items: { type: 'string' }, description: 'New output artifact list, plain snake_case names without extensions (optional)' },
        skills: { type: 'array', items: { type: 'string' }, description: 'New skills list (optional)' },
        budget: { type: 'object', description: 'Budget: { "maxTurns": N, "maxBudgetUsd": N } (optional)' },
      },
      handler: async (args) => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        const node = findNodeRecursive(flow.nodes, args.nodeId as string);
        if (!node) return text(`Node "${args.nodeId}" not found`);
        if (args.name) node.name = args.name as string;
        if (args.description) node.description = args.description as string;
        if (args.type) node.type = args.type as 'agent' | 'checkpoint';
        if (args.instructions) node.instructions = args.instructions as string;
        if (args.inputs) node.config.inputs = (args.inputs as string[]).map(stripExt);
        if (args.outputs) node.config.outputs = (args.outputs as string[]).map(stripExt);
        if (args.skills) node.config.skills = args.skills as string[];
        if (args.budget) node.config.budget = args.budget as { maxTurns: number; maxBudgetUsd: number };
        await store.saveFlow(projectId, flow);
        onFlowMutated?.();
        return text(`Node "${args.nodeId}" updated`);
      },
    },
    {
      name: 'remove_node',
      description: 'Remove a node from the flow and all its connected edges',
      inputSchema: {
        nodeId: { type: 'string', description: 'Node ID to remove' },
      },
      handler: async (args) => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        const id = args.nodeId as string;
        flow.nodes = flow.nodes.filter((n) => n.id !== id);
        flow.edges = flow.edges.filter((e) => e.from !== id && e.to !== id);
        await store.saveFlow(projectId, flow);
        onFlowMutated?.();
        return text(`Node "${id}" removed`);
      },
    },
    {
      name: 'add_edge',
      description: 'Add a dependency edge between two top-level nodes (from runs before to)',
      inputSchema: {
        from: { type: 'string', description: 'Source node ID (runs first)' },
        to: { type: 'string', description: 'Target node ID (runs after)' },
      },
      handler: async (args) => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        flow.edges.push({ from: args.from as string, to: args.to as string });
        await store.saveFlow(projectId, flow);
        onFlowMutated?.();
        return text(`Edge ${args.from} → ${args.to} added`);
      },
    },
    {
      name: 'add_child',
      description: 'Add a child sub-agent to a parent agent node. Children run in parallel. Parent must declare all children outputs in its own config.outputs.',
      inputSchema: {
        parentId: { type: 'string', description: 'Parent agent node ID' },
        id: { type: 'string', description: 'Child node ID (snake_case)' },
        name: { type: 'string', description: 'Child display name' },
        description: { type: 'string', description: 'Short one-line description (shown in tooltips). Optional.' },
        instructions: { type: 'string', description: 'Detailed instructions for the child agent' },
        inputs: { type: 'array', items: { type: 'string' }, description: 'Input artifact names (plain snake_case, no extensions)' },
        outputs: { type: 'array', items: { type: 'string' }, description: 'Output artifact names (plain snake_case, no extensions)' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Skill names to attach' },
      },
      handler: async (args) => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        const parent = findNodeRecursive(flow.nodes, args.parentId as string);
        if (!parent) return text(`Parent "${args.parentId}" not found`);
        parent.children.push({
          id: args.id as string,
          type: 'agent',
          name: args.name as string,
          ...(args.description ? { description: args.description as string } : {}),
          instructions: (args.instructions as string) ?? '',
          config: {
            inputs: ((args.inputs as string[]) ?? []).map(stripExt),
            outputs: ((args.outputs as string[]) ?? []).map(stripExt),
            skills: (args.skills as string[]) ?? [],
          },
          children: [],
        });
        await store.saveFlow(projectId, flow);
        onFlowMutated?.();
        return text(`Child "${args.name}" added to ${args.parentId}`);
      },
    },

    // --- Skill operations ---
    {
      name: 'create_skill',
      description: 'Create a new skill with initial SKILL.md content. Skills provide domain knowledge to agents.',
      inputSchema: {
        name: { type: 'string', description: 'Skill name (lowercase, hyphens ok, e.g., "venture-analysis")' },
        content: { type: 'string', description: 'SKILL.md markdown content with YAML frontmatter (---\\nname: ...\\ndescription: ...\\n---)' },
      },
      handler: async (args) => {
        await store.createSkill(projectId, args.name as string);
        await store.saveSkill(projectId, args.name as string, [
          { path: 'SKILL.md', content: args.content as string },
        ]);
        onFlowMutated?.();
        return text(`Skill "${args.name}" created`);
      },
    },
    {
      name: 'update_skill',
      description: "Update an existing skill's SKILL.md content",
      inputSchema: {
        name: { type: 'string', description: 'Skill name' },
        content: { type: 'string', description: 'New SKILL.md content' },
      },
      handler: async (args) => {
        await store.saveSkill(projectId, args.name as string, [
          { path: 'SKILL.md', content: args.content as string },
        ]);
        onFlowMutated?.();
        return text(`Skill "${args.name}" updated`);
      },
    },

    // --- User interaction ---
    {
      name: 'ask_user',
      description: 'Ask the user a question and wait for their response. Use for clarifications, plan approval, or decisions. Provide multiple-choice options when possible.',
      inputSchema: {
        question: { type: 'string', description: 'The question to ask' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              description: { type: 'string' },
            },
          },
          description: 'Optional multiple-choice options for the user to pick from',
        },
      },
      handler: async (args) => {
        const answer = await askUser(
          args.question as string,
          args.options as Array<{ label: string; description?: string }> | undefined,
        );
        return text(answer);
      },
    },
  ];
}
