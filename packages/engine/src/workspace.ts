import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FlowNode, StateFile } from '@forgeflow/types';
import { artifactName } from '@forgeflow/types';
import type { ResolvedSkill } from '@forgeflow/skill-resolver';

/**
 * Prepare a workspace directory for a phase execution.
 *
 * Creates:
 *   {basePath}/{runId}/{phaseId}/
 *   ├── input/     ← populated with input files
 *   ├── output/    ← agent writes here
 *   └── skills/    ← populated with resolved skill files
 */
export async function prepareWorkspace(
  basePath: string,
  options: {
    runId: string;
    phaseId: string;
    inputFiles: StateFile[];
    skills?: ResolvedSkill[];
    childPrompts?: Map<string, string>;
  },
): Promise<string> {
  const workspacePath = join(basePath, options.runId, options.phaseId);
  const inputDir = join(workspacePath, 'input');
  const outputDir = join(workspacePath, 'output');
  const skillsDir = join(workspacePath, 'skills');

  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  // Write input files
  for (const file of options.inputFiles) {
    await writeFile(join(inputDir, file.name), file.content);
  }

  // Write child prompt files
  if (options.childPrompts && options.childPrompts.size > 0) {
    const promptsDir = join(workspacePath, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    for (const [name, content] of options.childPrompts) {
      await writeFile(join(promptsDir, name), content);
    }
  }

  // Copy skills to workspace
  if (options.skills && options.skills.length > 0) {
    for (const skill of options.skills) {
      const skillDir = join(skillsDir, skill.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), skill.skillMdContent);

      if (skill.references.size > 0) {
        const refsDir = join(skillDir, 'references');
        await mkdir(refsDir, { recursive: true });
        for (const [name, content] of skill.references) {
          await writeFile(join(refsDir, name), content);
        }
      }

      if (skill.scripts.size > 0) {
        const scriptsDir = join(skillDir, 'scripts');
        await mkdir(scriptsDir, { recursive: true });
        for (const [name, content] of skill.scripts) {
          await writeFile(join(scriptsDir, name), content);
        }
      }
    }
  }

  return workspacePath;
}

/**
 * Collect output files from a workspace after phase execution.
 */
export async function collectOutputs(
  workspacePath: string,
  phaseId: string,
): Promise<StateFile[]> {
  const outputDir = join(workspacePath, 'output');
  const results: StateFile[] = [];

  let entries: string[];
  try {
    entries = await readdir(outputDir);
  } catch {
    return results;
  }

  for (const name of entries) {
    // Skip sandbox channel signal files
    if (
      name.startsWith('__INTERRUPT__') ||
      name.startsWith('__ANSWER__') ||
      name.startsWith('__CHILD_START__') ||
      name.startsWith('__CHILD_DONE__')
    ) continue;

    const content = await readFile(join(outputDir, name));
    results.push({ name, content, producedByPhase: phaseId });
  }

  return results;
}

/**
 * Recursively collect ALL expected output filenames from a node and its children at all depths.
 * Deduplicates because parent nodes declare children's outputs in their own config.outputs.
 */
export function getExpectedOutputs(node: FlowNode): string[] {
  const outputSet = new Set<string>();
  collectExpectedOutputsRecursive(node, outputSet);
  return [...outputSet];
}

function collectExpectedOutputsRecursive(node: FlowNode, outputs: Set<string>): void {
  for (const ref of node.config.outputs) {
    outputs.add(artifactName(ref));
  }
  for (const child of node.children) {
    collectExpectedOutputsRecursive(child, outputs);
  }
}

/**
 * Validate that collected outputs include all expected output filenames.
 */
export function validateOutputs(
  collectedOutputs: StateFile[],
  expectedOutputs: string[],
): { valid: boolean; missing: string[]; found: string[] } {
  const collectedNames = new Set(collectedOutputs.map((f) => f.name));
  const found: string[] = [];
  const missing: string[] = [];

  for (const expected of expectedOutputs) {
    if (collectedNames.has(expected)) {
      found.push(expected);
    } else {
      missing.push(expected);
    }
  }

  return { valid: missing.length === 0, missing, found };
}

/**
 * Clean up a workspace directory.
 */
export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  await rm(workspacePath, { recursive: true, force: true });
}
