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

const DEFAULT_RULES = [
  'Write all output files to the output/ directory',
  'Read input files from the input/ directory',
  'Verify each output file exists before finishing',
  'Stay within budget constraints',
];

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
export const FORGEFLOW_PHASE_SYSTEM_PROMPT = `You are executing one phase of a ForgeFlow workflow inside an isolated sandbox.

RULES:
- Write all output files to the output/ directory
- Read input files from the input/ directory
- Skills are available in skills/ (loaded into the sandbox for this phase)
- For parallel subagents: use the Task tool to spawn concurrent agents
- Verify each output file exists before finishing
- Stay within the budget constraints listed in the prompt
- You are executing ONE phase — do not attempt to run subsequent phases
- If you have children (subagents), launch them all concurrently and wait for completion`;

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
    rules: DEFAULT_RULES,
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
