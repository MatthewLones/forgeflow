import type { FlowNode, FlowDefinition } from '@forgeflow/types';
import { ProjectStore } from './project-store.js';

/* ── System prompt ────────────────────────────────────── */

export const FORGE_COPILOT_SYSTEM_PROMPT = `You are Forge, an AI copilot for ForgeFlow — an agent workflow builder.

## Your Environment
You are working inside a ForgeFlow project directory. The project contains:
- FLOW.json — The flow definition (DAG of nodes with edges)
- skills/ — Reusable skill directories (each has SKILL.md + optional references/)
- project.json — Project metadata

## ForgeFlow Concepts
- **Nodes**: Work units in a DAG. Types: "agent" (runs Claude Code) or "checkpoint" (pauses for user input)
- **Edges**: Dependencies between nodes (from → to means "to" runs after "from")
- **Children**: Sub-agents within a node, run in parallel. NOT skills.
- **Skills**: Reusable knowledge (SKILL.md + references). Attached to nodes via config.skills. Every agent should have skills whenever domain knowledge, style guides, or reference material is relevant.
- **Artifacts**: Named files passed between nodes via config.inputs/outputs. Can be plain strings or full ArtifactSchema objects with name, format, description, and fields.
- **Interrupts**: In-agent pause points for human oversight. Every non-trivial agent node should declare interrupts. Types: "approval", "qa", "selection", "review", "escalation". Mode: "inline" (agent pauses mid-run) or "checkpoint" (creates full pause).
- **Checkpoints**: Dedicated pause nodes (type="checkpoint") for major handoffs, with presentation config (title, sections).
- **Flow**: A DAG of nodes with edges, global settings, and a budget.

## Node Structure
Each node has:
\`\`\`
{
  id: string,           // snake_case
  type: "agent" | "checkpoint",
  name: string,         // display name
  instructions: string, // what the agent should do
  config: {
    inputs: string[],   // input artifact names
    outputs: string[],  // output artifact names
    skills: string[],   // skill names to attach
    budget?: { maxTurns: number, maxBudgetUsd: number },
    interrupts?: [{ type: "approval"|"qa"|"review"|"selection", mode?: "inline"|"checkpoint", timeoutMs?: number }],
    presentation?: { title: string, sections: string[] }  // checkpoint only
  },
  children: FlowNode[]  // sub-agents
}
\`\`\`

## Interrupt Best Practices
Interrupts are CRITICAL for production workflows. Always add them:
- **approval**: Before destructive or expensive operations
- **qa**: After analysis or generation — let human verify quality
- **review**: For document or code review gates
- **selection**: When the agent needs user to pick between options
- Example: A "generate_report" node should have \`interrupts: [{ type: "review", mode: "inline" }]\` so the user can review the draft before it's finalized.
- Default mode is "inline" with auto-escalate after 5 minutes.

## Skills Best Practices
Skills provide domain knowledge, coding standards, and reference material. Use them heavily:
- Every agent node that does domain-specific work should reference relevant skills
- Create skills for: coding style guides, data format specs, domain terminology, output templates
- Skill structure: \`skills/{name}/SKILL.md\` (main doc) + optional \`references/\` folder
- Attach to nodes via \`config.skills: ["skill-name"]\`
- Example: A "legal_analysis" node should have skills like "contract-law-basics", "clause-taxonomy"

## Available Tools
Use the forgeflow MCP tools for flow operations:
- get_flow, get_project_info, get_skill — read current state
- validate_flow — check for errors before saving
- compile_preview — see what prompts will be generated
- add_node, update_node, remove_node, add_edge, add_child — modify the flow DAG
- save_flow — save the complete flow (use after direct edits)
- create_skill, update_skill — manage skills
- ask_user — ask the user a question when you need clarification

You can also use standard tools (Read, Write, Glob, Grep) to examine files directly.

## Guidelines
1. Read before writing: Always get_flow first to understand the current state
2. Validate after changes: Run validate_flow after modifying the flow
3. Node IDs: Use snake_case (e.g., "parse_documents", "generate_report")
4. Be precise with instructions: Node instructions should clearly describe what the agent should do
5. Artifact naming: Use descriptive names (e.g., "parsed_clauses.json", not "output.json")
6. Prefer MCP tools: Use forgeflow tools over direct file writes for flow/skill operations
7. Ask when unsure: Use ask_user when you need domain-specific information
8. Token efficiency: Don't dump entire flow contents unless asked — summarize
9. Always add interrupts: Every agent node should have at least one interrupt config for human oversight
10. Use skills liberally: Create and attach skills for any domain-specific knowledge the agent needs
11. Keep flows modular: Prefer many small focused nodes over fewer large monolithic ones`;

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
        await store.saveFlow(projectId, args.flow as FlowDefinition);
        return text('Flow saved successfully');
      },
    },
    {
      name: 'add_node',
      description: 'Add a new node to the flow. Always include interrupts for agent nodes.',
      inputSchema: {
        id: { type: 'string', description: 'Snake_case node ID' },
        name: { type: 'string', description: 'Display name' },
        type: { type: 'string', enum: ['agent', 'checkpoint'], description: 'Node type' },
        instructions: { type: 'string', description: 'Agent instructions' },
        inputs: { type: 'array', items: { type: 'string' }, description: 'Input artifact names (optional)' },
        outputs: { type: 'array', items: { type: 'string' }, description: 'Output artifact names (optional)' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Skill names to attach (optional)' },
        interrupts: { type: 'array', items: { type: 'object' }, description: 'Interrupt configs: [{ type: "approval"|"qa"|"review"|"selection", mode?: "inline"|"checkpoint" }] (optional but recommended)' },
        afterNodeId: { type: 'string', description: 'If provided, add an edge from this node to the new one (optional)' },
      },
      handler: async (args) => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        const newNode: FlowNode = {
          id: args.id as string,
          type: (args.type as 'agent' | 'checkpoint') ?? 'agent',
          name: args.name as string,
          instructions: args.instructions as string,
          config: {
            inputs: (args.inputs as string[]) ?? [],
            outputs: (args.outputs as string[]) ?? [],
            skills: (args.skills as string[]) ?? [],
            interrupts: (args.interrupts as Array<{ type: string; mode?: string; timeoutMs?: number }>) ?? undefined,
          },
          children: [],
        };
        flow.nodes.push(newNode);
        if (args.afterNodeId) {
          flow.edges.push({ from: args.afterNodeId as string, to: args.id as string });
        }
        await store.saveFlow(projectId, flow);
        return text(`Node "${args.name}" (${args.id}) added successfully`);
      },
    },
    {
      name: 'update_node',
      description: "Update a node's properties (name, instructions, config, interrupts, skills)",
      inputSchema: {
        nodeId: { type: 'string', description: 'Node ID to update' },
        name: { type: 'string', description: 'New display name (optional)' },
        instructions: { type: 'string', description: 'New instructions (optional)' },
        inputs: { type: 'array', items: { type: 'string' }, description: 'New input list (optional)' },
        outputs: { type: 'array', items: { type: 'string' }, description: 'New output list (optional)' },
        skills: { type: 'array', items: { type: 'string' }, description: 'New skills list (optional)' },
        interrupts: { type: 'array', items: { type: 'object' }, description: 'Interrupt configs: [{ type: "approval"|"qa"|"review"|"selection", mode?: "inline"|"checkpoint" }] (optional)' },
      },
      handler: async (args) => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        const node = findNodeRecursive(flow.nodes, args.nodeId as string);
        if (!node) return text(`Node "${args.nodeId}" not found`);
        if (args.name) node.name = args.name as string;
        if (args.instructions) node.instructions = args.instructions as string;
        if (args.inputs) node.config.inputs = args.inputs as string[];
        if (args.outputs) node.config.outputs = args.outputs as string[];
        if (args.skills) node.config.skills = args.skills as string[];
        if (args.interrupts) node.config.interrupts = args.interrupts as Array<{ type: string; mode?: string; timeoutMs?: number }>;
        await store.saveFlow(projectId, flow);
        return text(`Node "${args.nodeId}" updated`);
      },
    },
    {
      name: 'remove_node',
      description: 'Remove a node from the flow',
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
        return text(`Node "${id}" removed`);
      },
    },
    {
      name: 'add_edge',
      description: 'Add a dependency edge between two nodes',
      inputSchema: {
        from: { type: 'string', description: 'Source node ID' },
        to: { type: 'string', description: 'Target node ID' },
      },
      handler: async (args) => {
        const flow = await store.getFlow(projectId);
        if (!flow) return text('No flow found');
        flow.edges.push({ from: args.from as string, to: args.to as string });
        await store.saveFlow(projectId, flow);
        return text(`Edge ${args.from} → ${args.to} added`);
      },
    },
    {
      name: 'add_child',
      description: 'Add a child (sub-agent) to a parent node',
      inputSchema: {
        parentId: { type: 'string', description: 'Parent node ID' },
        id: { type: 'string', description: 'Child node ID' },
        name: { type: 'string', description: 'Child display name' },
        instructions: { type: 'string', description: 'Child instructions' },
        inputs: { type: 'array', items: { type: 'string' }, description: 'Input artifacts (optional)' },
        outputs: { type: 'array', items: { type: 'string' }, description: 'Output artifacts (optional)' },
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
          instructions: args.instructions as string,
          config: {
            inputs: (args.inputs as string[]) ?? [],
            outputs: (args.outputs as string[]) ?? [],
            skills: [],
          },
          children: [],
        });
        await store.saveFlow(projectId, flow);
        return text(`Child "${args.name}" added to ${args.parentId}`);
      },
    },

    // --- Skill operations ---
    {
      name: 'create_skill',
      description: 'Create a new skill with initial SKILL.md content',
      inputSchema: {
        name: { type: 'string', description: 'Skill name (lowercase, hyphens ok)' },
        content: { type: 'string', description: 'SKILL.md markdown content' },
      },
      handler: async (args) => {
        await store.createSkill(projectId, args.name as string);
        await store.saveSkill(projectId, args.name as string, [
          { path: 'SKILL.md', content: args.content as string },
        ]);
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
        return text(`Skill "${args.name}" updated`);
      },
    },

    // --- User interaction ---
    {
      name: 'ask_user',
      description: 'Ask the user a question and wait for their response. Use for clarifications or decisions.',
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
          description: 'Optional multiple-choice options',
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
