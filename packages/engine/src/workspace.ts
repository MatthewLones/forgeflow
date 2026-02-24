import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { StateFile } from '@forgeflow/types';

/**
 * Prepare a workspace directory for a phase execution.
 *
 * Creates:
 *   {basePath}/{runId}/{phaseId}/
 *   ├── input/     ← populated with input files
 *   ├── output/    ← agent writes here
 *   └── skills/    ← skill files (future)
 */
export async function prepareWorkspace(
  basePath: string,
  options: {
    runId: string;
    phaseId: string;
    inputFiles: StateFile[];
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
    // Skip interrupt/answer signal files
    if (name.startsWith('__INTERRUPT__') || name.startsWith('__ANSWER__')) continue;

    const content = await readFile(join(outputDir, name));
    results.push({ name, content, producedByPhase: phaseId });
  }

  return results;
}

/**
 * Clean up a workspace directory.
 */
export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  await rm(workspacePath, { recursive: true, force: true });
}
