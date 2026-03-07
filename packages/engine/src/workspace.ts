import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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

  // Write input files (create parent dirs for nested paths like reports/analysis)
  for (const file of options.inputFiles) {
    const filePath = join(inputDir, file.name);
    if (file.name.includes('/')) {
      await mkdir(dirname(filePath), { recursive: true });
    }
    await writeFile(filePath, file.content);
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
 * Recursively traverses subdirectories to support folder-based artifacts.
 */
export async function collectOutputs(
  workspacePath: string,
  phaseId: string,
): Promise<StateFile[]> {
  const outputDir = join(workspacePath, 'output');
  const results: StateFile[] = [];

  const SIGNAL_PREFIXES = ['__INTERRUPT__', '__ANSWER__', '__CHILD_START__', '__CHILD_DONE__', '__PROGRESS__'];

  async function walkDir(dir: string, prefix: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SIGNAL_PREFIXES.some((p) => entry.name.startsWith(p))) continue;

      const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walkDir(join(dir, entry.name), relativeName);
      } else {
        const content = await readFile(join(dir, entry.name));
        results.push({ name: relativeName, content, producedByPhase: phaseId });
      }
    }
  }

  await walkDir(outputDir, '');
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

  // Build a map of base names (without extension) to collected filenames.
  // This handles agents writing "company_profile.json" when the flow declares "company_profile".
  const baseNameMap = new Map<string, string>();
  for (const name of collectedNames) {
    const dotIdx = name.lastIndexOf('.');
    if (dotIdx > 0) {
      baseNameMap.set(name.slice(0, dotIdx), name);
    }
  }

  const found: string[] = [];
  const missing: string[] = [];

  for (const expected of expectedOutputs) {
    if (collectedNames.has(expected)) {
      found.push(expected);
    } else if (baseNameMap.has(expected)) {
      // Match with extension (e.g., "company_profile" → "company_profile.json")
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
