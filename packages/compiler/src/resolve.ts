import type {
  FlowNode,
  FlowGraph,
  FlowSymbol,
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

const DEFAULT_RULES = [
  'Write all output files to the output/ directory',
  'Read input files from the input/ directory',
  'Verify each output file exists before finishing',
  'Stay within budget constraints',
];

/**
 * Resolve a FlowNode into a structured PhaseIR using FlowGraph data.
 * Pure function — no side effects.
 */
export function resolvePhaseIR(
  node: FlowNode,
  graph: FlowGraph,
  options?: { isChild?: boolean },
): PhaseIR {
  if (node.type === 'checkpoint') {
    return resolveCheckpointIR(node, graph);
  }
  return resolveAgentIR(node, graph, options?.isChild ?? false);
}

function resolveCheckpointIR(node: FlowNode, graph: FlowGraph): CheckpointIR {
  const sym = graph.symbols.get(node.id)!;

  const filesToPresent: InputFileEntry[] = sym.declaredInputs.map((file) => {
    const artifact = graph.artifacts.get(file);
    const source = artifact?.producerId ?? 'unknown';
    return {
      file,
      source,
      sourceLabel: source === 'user_upload' ? 'user upload' : `from ${source}`,
      schema: sym.inputSchemas.get(file),
    };
  });

  const expectedInputs: OutputFileEntry[] = sym.declaredOutputs.map((file) => ({
    file,
    schema: sym.outputSchemas.get(file),
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

function resolveAgentIR(
  node: FlowNode,
  graph: FlowGraph,
  isChild: boolean,
): AgentPhaseIR {
  const sym = graph.symbols.get(node.id)!;

  // Input files with source attribution
  const inputs: InputFileEntry[] = sym.declaredInputs.map((file) => {
    const artifact = graph.artifacts.get(file);
    const source = artifact?.producerId ?? 'user_upload';
    return {
      file,
      source,
      sourceLabel: source === 'user_upload' ? 'user upload' : `from ${source}`,
      schema: sym.inputSchemas.get(file),
    };
  });

  // Output files
  const outputs: OutputFileEntry[] = sym.declaredOutputs.map((file) => ({
    file,
    schema: sym.outputSchemas.get(file),
  }));

  // Skills (global + node, deduplicated)
  const allSkillNames = [...new Set([...graph.flow.skills, ...node.config.skills])];
  const skills: SkillEntry[] = allSkillNames.map((name) => ({
    name,
    path: `skills/${name}/`,
  }));

  // Budget: always set for top-level (with fallback); only set for children with explicit budget
  const budget = isChild
    ? node.config.budget
    : (node.config.budget ?? {
        maxTurns: graph.flow.budget.maxTurns,
        maxBudgetUsd: graph.flow.budget.maxBudgetUsd,
      });

  // Children references — sorted by topo order with wave numbers
  const childWaves = computeChildWaves(node.children, sym);
  const sortedChildren = [...node.children].sort((a, b) => {
    const aIdx = sym.childTopoOrder.indexOf(a.id);
    const bIdx = sym.childTopoOrder.indexOf(b.id);
    return aIdx - bIdx;
  });
  const children: ChildReference[] = sortedChildren.map((child, i) => ({
    index: i + 1,
    id: child.id,
    name: child.name,
    promptFile: `prompts/${child.id}.md`,
    outputs: child.config.outputs.map(artifactName),
    wave: childWaves.get(child.id) ?? 0,
  }));

  return {
    kind: 'agent',
    nodeId: node.id,
    name: node.name,
    isChild,
    flowName: graph.flow.name,
    instructions: node.instructions,
    inputs,
    outputs,
    skills,
    budget,
    rules: DEFAULT_RULES,
    children,
    interrupt: { enabled: sym.interruptCapable },
  };
}

/**
 * Resolve IR for all descendant prompt files of a node.
 * Returns a ChildPromptIR with a map of filename -> PhaseIR.
 */
export function resolveChildPromptIRs(
  node: FlowNode,
  graph: FlowGraph,
): ChildPromptIR {
  const children = new Map<string, PhaseIR>();

  function walk(nodes: FlowNode[]): void {
    for (const child of nodes) {
      const ir = resolvePhaseIR(child, graph, { isChild: true });
      children.set(`${child.id}.md`, ir);
      if (child.children.length > 0) {
        walk(child.children);
      }
    }
  }

  walk(node.children);
  return { children };
}

/**
 * Compute wave numbers for children based on sibling I/O dependencies.
 * Wave 0 = no sibling dependencies, wave N = depends on at least one wave N-1 child.
 * Processes children in parent's childTopoOrder.
 */
function computeChildWaves(children: FlowNode[], parentSym: FlowSymbol): Map<string, number> {
  const waves = new Map<string, number>();
  if (children.length === 0) return waves;

  // Build sibling output → producer map
  const outputToChild = new Map<string, string>();
  for (const child of children) {
    for (const output of child.config.outputs.map(artifactName)) {
      outputToChild.set(output, child.id);
    }
  }

  // Process in topo order, computing wave as max(wave of sibling deps) + 1
  for (const childId of parentSym.childTopoOrder) {
    const child = children.find((c) => c.id === childId);
    if (!child) continue;

    let maxDepWave = -1;
    for (const input of child.config.inputs.map(artifactName)) {
      const producerId = outputToChild.get(input);
      if (producerId && producerId !== childId) {
        maxDepWave = Math.max(maxDepWave, waves.get(producerId) ?? 0);
      }
    }
    waves.set(childId, maxDepWave + 1);
  }

  return waves;
}
